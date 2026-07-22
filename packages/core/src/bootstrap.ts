import { WorkflowRuntime } from "./runner.js";
import type { WorkflowApp } from "./types.js";
import type { MimirConfig, ReportOptions } from "./report/config.js";
import { ReportRecorder, resetRecorder, setRecorder } from "./report/recorder.js";
import { writeReport } from "./report/report.js";

/**
 * Ponto de entrada de uma aplicação MimirJs. Prepara o workflow e devolve um
 * "app" cujo `run(...)` o executa.
 *
 * Com `config.report`, gera um report HTML + JSON da execução ao final da run
 * (estilo Playwright).
 *
 * ```ts
 * const app = await bootstrapWorkflow(ExplorerWorkflow, { report: true });
 * await app.run({ input: { message: "Olá" } });
 * ```
 */
export async function bootstrapWorkflow<T = string>(
  WorkflowClass: Function,
  config: MimirConfig = {},
): Promise<WorkflowApp<T>> {
  if (config.report) {
    const options: ReportOptions =
      typeof config.report === "object" ? config.report : {};
    setRecorder(
      new ReportRecorder({
        onComplete: (root) => {
          const path = writeReport(root, options);
          console.log(`[Mimir] Report gerado: ${path}`);
        },
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
        console.error("[Mimir] Falha ao executar o workflow:", err);
        process.exitCode = 1;
      } finally {
        resetRecorder();
      }
    },
  };
}
