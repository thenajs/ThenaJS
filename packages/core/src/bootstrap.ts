import { randomUUID } from "node:crypto";
import { runWorkflow, toInitial } from "./runtime/run-workflow.js";
import type { WorkflowApp, WorkflowRunOptions } from "./types.js";
import type { ThenaPlugin } from "./plugin.js";
import type { ThenaConfig, LogConfig, ReportOptions } from "./config.js";
import type { ExecutionEvent, ExecutionNode } from "./observability/recorder.js";
import { ReportRecorder } from "./observability/recorder.js";
import { writeReport } from "./observability/report.js";
import { consoleLogger } from "./observability/logger.js";
import { newRunContext, withRun } from "./run-context.js";

/**
 * Ponto de entrada de uma aplicação ThenaJS. Prepara o workflow e devolve um
 * "app" cujo `run(...)` o executa.
 *
 * - `config.report` — gera um report HTML + JSON ao final da run (estilo Playwright).
 * - `config.log` — loga ao vivo o que está sendo executado.
 * - `app.use(plugin)` — acopla um observador do stream ao vivo.
 *
 * ```ts
 * const app = await bootstrapWorkflow(ExplorerWorkflow, { log: true, report: true });
 * await app.use(thenaFlow({ port: 4100 }));
 * await app.run({ input: { message: "Olá" } });
 * ```
 *
 * Cada `run(...)` monta o próprio `RunContext`: duas execuções concorrentes —
 * de um mesmo app ou de apps diferentes no mesmo processo — não se contaminam.
 */
export async function bootstrapWorkflow<T = string>(
  WorkflowClass: Function,
  config: ThenaConfig = {},
): Promise<WorkflowApp<T>> {
  // Instanciados uma vez por app, e compartilhados por todas as runs: uma
  // conexão e um `ensureCollection` por store, não um por execução.
  const memory = (config.memory ?? []).map((Store) => new Store());

  const plugins: ThenaPlugin[] = [];

  /** Resolve o sink de log: função do usuário, ou o logger de console. */
  function sinkDeLog(log: LogConfig | undefined): ((e: ExecutionEvent) => void) | undefined {
    if (typeof log === "function") return log;
    return log ? consoleLogger(log === "verbose") : undefined;
  }

  /** Monta o recorder desta execução, ligado ao report, ao log e aos plugins. */
  function recorderDaRun(runId: string, options: WorkflowRunOptions): ReportRecorder {
    const report = options.report ?? config.report;
    const log = options.log ?? config.log;

    const reportOptions: ReportOptions = typeof report === "object" ? report : {};
    const onComplete = report
      ? (root: ExecutionNode) => {
          const path = writeReport(root, { ...reportOptions, runId });
          console.log(`[thena] Report gerado: ${path}`);
        }
      : undefined;

    const ouvintes: ((e: ExecutionEvent) => void)[] = [];
    const sink = sinkDeLog(log);
    if (sink) ouvintes.push(sink);
    for (const plugin of plugins) {
      if (plugin.onEvent) ouvintes.push((e) => plugin.onEvent!(e));
    }

    return new ReportRecorder({
      runId,
      onComplete,
      onEvent: ouvintes,
      // Só captura conteúdo quando alguém vai usá-lo. Um plugin que observa
      // precisa dele; do contrário receberia eventos sem prompt nem resposta.
      captureContent:
        Boolean(report) ||
        log === "verbose" ||
        plugins.some((p) => p.onEvent),
    });
  }

  const app: WorkflowApp<T> = {
    async use(plugin) {
      try {
        await plugin.setup?.();
      } catch (err) {
        throw new Error(
          `[thena] O plugin "${plugin.name}" falhou ao iniciar: ` +
            ((err as Error)?.message ?? String(err)),
          { cause: err },
        );
      }

      plugins.push(plugin);
      return app;
    },

    async run(options) {
      const runId = randomUUID();
      // Este contexto carrega o que é do **app**: id, settings e recorder. O
      // orçamento fica de fora porque quem o cria é o `runWorkflow`, ao derivar
      // o contexto filho — é o mesmo caminho de um sub-workflow, e mantê-lo
      // único evita dois trackers para a mesma run.
      const execucao = newRunContext({
        runId,
        settings: { memory },
        recorder: recorderDaRun(runId, options),
        // Lido a cada run, e não no bootstrap: um plugin registrado depois
        // vale para as execuções seguintes, igual aos ouvintes do recorder.
        middleware: {
          tool: plugins.flatMap((p) => (p.tool ? [p.tool] : [])),
          chat: plugins.flatMap((p) => (p.chat ? [p.chat] : [])),
        },
      });

      // A exceção sobe. Engoli-la e devolver `undefined` obrigava todo call
      // site a adivinhar o que deu errado — e num handler HTTP escondia a
      // falha por completo.
      return withRun(execucao, () =>
        runWorkflow<T>(
          WorkflowClass,
          toInitial(options.input),
          options.memory,
          options.budget,
        ),
      );
    },

    async dispose() {
      for (const plugin of plugins) {
        try {
          await plugin.dispose?.();
        } catch (err) {
          console.error(`[thena] O plugin "${plugin.name}" falhou ao encerrar:`, err);
        }
      }
      plugins.length = 0;
    },
  };

  return app;
}
