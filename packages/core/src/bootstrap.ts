import { WorkflowRuntime } from "./runner.js";
import type { WorkflowApp } from "./types.js";
import type { ThenaPlugin } from "./plugin.js";
import type { ThenaConfig, ReportOptions } from "./report/config.js";
import type { ExecutionEvent, ExecutionNode } from "./report/recorder.js";
import { ReportRecorder, resetRecorder, setRecorder } from "./report/recorder.js";
import { writeReport } from "./report/report.js";
import { consoleLogger } from "./report/logger.js";
import { resetRuntimeSettings, setRuntimeSettings } from "./settings.js";

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
 */
export async function bootstrapWorkflow<T = string>(
  WorkflowClass: Function,
  config: ThenaConfig = {},
): Promise<WorkflowApp<T>> {
  // Instanciados uma vez, na ordem declarada — que é a ordem em que chegam no
  // construtor dos agentes.
  const memory = (config.memory ?? []).map((Store) => new Store());

  setRuntimeSettings({ toolErrors: config.toolErrors, memory });

  const reportOptions: ReportOptions =
    typeof config.report === "object" ? config.report : {};

  const onComplete = config.report
    ? (root: ExecutionNode) => {
        const path = writeReport(root, reportOptions);
        console.log(`[thena] Report gerado: ${path}`);
      }
    : undefined;

  let onEvent: ((event: ExecutionEvent) => void) | undefined;
  if (typeof config.log === "function") onEvent = config.log;
  else if (config.log) onEvent = consoleLogger(config.log === "verbose");

  // O recorder é sempre criado — sem `report`, `log` nem plugins ele fica
  // inativo e o custo é zero. Criá-lo aqui é o que permite ao `use()` acoplar
  // depois sem mexer no singleton no-op, que é compartilhado.
  const rec = new ReportRecorder({
    onComplete,
    onEvent,
    // só captura conteúdo quando alguém vai usá-lo
    captureContent: Boolean(config.report) || config.log === "verbose",
  });
  setRecorder(rec);

  const plugins: ThenaPlugin[] = [];
  const runtime = new WorkflowRuntime();

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

      if (plugin.onEvent) {
        // Um plugin que observa conteúdo precisa que ele seja capturado; do
        // contrário receberia eventos sem prompt nem resposta.
        rec.capturarConteudo();
        rec.ouvir((evento) => plugin.onEvent!(evento));
      }

      plugins.push(plugin);
      return app;
    },

    async run(options) {
      try {
        const output = await runtime.run<T>(WorkflowClass, options);
        console.log(output);
        return output;
      } catch (err: unknown) {
        console.error("[thena] Falha ao executar o workflow:", err);
        process.exitCode = 1;
      }
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
      resetRecorder();
      resetRuntimeSettings();
    },
  };

  return app;
}
