import { Pipeline } from "@thenajs/agentflow";
import type { PipelineContext, Step } from "@thenajs/agentflow";
import { currentRun } from "../run-context.js";
import type {
  LoopStopReason,
  WorkflowContext,
  WorkflowStep,
} from "../types.js";
import { buildAgentStep } from "./agent-step.js";

/**
 * Compila um passo de workflow em um `Step` do engine, recursivamente.
 * `parallel` e `loop` reutilizam os combinadores do próprio `Pipeline`.
 */
export function compileStep(
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
      currentRun().recorder.around("parallel", "parallel", async () =>
        parallelStep(ctx),
      );
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

  // Contadores desta execução do loop. Ficam no closure (e não em `ctx.loop`,
  // que é last-writer-wins entre loops aninhados) e são zerados a cada
  // invocação — um loop de dentro roda de novo a cada volta do de fora.
  const falhas = { consecutive: 0, total: 0 };
  let stoppedBy: LoopStopReason = "until";
  const maxFails = step.maxFails ?? Infinity;

  const loopStep = pipeline.loop({
    steps: step.steps.map((s) => compileStep(s, pipeline, estado)),
    until: async (ctx) => {
      const c = ctx as WorkflowContext;

      // A falha é contada antes de qualquer parada: ela aconteceu, mesmo que
      // quem encerre o loop seja outro freio.
      if (c.turn?.toolError === true) {
        falhas.consecutive++;
        falhas.total++;
        await step.onFail?.(c, {
          consecutive: falhas.consecutive,
          total: falhas.total,
          toolName: c.turn.toolName,
          message: c.turn.response,
        });
      } else if (c.turn?.calledTool) {
        // Só uma tool que **funcionou** zera a sequência. Um turno sem tool
        // nenhuma não conta como progresso nem como falha.
        falhas.consecutive = 0;
      }

      // Mesmo checkpoint do passo de agente: no modo "stop" o orçamento encerra
      // o loop pela porta da frente (output preservado); no "throw", lança daqui.
      if (currentRun().budget.checkpoint()) {
        stoppedBy = "budget";
        return true;
      }

      // O agente está preso repetindo a mesma falha — insistir só custa.
      if (falhas.consecutive >= maxFails) {
        stoppedBy = "fails";
        return true;
      }

      // O estado vai como 2º parâmetro — `until: (ctx, s) => s.aprovado`.
      if (await step.until(c, estado)) {
        stoppedBy = "until";
        return true;
      }

      return false;
    },
    maxIterations: step.maxIterations,
    onExhausted: (ctx, iterations) => {
      stoppedBy = "exhausted";
      return step.onExhausted?.(ctx as WorkflowContext, iterations);
    },
  });

  return (ctx) =>
    currentRun().recorder.around("loop", "loop", async (node) => {
      falhas.consecutive = 0;
      falhas.total = 0;
      stoppedBy = "until";

      const out = await loopStep(ctx);

      // Registrado no nó (e não só no ctx) porque aqui o dado fica aninhado
      // corretamente mesmo com loops dentro de loops. `stoppedBy` existe para
      // "convergiu" e "desistiu" não ficarem indistinguíveis no report.
      currentRun().recorder.meta(node, {
        iterations: out.loop?.iterations,
        exhausted: out.loop?.exhausted,
        maxIterations: step.maxIterations,
        stoppedBy,
        fails: falhas.total || undefined,
      });
      return out;
    });
}
