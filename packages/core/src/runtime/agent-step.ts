import type { Message, PipelineContext, Step } from "@thenajs/agentflow";
import { getAgentMetadata } from "../decorators/metadata.js";
import { CONSTRUTOR, pontosDe } from "../decorators/inject.js";
import { resolveMemory, resolveProvider } from "../di/resolve.js";
import { resolveTool } from "../di/tool.js";
import { resolverPonto } from "../di/params.js";
import type { Disponivel } from "../di/params.js";
import { compose } from "../middleware/compose.js";
import { cadeiaDeChat as chatMiddlewares } from "../middleware/chat.js";
import type { ChatInvocation } from "../middleware/chat.js";
import { currentRun } from "../run-context.js";
import type { AgentContext } from "../types.js";
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
export function buildAgentStep(
  AgentClass: Function,
  estado?: object,
): Step<PipelineContext> {
  const meta = getAgentMetadata(AgentClass);
  const provider = resolveProvider(meta.provider);
  const memorias = resolveMemory(provider);
  const baseTools = meta.tools.map((tool) =>
    resolveTool(tool, () => new WorkflowRuntime()),
  );
  const systemPrompt = meta.prompt;
  const disponivel: Disponivel = { estado, memorias };

  // Com parâmetros decorados, cada um diz o que quer e a ordem não importa.
  // Sem eles, o contrato histórico: as memórias, na ordem registrada.
  //
  // Não usamos `reflect-metadata`/`design:paramtypes` de propósito — o esbuild
  // (tsx, o modo dev) não os emite, então DI por tipo quebraria em silêncio no
  // dev. Decorator de parâmetro, por outro lado, é emitido nos dois caminhos.
  const pontos = pontosDe(AgentClass, CONSTRUTOR);
  const argumentos = pontos
    ? pontos.map((ponto, i) =>
        ponto ? resolverPonto(ponto, disponivel, AgentClass.name, i) : undefined,
      )
    : memorias;

  const instance = new (AgentClass as new (...args: any[]) => any)(...argumentos);
  const agentName = AgentClass.name;

  return (ctx: PipelineContext) =>
    currentRun().recorder.around("agent", agentName, async () => {
      const execucao = currentRun();
      const agentCtx = ctx as AgentContext;

      // Checagem entre unidades de trabalho: um turno é uma chamada ao modelo
      // mais, no máximo, uma tool. No modo "stop" o passo é pulado e a run
      // termina com o output que já tinha; no modo "throw", isto lança.
      if (execucao.budget.checkpoint()) return ctx;

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
          buildToolStep(tool, instance, agentCtx, disponivel),
        );

        // system do agente + projeção do estado (memory/tasks + history).
        const messages: Message[] = [
          { role: "system", content: system },
          ...ctx.state.toMessages(),
        ];

        const invocacao: ChatInvocation = {
          messages,
          tools,
          sampling: meta.sampling,
          agent: instance,
          ctx: agentCtx,
          run: execucao,
          // O nó só existe depois que o `registrarChat` abre — até lá, no-op.
          meta: (dados) => {
            if (invocacao.node) execucao.recorder.meta(invocacao.node, dados);
          },
        };

        const cadeiaDeChat = compose(chatMiddlewares(execucao.middleware.chat));
        const turn = await cadeiaDeChat(invocacao, () =>
          provider.chat({
            tools: invocacao.tools,
            messages: invocacao.messages,
            sampling: invocacao.sampling,
          }),
        );

        agentCtx.budget = execucao.budget.usage();

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
