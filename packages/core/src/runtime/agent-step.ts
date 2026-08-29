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
import type {
  AgentContext,
  AgentContract,
  AgentContractContext,
  RunControls,
} from "../types.js";
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

  const available: Injectable = {
    workflowState,
    memories,
  };

  /*
   * Agent DI
   *
   * Mantém compatibilidade histórica:
   *
   * - com decorators: resolve explicitamente cada parâmetro;
   * - sem decorators: injeta memories por posição.
   *
   * Esse fallback continua existindo somente no Agent.
   */
  const agentPoints = pointsOf(
    AgentClass,
    CONSTRUCTOR,
  );

  const agentArgs = agentPoints
    ? agentPoints.map((point, index) =>
        point
          ? resolvePoint(
              point,
              available,
              AgentClass.name,
              index,
            )
          : undefined,
      )
    : memories;

  const instance = new (
    AgentClass as new (...args: any[]) => any
  )(...agentArgs);

  /*
   * Contract DI
   *
   * Diferente do Agent, Contract é uma API nova e não possui
   * fallback posicional de memories.
   *
   * Se precisar de uma dependência, ela deve ser declarada
   * explicitamente:
   *
   * constructor(
   *   @memory(MyStore) memory: VectorMemory,
   *   @state() state: WorkflowState,
   * ) {}
   */
  const contractPoints = pointsOf(
    meta.contract,
    CONSTRUCTOR,
  );

  const contractArgs = contractPoints
    ? contractPoints.map((point, index) =>
        point
          ? resolvePoint(
              point,
              available,
              meta.contract.name,
              index,
            )
          : undefined,
      )
    : [];

  const contract = new (
    meta.contract as new (
      ...args: any[]
    ) => AgentContract
  )(...contractArgs);

  const agentName = AgentClass.name;

  return (ctx: PipelineContext) =>
    currentRun().recorder.around(
      "agent",
      agentName,
      async () => {
        const runCtx = currentRun();
        const agentCtx = ctx as AgentContext;

        /*
         * Projeta os controles da execução no contexto deste passo.
         */
        attachRunToStep(
          agentCtx,
          runCtx,
        );

        /*
         * Checkpoints antes de iniciar um novo turno.
         */
        throwIfAborted(runCtx);

        if (
          runCtx.stopRequest.requested ||
          runCtx.budget.checkpoint()
        ) {
          return ctx;
        }

        /*
         * O input do agente é o conteúdo do último item do history.
         */
        const last = ctx.state.history.at(-1) as
          | Message
          | string
          | undefined;

        const input =
          typeof last === "string"
            ? last
            : (last?.content ?? "");

        /*
         * API disponível dentro da própria classe Agent.
         */
        instance.context = ctx;
        instance.provider = provider;
        instance.tools = baseTools;
        instance.prompt = systemPrompt;

        /*
         * Escape hatch.
         *
         * Se o agente implementa run(), ele assume controle total
         * e o fluxo automático de hooks/provider é ignorado.
         */
        if (typeof instance.run === "function") {
          const out = await instance.run(
            input,
            ctx,
          );

          ctx.output = out;

          agentCtx.turn = {
            calledTool: false,
            response: String(out ?? ""),
          };

          ctx.state.append(
            "history",
            {
              role: "assistant",
              content: String(out ?? ""),
            },
          );

          return ctx;
        }

        try {
          /*
           * Prompt hook.
           */
          let system = systemPrompt;

          if (
            typeof instance.beforePrompt ===
            "function"
          ) {
            const replaced =
              await instance.beforePrompt(
                system,
                agentCtx,
              );

            if (replaced !== undefined) {
              system = replaced;
            }
          }

          /*
           * Escopo de DI específico desta invocação.
           *
           * `peers` será preenchido depois que as tools forem
           * embrulhadas pelo runtime.
           */
          const stepAvailable: Injectable = {
            ...available,
          };

          const tools = baseTools.map((tool) =>
            buildToolStep(
              tool,
              instance,
              agentCtx,
              stepAvailable,
            ),
          );

          stepAvailable.peers = tools;

          /*
           * O Contract é a ÚNICA porta entre estado/runtime
           * e o contexto enviado ao modelo.
           *
           * Nada de prompt, memory, tasks ou history é
           * acrescentado implicitamente depois daqui.
           */
          const contractCtx =
            Object.create(
              agentCtx,
            ) as AgentContractContext;

          Object.defineProperties(
            contractCtx,
            {
              prompt: {
                value: system,
                enumerable: true,
              },

              input: {
                value: input,
                enumerable: true,
              },

              memory: {
                value: ctx.state.memory,
                enumerable: true,
              },

              tasks: {
                value: ctx.state.tasks,
                enumerable: true,
              },

              history: {
                value: ctx.state.history,
                enumerable: true,
              },
            },
          );

          /*
           * Resolve a percepção do modelo.
           */
          const modelContext =
            await contract.build(
              contractCtx,
            );

          /*
           * Message[] é enviado diretamente.
           *
           * Qualquer outro resultado é serializado e vira
           * uma única mensagem user.
           */
          const messages: Message[] =
            isMessageArray(modelContext)
              ? modelContext
              : [
                  {
                    role: "user",
                    content:
                      serializeContractOutput(
                        modelContext,
                        agentName,
                      ),
                  },
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

            meta: (data) => {
              if (invocation.node) {
                runCtx.recorder.meta(
                  invocation.node,
                  data,
                );
              }
            },
          };

          /*
           * Middleware + provider.
           */
          const chatChain = compose(
            chatMiddlewares(
              runCtx.middleware.chat,
            ),
          );

          const turn = await chatChain(
            invocation,
            () =>
              provider.chat({
                tools:
                  invocation.tools,
                messages:
                  invocation.messages,
                sampling:
                  invocation.sampling,
                signal:
                  invocation.signal,
                onToken:
                  invocation.onToken,
              }),
          );

          /*
           * Atualiza consumo.
           */
          agentCtx.budget =
            runCtx.budget.usage();

          /*
           * Runtime continua responsável por registrar
           * o resultado real do turno no history.
           */
          ctx.state.append(
            "history",
            turn.assistant,
          );

          if (turn.tool) {
            ctx.state.append(
              "history",
              turn.tool,
            );
          }

          /*
           * Resposta do passo.
           */
          let response =
            turn.tool?.content ??
            turn.assistant.content;

          if (
            typeof instance.afterResponse ===
            "function"
          ) {
            const replaced =
              await instance.afterResponse(
                response,
                agentCtx,
              );

            if (replaced !== undefined) {
              response = replaced;
            }
          }

          /*
           * Informações utilizadas por loops/until.
           */
          agentCtx.turn = {
            calledTool: Boolean(
              turn.tool,
            ),

            toolName:
              turn.assistant
                .toolCalls?.[0]
                ?.name,

            toolError:
              turn.tool?.isError,

            toolCallSource:
              turn.assistant
                .toolCalls?.[0]
                ?.source,

            response,
          };

          ctx.output = response;

          return ctx;
        } catch (error) {
          /*
           * Abort não é erro recuperável do Agent.
           */
          throwIfAborted(
            runCtx,
          );

          /*
           * Hook de recuperação.
           */
          if (
            typeof instance.onError ===
            "function"
          ) {
            const fallback =
              await instance.onError(
                error as Error,
                agentCtx,
              );

            if (
              fallback !== undefined
            ) {
              ctx.output =
                fallback;

              ctx.state.append(
                "history",
                {
                  role: "assistant",
                  content: String(
                    fallback,
                  ),
                },
              );

              return ctx;
            }
          }

          throw error;
        }
      },
    );
}

function isMessageArray(value: unknown): value is Message[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Message).role === "string" &&
        typeof (item as Message).content === "string",
    )
  );
}

function serializeContractOutput(value: unknown, agentName: string): string {
  if (typeof value === "string") return value;
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError("build() returned a value that JSON cannot represent");
    }
    return serialized;
  } catch (error) {
    throw new TypeError(
      `[thena] Contract for agent "${agentName}" returned a value that could not be serialized.`,
      { cause: error },
    );
  }
}
