import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { BudgetTracker } from "./budget.js";
import type { RunBudget } from "./budget.js";
import { ReportRecorder } from "./observability/recorder.js";
import { DEFAULTS } from "./settings.js";
import type { RuntimeSettings } from "./settings.js";
import type { ChatMiddleware } from "./middleware/chat.js";
import type { ToolMiddleware } from "./middleware/tool.js";
import type { AgentContext } from "./types.js";

/**
 * Tudo que uma execução carrega. Antes isto vivia em três variáveis mutáveis no
 * escopo de módulo (`settings`, `recorder` e o singleton do `WorkflowRuntime`),
 * o que fazia duas runs concorrentes se sobrescreverem: um servidor HTTP que
 * chamasse `app.run()` por request estava quebrado, e por isso não existia
 * suíte de testes — eles se contaminavam.
 *
 * O mecanismo é o mesmo `AsyncLocalStorage` que o `budget` já usava; o que
 * mudou foi o alcance. Nenhuma assinatura pública precisou mudar.
 */
export interface RunContext {
  /**
   * Identifica a execução de topo. Uma run aninhada **herda** o id do pai:
   * do ponto de vista de quem observa, um sub-workflow disparado por uma tool
   * faz parte da mesma execução.
   */
  runId: string;
  /** Config da aplicação (stores vetoriais), herdada do app. */
  settings: RuntimeSettings;
  /**
   * Um por execução de topo. Runs aninhadas **herdam** o recorder — é o que
   * mantém os nós do sub-workflow pendurados no nó da tool que o disparou.
   */
  recorder: ReportRecorder;
  /**
   * O teto desta execução.
   *
   * Uma run aninhada **sem orçamento próprio reaproveita o do pai** — herdar
   * não pode ser a forma de escapar do teto. Com orçamento próprio, ela ganha
   * um tracker encadeado no do pai: conta nos dois, e quem corta é o mais
   * apertado dos dois.
   */
  budget: BudgetTracker;
  /**
   * Middlewares registrados por `app.use(...)`, na ordem de registro — o
   * primeiro é o mais externo. Herdados pelas runs aninhadas: um sub-workflow
   * passa pelas mesmas camadas do pai.
   */
  middleware: RunMiddleware;
  /**
   * Cancelamento desta execução. **Herdado** pelas runs aninhadas: abortar o
   * pai encerra o sub-workflow junto.
   *
   * É consultado nos mesmos dois pontos que o orçamento — antes de cada turno
   * de agente e no `until` de cada loop — e repassado até o `fetch`.
   */
  signal?: AbortSignal;
  /**
   * Cancela esta execução. É o `abort()` do handle, alcançável de dentro —
   * uma tool que descobre que não vale a pena continuar não precisa que quem
   * chamou o `run()` decida por ela.
   *
   * **Herdado** pelas runs aninhadas, como o `signal`: abortar de dentro de um
   * sub-workflow encerra a execução inteira.
   */
  abort: (reason?: unknown) => void;
  /**
   * Pedido de **parada graciosa**, feito por `ctx.stop()`.
   *
   * Diferente do abort: os passos seguintes são pulados e a run devolve o
   * output que já tinha, sem lançar — é o mesmo comportamento do orçamento no
   * modo `"stop"`, e é consultado nos mesmos dois checkpoints.
   *
   * Objeto e não booleano porque a run aninhada **compartilha** o pedido:
   * "encerre" significa encerrar a execução, não só o pedaço de dentro.
   *
   * @internal
   */
  stopRequest: { requested: boolean };
  /**
   * O ctx do passo em execução, quando há um.
   *
   * `undefined` entre o `app.run()` e o primeiro passo — é o que acontece numa
   * factory de provider, que roda na compilação do workflow. Por isso o
   * `context()` só consegue entregar `state`/`turn`/`output` **dentro** de um
   * passo, e falha alto fora dele em vez de devolver `undefined`.
   *
   * @internal
   */
  step?: AgentContext;
  /**
   * Limpezas registradas por `ctx.onDispose(...)`, drenadas ao fim desta
   * execução — em sucesso, erro ou abort.
   *
   * Cada run tem a **sua** lista (a aninhada não herda), senão o fim de um
   * sub-workflow soltaria recursos que ainda pertencem a quem o chamou.
   *
   * @internal
   */
  cleanups: (() => void | Promise<void>)[];
  /**
   * Recebe cada pedaço de texto que o modelo produz, quando alguém está
   * ouvindo. Herdado pelas runs aninhadas.
   *
   * Fica aqui, e não no recorder, porque token não é um passo da execução: não
   * tem início, fim, duração nem status. Misturá-lo no `ExecutionEvent`
   * poluiria o tipo e quebraria quem monta a árvore a partir dele.
   */
  onToken?: (token: string) => void;
  /**
   * O canal de dados da execução, definido por quem chama `run({ data })`.
   *
   * **O framework não interpreta nada aqui.** Ele transporta, propaga para as
   * runs aninhadas e mantém fora do modelo — só. Os conceitos são da sua
   * aplicação, e é de propósito que não existe campo nomeado para nenhum
   * deles: o eixo pelo qual você separa execuções é decisão sua, não do
   * framework.
   *
   * **Não vai para o modelo.** É a diferença para o `run({ memory })`, que é
   * serializado direto na mensagem `system`: tudo que você põe lá o modelo lê,
   * e vai parar no report em disco. Aqui não.
   */
  data: Record<string, unknown>;
}

/** As cadeias de middleware do usuário, por ponto de acoplamento. */
export interface RunMiddleware {
  tool: ToolMiddleware[];
  chat: ChatMiddleware[];
}

const NO_MIDDLEWARE: RunMiddleware = { tool: [], chat: [] };

const als = new AsyncLocalStorage<RunContext>();

/**
 * O contexto da execução atual.
 *
 * Lança quando não há execução em curso — diferente do antigo `budget()`, que
 * devolvia um no-op. Aqui a ausência de contexto significa que uma função do
 * runtime foi chamada fora de `withRun`, o que é bug do framework: falhar alto
 * é melhor do que devolver defaults e fazer o `memory` do config sumir em
 * silêncio.
 */
export function currentRun(): RunContext {
  const ctx = als.getStore();
  if (!ctx) {
    throw new Error(
      "[thena] Nenhuma execução em curso. Use `Thena.create(...)` e " +
        "`app.run(...)`, ou `runWorkflow(...)` — o runtime só funciona dentro " +
        "do escopo de uma run.",
    );
  }
  return ctx;
}

/** O contexto atual, ou `undefined` — para quem precisa decidir se há um. */
export function peekRun(): RunContext | undefined {
  return als.getStore();
}

/** Executa `fn` no escopo de `ctx`. Tudo que ela chamar enxerga esse contexto. */
export function withRun<T>(ctx: RunContext, fn: () => T): T {
  return als.run(ctx, fn);
}

/** Opções para montar um contexto de topo. */
export interface RunContextOptions {
  settings?: Partial<RuntimeSettings>;
  recorder?: ReportRecorder;
  budget?: RunBudget;
  runId?: string;
  middleware?: RunMiddleware;
  signal?: AbortSignal;
  onToken?: (token: string) => void;
  data?: Record<string, unknown>;
}

/**
 * Contexto de uma execução de topo. Sem `recorder` informado, cria um inativo —
 * o caminho de custo zero de quem não pediu report, log nem plugin.
 *
 * O `AbortController` nasce aqui, e não em quem chama: é o que faz `abort()`
 * existir em **toda** execução, inclusive num `runWorkflow` direto, sem app.
 * O signal de quem chamou continua valendo — os dois são compostos, e o que
 * disparar primeiro vence.
 */
export function newRunContext(options: RunContextOptions = {}): RunContext {
  const runId = options.runId ?? randomUUID();
  const controller = new AbortController();
  return {
    runId,
    settings: { ...DEFAULTS, ...prune(options.settings ?? {}) },
    recorder: options.recorder ?? new ReportRecorder({ runId }),
    budget: new BudgetTracker(options.budget),
    middleware: options.middleware ?? NO_MIDDLEWARE,
    signal: options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal,
    abort: (reason?: unknown) => controller.abort(reason),
    stopRequest: { requested: false },
    cleanups: [],
    onToken: options.onToken,
    data: options.data ?? {},
  };
}

/**
 * Contexto de uma execução aninhada (uma tool que dispara outro workflow).
 * Herda id, recorder e settings do pai.
 *
 * O orçamento é o ponto delicado. Sem `budget` próprio, o filho **usa o mesmo
 * tracker do pai** — é o que impede um sub-workflow de gastar sem teto depois
 * que o do pai já estourou. Com `budget` próprio, ganha um tracker encadeado:
 * conta nos dois, e corta quem estourar primeiro.
 */
export function childRunContext(parent: RunContext, budget?: RunBudget): RunContext {
  return {
    runId: parent.runId,
    settings: parent.settings,
    recorder: parent.recorder,
    budget: budget ? new BudgetTracker(budget, parent.budget) : parent.budget,
    middleware: parent.middleware,
    signal: parent.signal,
    // Cancelamento e parada valem para a execução inteira: pedir de dentro de
    // um sub-workflow encerra tudo, do mesmo jeito que abortar o pai encerra o
    // filho. É o mesmo objeto, de propósito.
    abort: parent.abort,
    stopRequest: parent.stopRequest,
    // Já as limpezas são desta run: o fim de um sub-workflow não pode soltar
    // recurso que ainda pertence a quem o chamou.
    cleanups: [],
    onToken: parent.onToken,
    data: parent.data,
  };
}

/** Pede a parada graciosa da execução. Checada nos mesmos pontos do orçamento. */
export function requestStop(ctx: RunContext = currentRun()): void {
  ctx.stopRequest.requested = true;
}

/**
 * Roda as limpezas registradas por `onDispose`, na ordem **inversa** do
 * registro — quem abriu por último fecha primeiro, como um `defer`.
 *
 * Nenhuma falha aqui derruba a execução: a run já terminou, e um `finally` que
 * lança esconderia o erro de verdade. Elas são reportadas e seguem.
 */
export async function runCleanups(ctx: RunContext): Promise<void> {
  const queued = ctx.cleanups.splice(0).reverse();
  for (const limpar of queued) {
    try {
      await limpar();
    } catch (err) {
      console.error("[thena] Uma limpeza de `onDispose` falhou:", err);
    }
  }
}

/** Chaves `undefined` não devem sobrescrever o default. */
function prune(overrides: Partial<RuntimeSettings>): Partial<RuntimeSettings> {
  const out: Partial<RuntimeSettings> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/**
 * Lança se a execução foi cancelada.
 *
 * Usa o erro **nativo** do signal em vez de um tipo próprio: é o que preserva
 * a distinção entre `TimeoutError` (de `AbortSignal.timeout`), `AbortError`
 * (de `controller.abort()`) e uma razão qualquer passada em
 * `controller.abort(razão)`. Orçamento é conceito do framework e merece erro
 * próprio; cancelamento é conceito da plataforma, com protocolo estabelecido.
 */
export function throwIfAborted(ctx: RunContext = currentRun()): void {
  ctx.signal?.throwIfAborted();
}
