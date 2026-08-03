import {
  Pipeline,
  Providers,
  StateManager,
  VectorMemory,
  VectorStore,
  toToolOutput,
} from "@thenajs/agentflow";
import type {
  Message,
  PipelineContext,
  Step,
  ToolOutput,
  ToolType,
} from "@thenajs/agentflow";
import {
  getAgentMetadata,
  getToolMetadata,
  getWorkflowMetadata,
} from "./metadata.js";
import type {
  AgentContext,
  ProviderCtor,
  ProviderInput,
  ToolCall,
  ToolClass,
  ToolInput,
  WorkflowContext,
  WorkflowInput,
  WorkflowRunOptions,
  WorkflowStep,
} from "./types.js";
import { recorder } from "./report/recorder.js";
import { settings } from "./settings.js";
import { CONSTRUTOR, pontosDe } from "./inject.js";
import type { PontoDeInjecao } from "./inject.js";
import { BudgetTracker, budget, withBudget } from "./budget.js";
import type { RunBudget } from "./budget.js";

/** Instância já configurada é usada direto; classe é instanciada. */
function resolveProvider(input: ProviderInput): Providers {
  return input instanceof Providers ? input : new (input as ProviderCtor)();
}

/**
 * Monta as memórias vetoriais injetadas no construtor do agente, **na ordem em
 * que os stores foram registrados** no `ThenaConfig`.
 *
 * Os stores são compartilhados por toda a aplicação — uma conexão e um
 * `ensureCollection` cada, independente de quantos agentes existem. O `embed()`
 * sai do provider do próprio agente, que já é público e aceita `embedModel`
 * para apontar um modelo dedicado.
 */
function resolveMemory(provider: Providers): VectorMemory[] {
  return settings().memory.map((store) => new VectorMemory({ store, provider }));
}

/** Deriva a string inicial do pipeline a partir do `input` do workflow. */
export function toInitial(input: WorkflowInput): string {
  return typeof input.message === "string"
    ? input.message
    : JSON.stringify(input);
}

/**
 * Serviço injetável que executa workflows. Uma tool pode recebê-lo no construtor
 * (`constructor(private runtime: WorkflowRuntime)`) e disparar outro workflow.
 */
export class WorkflowRuntime {
  run<T = string>(
    WorkflowClass: Function,
    options: WorkflowRunOptions,
  ): Promise<T> {
    return runWorkflow<T>(
      WorkflowClass,
      toInitial(options.input),
      options.memory,
      options.budget,
    );
  }
}

/**
 * Singleton injetado no construtor das tools. Como `WorkflowRuntime` é a única
 * dependência injetável, ele é passado a toda tool; tools sem construtor apenas
 * ignoram o argumento extra. Assim a DI funciona tanto compilado (tsc) quanto
 * via tsx, sem depender de `reflect-metadata`/metadados de decorator.
 */
const workflowRuntime = new WorkflowRuntime();

/** O que está disponível para injetar num dado momento da execução. */
interface Disponivel {
  estado?: object;
  memorias: VectorMemory[];
  ctx?: AgentContext;
  args?: unknown;
}

/**
 * Resolve um parâmetro decorado. Falha com mensagem que aponta a classe e o
 * parâmetro — injeção silenciosamente `undefined` é o pior modo de errar aqui.
 */
function resolverPonto(
  ponto: PontoDeInjecao,
  d: Disponivel,
  onde: string,
  indice: number,
): unknown {
  switch (ponto.tipo) {
    case "input":
      return d.args;

    case "context":
      if (!d.ctx) {
        throw new Error(
          `[thena] @context() em ${onde} (parâmetro ${indice}): o contexto ainda ` +
          `não existe quando a classe é construída. Use @context() no execute de ` +
          `uma tool, ou receba o ctx como parâmetro do hook.`,
        );
      }
      return d.ctx;

    case "state":
      if (!d.estado) {
        throw new Error(
          `[thena] @state() em ${onde} (parâmetro ${indice}): nenhum estado ` +
          `declarado. Acrescente \`state: MinhaClasse\` no @Workflow.`,
        );
      }
      return d.estado;

    case "memory": {
      if (!ponto.store) return d.memorias[0];
      const achada = d.memorias.find((m) => m.store instanceof ponto.store!);
      if (!achada) {
        throw new Error(
          `[thena] @memory(${ponto.store.name}) em ${onde}: esse store não está ` +
          `registrado em ThenaConfig.memory.`,
        );
      }
      return achada;
    }
  }
}

/** Objeto `ToolType` é usado direto; classe `@Tool` vira `ToolType` com DI. */
function resolveTool(input: ToolInput): ToolType {
  if (typeof input !== "function") {
    return input;
  }
  const config = getToolMetadata(input);
  if (!config) {
    throw new Error(
      `[thena] A classe "${input.name}" não está decorada com @Tool().`,
    );
  }
  const instance = new (input as ToolClass)(workflowRuntime);
  // Defesa em runtime: o TypeScript já barra isso na declaração (`Tool<T
  // extends ToolClass>`), mas cobre só quem passa pelo `tsc`. Sem isso, a
  // falha apareceria como `TypeError: instance.execute is not a function`
  // lá na frente — genérico, e mascarável por `toolErrors: "observe"`.
  if (typeof instance.execute !== "function") {
    throw new Error(
      `[thena] A classe "${input.name}" não implementa execute(input).`,
    );
  }
  const pontos = pontosDe(input, "execute");

  return {
    name: config.name,
    description: config.description,
    schema: config.schema,
    // Sem decorators, o contrato histórico: só os args validados.
    execute: (args: unknown) =>
      Promise.resolve(instance.execute(args)) as Promise<string>,
    // Com decorators, a chamada precisa do ctx — montada no wrapToolWithHooks,
    // que é quem o tem. Guardado aqui para não duplicar a resolução da tool.
    ...(pontos ? { [PLANO]: { instance, pontos, nome: input.name } } : {}),
  } as ToolType;
}

/** Onde o plano de injeção do `execute` viaja até o ponto que tem o ctx. */
const PLANO = Symbol("thena:plano-de-injecao");

interface PlanoDeInjecao {
  instance: any;
  pontos: (PontoDeInjecao | undefined)[];
  nome: string;
}

/**
 * Envolve o `execute` de uma tool com os hooks `beforeTool`/`afterTool` da
 * instância do agente. Sem hooks, devolve a tool intacta.
 *
 * É aqui que `toolErrors` vira comportamento: com `"observe"`, um `throw` do
 * `execute` é convertido em observação `isError: true` em vez de subir. O
 * `throw` do `beforeTool` continua propagando — é o cancelamento documentado.
 */
function wrapToolWithHooks(
  tool: ToolType,
  instance: any,
  ctx: AgentContext,
  disponivel: Disponivel,
): ToolType {
  // Quando o `execute` tem parâmetros decorados, a chamada é montada aqui —
  // é o primeiro ponto do caminho que conhece o ctx.
  const plano = (tool as any)[PLANO] as PlanoDeInjecao | undefined;
  const executar = plano
    ? (args: unknown) => {
        const argumentos = plano.pontos.map((ponto, i) =>
          ponto
            ? resolverPonto(ponto, { ...disponivel, ctx, args }, `${plano.nome}.execute`, i)
            : undefined,
        );
        return Promise.resolve(plano.instance.execute(...argumentos));
      }
    : (args: unknown) => tool.execute(args);

  const hasBefore = typeof instance.beforeTool === "function";
  const hasAfter = typeof instance.afterTool === "function";
  return {
    ...tool,
    execute: (args: unknown) =>
      recorder().around("tool", tool.name, async (node) => {
        let call: ToolCall = { name: tool.name, args };
        if (hasBefore) {
          // `throw` no beforeTool cancela a execução da tool.
          const next = await instance.beforeTool(call, ctx);
          if (next !== undefined) call = next;
        }

        budget().addTool();

        let result: ToolOutput;
        try {
          result = toToolOutput(await executar(call.args));
        } catch (err) {
          if (settings().toolErrors !== "observe") throw err;
          result = {
            content: (err as Error)?.message ?? String(err),
            isError: true,
          };
        }

        if (hasAfter) {
          const replaced = await instance.afterTool(
            {
              name: tool.name,
              args: call.args,
              output: result.content,
              isError: result.isError,
            },
            ctx,
          );
          // String substitui só o texto (preserva o `isError`); para mudar a
          // marca de erro, o hook devolve um `ToolOutput` completo.
          if (replaced !== undefined) {
            result =
              typeof replaced === "string"
                ? { ...result, content: replaced }
                : toToolOutput(replaced);
          }
        }

        recorder().capture(node, {
          input: JSON.stringify(call.args),
          output: result.content,
        });
        recorder().meta(node, { isError: result.isError });
        if (result.isError) recorder().markError(node, result.content);

        return result;
      }),
  };
}

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
  const baseTools = meta.tools.map(resolveTool);
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
    recorder().around("agent", agentName, async () => {
      const agentCtx = ctx as AgentContext;

      // Checagem entre unidades de trabalho: um turno é uma chamada ao modelo
      // mais, no máximo, uma tool. No modo "stop" o passo é pulado e a run
      // termina com o output que já tinha; no modo "throw", isto lança.
      if (budget().checkpoint()) return ctx;

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
          wrapToolWithHooks(tool, instance, agentCtx, disponivel),
        );

        // system do agente + projeção do estado (memory/tasks + history).
        const messages: Message[] = [
          { role: "system", content: system },
          ...ctx.state.toMessages(),
        ];

        const turn = await recorder().around("chat", "chat", async (node) => {
          const t = await provider.chat({ tools, messages, sampling: meta.sampling });
          recorder().capture(node, {
            prompt: JSON.stringify(messages),
            response: t.assistant.content,
            toolCall: t.assistant.toolCalls?.[0]
              ? JSON.stringify(t.assistant.toolCalls[0])
              : undefined,
          });
          recorder().meta(node, {
            toolCallSource: t.assistant.toolCalls?.[0]?.source,
            promptTokens: t.usage?.promptTokens,
            completionTokens: t.usage?.completionTokens,
            costUsd: t.usage?.costUsd,
            // só quando houve retry — no caminho normal não polui o report
            attempts: (t.attempts ?? 1) > 1 ? t.attempts : undefined,
          });
          budget().addChat(t.usage);
          return t;
        });

        agentCtx.budget = budget().usage();

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

/**
 * Executa um único agente. Toda a orquestração (pipeline, estado, contexto)
 * fica no `@thenajs/agentflow`; o framework só monta as peças a partir
 * dos metadados do `@Agent`.
 */
export async function run<T = string>(
  AgentClass: Function,
  input: string,
): Promise<T> {
  const pipeline = new Pipeline(new StateManager());
  pipeline.new([buildAgentStep(AgentClass)]);
  const ctx = await pipeline.run(input);
  return ctx.output as T;
}

/**
 * Compila um passo de workflow em um `Step` do engine, recursivamente.
 * `parallel` e `loop` reutilizam os combinadores do próprio `Pipeline`.
 */
function compileStep(
  step: WorkflowStep,
  pipeline: Pipeline<PipelineContext>,
  estado?: object,
): Step<PipelineContext> {
  // Classe de agente (construtor) -> passo de agente.
  if (typeof step === "function") {
    return buildAgentStep(step, estado);
  }

  if (step.kind === "parallel") {
    const parallelStep = pipeline.parallel({
      steps: step.steps.map((s) => compileStep(s, pipeline, estado)),
    });
    return (ctx) =>
      recorder().around("parallel", "parallel", async () => parallelStep(ctx));
  }

  // step.kind === "loop"
  // Um `until` que declara o 2º parâmetro está pedindo o estado. Sem `state` no
  // @Workflow ele receberia `undefined`, e o erro sairia como um TypeError cru
  // na primeira leitura de campo — sem dizer o que faltou.
  if (step.until.length >= 2 && !estado) {
    throw new Error(
      `[thena] O \`until\` deste loop recebe o estado como 2º parâmetro, mas o ` +
      `workflow não declara \`state\`. Acrescente \`state: MinhaClasse\` no ` +
      `@Workflow, ou use um \`until\` que só leia o ctx.`,
    );
  }

  const loopStep = pipeline.loop({
    steps: step.steps.map((s) => compileStep(s, pipeline, estado)),
    // Mesmo checkpoint do passo de agente: no modo "stop" o orçamento encerra o
    // loop pela porta da frente (output preservado); no "throw", lança daqui.
    // O estado vai como 2º parâmetro — `until: (ctx, s) => s.aprovado`.
    until: async (ctx) =>
      budget().checkpoint() ||
      Boolean(await step.until(ctx as WorkflowContext, estado)),
    maxIterations: step.maxIterations,
    onExhausted: step.onExhausted
      ? (ctx, iterations) => step.onExhausted!(ctx as WorkflowContext, iterations)
      : undefined,
  });
  return (ctx) =>
    recorder().around("loop", "loop", async (node) => {
      const out = await loopStep(ctx);
      // Registrado no nó (e não só no ctx) porque aqui o dado fica aninhado
      // corretamente mesmo com loops dentro de loops.
      recorder().meta(node, {
        iterations: out.loop?.iterations,
        exhausted: out.loop?.exhausted,
        maxIterations: step.maxIterations,
      });
      return out;
    });
}

/**
 * Executa um workflow: os passos rodam num único pipeline, compartilhando o
 * mesmo estado. Passos podem ser agentes (sequenciais), blocos `parallel` ou
 * `loop`. A saída do último passo é retornada.
 *
 * `memory` é o contexto inicial semeado no estado (`state.memory`) antes da
 * execução — disponível para os agentes e para os `until` dos loops.
 */
export async function runWorkflow<T = string>(
  WorkflowClass: Function,
  input: string,
  memory?: unknown,
  runBudget?: RunBudget,
): Promise<T> {
  const meta = getWorkflowMetadata(WorkflowClass);
  const state = new StateManager();
  if (memory !== undefined) {
    // `memory` do estado é string[]; serializa contexto não-textual.
    state.append(
      "memory",
      typeof memory === "string" ? memory : JSON.stringify(memory),
    );
  }
  // Uma instância por execução: os valores iniciais são as inicializações de
  // campo da classe, e todos os passos veem o mesmo objeto.
  const estado = meta.state ? new meta.state() : undefined;

  const pipeline = new Pipeline(state);
  pipeline.new(meta.steps.map((s) => compileStep(s, pipeline, estado)));

  const tracker = new BudgetTracker(runBudget);

  return withBudget(tracker, () =>
    recorder().around("workflow", WorkflowClass.name, async (node) => {
      try {
        const ctx = await pipeline.run(input);
        return ctx.output as T;
      } finally {
        // No nó raiz mesmo quando a run falha — o consumo já aconteceu.
        recorder().meta(node, { ...tracker.usage(), exceeded: tracker.exceeded() });
      }
    }),
  );
}
