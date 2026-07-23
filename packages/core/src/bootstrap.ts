import { WorkflowRuntime } from "./runner.js";
import type { WorkflowApp } from "./types.js";
import type { ThenaConfig, ReportOptions } from "./report/config.js";
import type { ExecutionEvent } from "./report/recorder.js";
import { ReportRecorder, resetRecorder, setRecorder } from "./report/recorder.js";
import { writeReport } from "./report/report.js";
import { consoleLogger } from "./report/logger.js";

/**
 * Ponto de entrada de uma aplicação ThenaJS. Prepara o workflow e devolve um
 * "app" cujo `run(...)` o executa.
 *
 * - `config.report` — gera um report HTML + JSON ao final da run (estilo Playwright).
 * - `config.log` — loga ao vivo o que está sendo executado.
 *
 * ```ts
 * const app = await bootstrapWorkflow(ExplorerWorkflow, { log: true, report: true });
 * await app.run({ input: { message: "Olá" } });
 * ```
 */
export async function bootstrapWorkflow<T = string>(
  WorkflowClass: Function,
  config: ThenaConfig = {},
): Promise<WorkflowApp<T>> {
  if (config.report || config.log) {
    const reportOptions: ReportOptions =
      typeof config.report === "object" ? config.report : {};

    const onComplete = config.report
      ? (root: import("./report/recorder.js").ExecutionNode) => {
          const path = writeReport(root, reportOptions);
          console.log(`[thena] Report gerado: ${path}`);
        }
      : undefined;

    let onEvent: ((event: ExecutionEvent) => void) | undefined;
    if (typeof config.log === "function") onEvent = config.log;
    else if (config.log) onEvent = consoleLogger(config.log === "verbose");

    setRecorder(
      new ReportRecorder({
        onComplete,
        onEvent,
        // só captura conteúdo quando alguém vai usá-lo (report ou log verbose)
        captureContent: Boolean(config.report) || config.log === "verbose",
      }),
    );
  }

  const runtime = new WorkflowRuntime();
  return {
    async run(options) {
      try {
        const output = await runtime.run<T>(WorkflowClass, options);
        console.log(output);
        return output;
      } catch (err: unknown) {
        console.error("[thena] Falha ao executar o workflow:", err);
        process.exitCode = 1;
      } finally {
        resetRecorder();
      }
    },
  };
}
