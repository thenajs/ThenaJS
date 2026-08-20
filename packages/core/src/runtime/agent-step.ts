import type { Message, PipelineContext, Step } from "@thenajs/agentflow";
import { getAgentMetadata } from "../decorators/metadata.js";
import { CONSTRUCTOR, pointsOf } from "../decorators/inject.js";
import { resolveMemory, resolveProvider } from "../di/resolve.js";
import { resolveTool } from "../di/tool.js";
import { resolvePoint } from "../di/params.js";
import type { Injectable } from "../di/params.js";
import { compose } from "../middleware/compose.js";
import { chatChain as chatMiddlewares } from "../middleware/chat.js";
import type { ChatInvocation } from "../middleware/chat.js";
import { currentRun, requestStop, throwIfAborted } from "../run-context.js";
import type { RunContext } from "../run-context.js";
import type { AgentContext, RunControls } from "../types.js";
import { buildToolStep } from "./tool-step.js";
import { WorkflowRuntime } from "./workflow-runtime.js";

/**
 * Monta o passo de pipeline de um agente a partir dos metadados do `@Agent`.
 *
 * Provider, tools e prompt são resolvidos uma vez. O passo monta as mensagens
 * (system do agente + projeção do estado) e chama `provider.chat`, anexando os
 * turnos (assistant e, se houve, tool) ao `history`. A saída do passo é o
 * conteúdo da tool, se houve, senão o conteúdo do assistant.
 *
 * No fluxo padrão os hooks (`AgentHooks`) são chamados nos pontos certos. Se a
 * classe define `run(input, ctx)`, ela assume o controle total e os hooks
 * automáticos não são chamados (escape hatch).
 */
/**
 * Projeta a execução no ctx do passo.
 *
 * Escrito uma vez por passo, e não a cada leitura: `data` e `signal` são a
 * mesma referência da run inteira, e as operações são fechaduras sobre ela.
 */
function attachRunToStep(ctx: AgentContext, run: RunContext): void {
  // `Object.assign` e não atribuição campo a campo: `runId` e `signal` são
  // `readonly`, e essa promessa é para **quem usa** o ctx — não para o runtime
  // que o monta. Assim o tipo continua honesto lá fora, sem cast aqui dentro.
  const controles: RunControls & { data: Record<string, unknown> } = {
    runId: run.runId,
    signal: run.signal!,
    data: run.data,
    usage: () => run.budget.usage(),
    abort: (reason?: unknown) => run.abort(reason),
    stop: () => requestStop(run),
    onDispose: (fn: () => void | Promise<void>) => void run.cleanups.push(fn),
    meta: (data: Record<string, unknown>) => run.recorder.currentMeta(data),
  };

  Object.assign(ctx, controles);

  // A partir daqui `context()` — a função — resolve para o ctx deste passo,
  // e não mais para a vista da run.
  run.step = ctx;
}

export function buildAgentStep(
  AgentClass: Function,
  workflowState?: object,
): Step<PipelineContext> {
  const meta = getAgentMetadata(AgentClass);
  const provider = resolveProvider(meta.provider);
  const memories = resolveMemory(provider);
  const baseTools = meta.tools.map((tool) =>
    resolveTool(tool, () => new WorkflowRuntime()),
  );
  const systemPrompt = meta.prompt;
  const available: Injectable = { workflowState, memories };

  // Com parâmetros decorados, cada um diz o que quer e a ordem não importa.
  // Sem eles, o contrato histórico: as memórias, na ordem registrada.
  //
  // Não usamos `reflect-metadata`/`design:paramtypes` de propósito — o esbuild
  // (tsx, o modo dev) não os emite, então DI por tipo quebraria em silêncio no
  // dev. Decorator de parâmetro, por outro lado, é emitido nos dois caminhos.
  const points = pointsOf(AgentClass, CONSTRUCTOR);
  const ctorArgs = points
    ? points.map((ponto, i) =>
        ponto ? resolvePoint(ponto, available, AgentClass.name, i) : undefined,
      )
    : memories;

  const instance = new (AgentClass as new (...args: any[]) => any)(...ctorArgs);
  const agentName = AgentClass.name;

  return (ctx: PipelineContext) =>
    currentRun().recorder.around("agent", agentName, async () => {
      const runCtx = currentRun();
      const agentCtx = ctx as AgentContext;

      // A execução é projetada no ctx do passo, para uma tool alcançá-la com
      // `@context()` — que é a porta documentada. Sem isto, `signal`, `runId`
      // e as operações só existiam do lado de fora do `run()`.
      //
      // Aditivo: nada do que o ctx já tinha mudou de lugar.
      attachRunToStep(agentCtx, runCtx);

      // Checagem entre unidades de trabalho: um turno é uma chamada ao modelo
      // mais, no máximo, uma tool.
      //
      // Cancelamento sempre lança — quem pediu para parar não quer meia
      // resposta apresentada como resposta. Orçamento e `ctx.stop()` podem só
      // pular: a run termina com o output que já tinha.
      throwIfAborted(runCtx);
      if (runCtx.stopRequest.requested || runCtx.budget.checkpoint()) return ctx;

      // Texto do último turno — passado ao escape hatch `run`.
      const last = ctx.state.history.at(-1) as Message | string | undefined;
      const input = typeof last === "string" ? last : (last?.content ?? "");

      // A classe pode acessar contexto, provider e tools na sua lógica.
      instance.context = ctx;
      instance.provider = provider;
      instance.tools = baseTools;
      instance.prompt = systemPrompt;

      // Escape hatch: controle total, sem hooks automáticos.
      if (typeof instance.run === "function") {
        const out = await instance.run(input, ctx);
        ctx.output = out;
        // O `run` faz seu próprio loop de tools; do ponto de vista do workflow o
        // turno já terminou (calledTool: false). Quem precisar de outra parada
        // grava seu próprio campo no ctx.
        agentCtx.turn = { calledTool: false, response: String(out ?? "") };
        ctx.state.append("history", {
          role: "assistant",
          content: String(out ?? ""),
        });
        return ctx;
      }

      try {
        let system = systemPrompt;
        if (typeof instance.beforePrompt === "function") {
          const replaced = await instance.beforePrompt(system, agentCtx);
          if (replaced !== undefined) system = replaced;
        }

        const tools = baseTools.map((tool) =>
          buildToolStep(tool, instance, agentCtx, available),
        );

        // system do agente + projeção do estado (memory/tasks + history).
        const messages: Message[] = [
          { role: "system", content: system },
          ...ctx.state.toMessages(),
        ];

        const invocation: ChatInvocation = {
          messages,
          tools,
          sampling: meta.sampling,
          signal: runCtx.signal,
          onToken: runCtx.onToken,
          agent: instance,
          ctx: agentCtx,
          run: runCtx,
          // O nó só existe depois que o `registrarChat` abre — até lá, no-op.
          meta: (data) => {
            if (invocation.node) runCtx.recorder.meta(invocation.node, data);
          },
        };

        const chatChain = compose(chatMiddlewares(runCtx.middleware.chat));
        const turn = await chatChain(invocation, () =>
          provider.chat({
            tools: invocation.tools,
            messages: invocation.messages,
            sampling: invocation.sampling,
            signal: invocation.signal,
            onToken: invocation.onToken,
          }),
        );

        agentCtx.budget = runCtx.budget.usage();

        ctx.state.append("history", turn.assistant);
        if (turn.tool) ctx.state.append("history", turn.tool);

        let response = turn.tool?.content ?? turn.assistant.content;
        if (typeof instance.afterResponse === "function") {
          const replaced = await instance.afterResponse(response, agentCtx);
          if (replaced !== undefined) response = replaced;
        }

        // Expõe o resumo do turno para o `until` do loop (ex.: `untilAnswered`).
        agentCtx.turn = {
          calledTool: Boolean(turn.tool),
          toolName: turn.assistant.toolCalls?.[0]?.name,
          toolError: turn.tool?.isError,
          toolCallSource: turn.assistant.toolCalls?.[0]?.source,
          response,
        };

        ctx.output = response;
        return ctx;
      } catch (error) {
        // Cancelamento não passa pelo `onError`: o hook existe para o agente
        // se recuperar de falha, e "alguém mandou parar" não é falha. Deixá-lo
        // devolver um fallback transformaria um abort em resposta.
        throwIfAborted(runCtx);

        if (typeof instance.onError === "function") {
          const fallback = await instance.onError(error as Error, agentCtx);
          if (fallback !== undefined) {
            ctx.output = fallback;
            ctx.state.append("history", {
              role: "assistant",
              content: String(fallback),
            });
            return ctx;
          }
        }
        throw error;
      }
    });
}
