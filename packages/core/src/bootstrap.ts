import { randomUUID } from "node:crypto";
import { runWorkflow, toInitial } from "./runtime/run-workflow.js";
import type { RunData, WorkflowApp } from "./types.js";
import type { ThenaPlugin } from "./plugin.js";
import type { ThenaConfig, LogConfig, ReportOptions } from "./config.js";
import type { ExecutionEvent, ExecutionNode } from "./observability/recorder.js";
import { ReportRecorder } from "./observability/recorder.js";
import { drainIndexWrites, writeReport } from "./observability/report.js";
import { consoleLogger } from "./observability/logger.js";
import { newRunContext, withRun } from "./run-context.js";
import { Channel, createRunHandle } from "./run-handle.js";

function createApp<T = string, D extends RunData = RunData>(
  WorkflowClass: Function,
  config: ThenaConfig = {},
): WorkflowApp<T, D> {
  // Instanciados uma vez por app, e compartilhados por todas as runs: uma
  // conexão e um `ensureCollection` por store, não um por execução.
  const memory = (config.memory ?? []).map((Store) => new Store());

  const plugins: ThenaPlugin[] = [];

  /** Resolve o sink de log: função do usuário, ou o logger de console. */
  function resolveLogSink(
    log: LogConfig | undefined,
  ): ((e: ExecutionEvent) => void) | undefined {
    if (typeof log === "function") return log;
    return log ? consoleLogger(log === "verbose") : undefined;
  }

  /** Execuções em voo, para o `dispose()` conseguir drená-las. */
  const inFlight = new Set<{
    abort: (r?: unknown) => void;
    result: Promise<unknown>;
  }>();

  /**
   * Monta o recorder desta execução, ligado ao report, ao log e aos plugins.
   *
   * `eventos` só é ligado quando a execução está sendo observada. Ligá-lo
   * sempre — como já foi — mantinha o recorder ativo em **toda** run: a árvore
   * inteira era construída, dois `ExecutionEvent` por passo eram alocados e
   * bufferizados, e nada disso tinha leitor. Medido, custava ~2× o tempo de CPU
   * de uma run e ~13 KB retidos por handle vivo.
   */
  function recorderFor(
    runId: string,
    report: boolean | ReportOptions | undefined,
    log: LogConfig | undefined,
    events?: Channel<ExecutionEvent>,
  ): ReportRecorder {
    const reportOptions: ReportOptions = typeof report === "object" ? report : {};
    const onComplete = report
      ? (root: ExecutionNode) => {
          const path = writeReport(root, { ...reportOptions, runId });
          console.log(`[thena] Report written: ${path}`);
        }
      : undefined;

    const listeners: ((e: ExecutionEvent) => void)[] = [];
    const sink = resolveLogSink(log);
    if (sink) listeners.push(sink);
    for (const plugin of plugins) {
      if (plugin.onEvent) listeners.push((e) => plugin.onEvent!(e));
    }
    // O handle é mais um consumidor do mesmo stream — empurrado (plugin) e
    // puxado (`onEvent`/`eventStream`) são duas torneiras no mesmo cano.
    if (events) listeners.push((e) => events.publish(e));

    return new ReportRecorder({
      runId,
      onComplete,
      onEvent: listeners,
      // Só captura conteúdo quando alguém vai usá-lo. Um plugin que observa
      // precisa dele; do contrário receberia eventos sem prompt nem resposta.
      // `report: { content: false }` desliga mesmo com report ligado.
      // Inalterado de propósito: quem observa só pelo handle continua recebendo
      // a árvore e a telemetria, sem o conteúdo.
      captureContent:
        reportOptions.content !== false &&
        (Boolean(report) || log === "verbose" || plugins.some((p) => p.onEvent)),
      redact: config.redact,
    });
  }

  const app: WorkflowApp<T, D> = {
    async use(plugin) {
      try {
        await plugin.setup?.();
      } catch (err) {
        throw new Error(
          `[thena] Plugin "${plugin.name}" failed to start: ` +
            ((err as Error)?.message ?? String(err)),
          { cause: err },
        );
      }

      plugins.push(plugin);
      return app;
    },

    run(options) {
      const runId = randomUUID();
      const events = new Channel<ExecutionEvent>();
      const tokens = new Channel<string>();

      const report = options.report ?? config.report;
      const log = options.log ?? config.log;

      // **Alguém está olhando esta execução?** Se ninguém está, o recorder fica
      // inativo e a run não constrói árvore, não emite evento e não pede
      // streaming ao provider — o caminho de custo zero que o framework promete.
      //
      // `observe: true` liga na mão, para o padrão POST+SSE, em que o único
      // consumidor é o handle e não há report, log nem plugin.
      const observando =
        options.observe ??
        (Boolean(report) || Boolean(log) || plugins.some((p) => p.onEvent));

      // O signal de quem chamou e o `abort()` desta execução valem os dois — o
      // que disparar primeiro vence. Quem compõe é o `newRunContext`, para o
      // `abort()` existir também num `runWorkflow` direto, sem app.

      // Este contexto carrega o que é do **app** e o teto da execução. O
      // orçamento nasce aqui, e não no `runWorkflow`, para a run ter um único
      // tracker: o `childRunContext` reaproveita este quando o passo aninhado
      // não pede teto próprio, e é isso que faz o teto do topo valer lá dentro.
      const runCtx = newRunContext({
        runId,
        settings: { memory },
        recorder: recorderFor(runId, report, log, observando ? events : undefined),
        budget: options.budget,
        signal: options.signal,
        // A presença do sink é o que **liga o streaming** no provider. Oferecê-lo
        // sempre — como já foi — fazia toda run pedir resposta em stream, com
        // parsing de SSE e um callback por pedaço, mesmo sem ninguém lendo.
        onToken: observando ? (t) => tokens.publish(t) : undefined,
        data: options.data,
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
      // Sem `budget` aqui: ele já está no contexto acima. Passá-lo de novo
      // criaria um segundo tracker com os mesmos limites, medindo o mesmo gasto.
      const result = withRun(runCtx, () =>
        runWorkflow<T>(WorkflowClass, toInitial(options.input), options.memory),
      );

      const entry = { abort: runCtx.abort, result };
      inFlight.add(entry);
      result
        .finally(() => {
          inFlight.delete(entry);
          events.close();
          tokens.close();
        })
        .catch(() => {});

      return createRunHandle<T>({
        runId,
        result,
        signal: runCtx.signal!,
        abort: entry.abort,
        events,
        tokens,
        observando,
      });
    },

    async dispose() {
      // Drena antes de encerrar os plugins: um plugin que fecha servidor não
      // pode sumir enquanto uma execução ainda escreve nele.
      for (const { abort } of inFlight) abort(new Error("[thena] app disposed"));
      await Promise.allSettled([...inFlight].map((r) => r.result));
      inFlight.clear();

      // Depois de drenar as runs, porque cada uma que termina agenda um índice.
      // O índice é escrito fora do caminho crítico; sem esta espera, quem lê
      // `index.html` logo após o `dispose()` veria a versão anterior.
      await drainIndexWrites();

      for (const plugin of plugins) {
        try {
          await plugin.dispose?.();
        } catch (err) {
          console.error(`[thena] Plugin "${plugin.name}" failed to dispose:`, err);
        }
      }
      plugins.length = 0;
    },
  };

  return app;
}

/**
 * O ponto de entrada de uma aplicação ThenaJS.
 *
 * ```ts
 * import { Thena } from "@thenajs/core";
 *
 * async function bootstrap() {
 *   const app = Thena.create(ExplorerWorkflow, { log: true, report: true });
 *   await app.use(thenaFlow({ port: 4100 }));
 *
 *   console.log(await app.run({ input: { message: "Olá" } }));
 *   await app.dispose();
 * }
 *
 * bootstrap();
 * ```
 *
 * `create` **não é `async`**: montar o app não espera nada. Quem espera é o
 * `run(...)`. E cada `run(...)` abre o próprio `RunContext` — duas execuções
 * concorrentes, do mesmo app ou de apps diferentes no mesmo processo, não se
 * contaminam.
 */
export const Thena = {
  create: createApp,
};

/**
 * @deprecated Use `Thena.create(...)`, que não é `async`:
 *
 * ```ts
 * const app = Thena.create(MeuWorkflow, config);   // sem await
 * ```
 *
 * Mantido para não quebrar quem veio do 0.6.
 */
export async function bootstrapWorkflow<T = string, D extends RunData = RunData>(
  WorkflowClass: Function,
  config: ThenaConfig = {},
): Promise<WorkflowApp<T, D>> {
  return createApp<T, D>(WorkflowClass, config);
}
