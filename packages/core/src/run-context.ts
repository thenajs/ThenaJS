import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { BudgetTracker } from "./budget.js";
import type { RunBudget } from "./budget.js";
import { ReportRecorder } from "./observability/recorder.js";
import { DEFAULTS } from "./settings.js";
import type { RuntimeSettings } from "./settings.js";
import type { ChatMiddleware } from "./middleware/chat.js";
import type { ToolMiddleware } from "./middleware/tool.js";

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
   * Sempre novo, **inclusive na run aninhada**: um sub-workflow tem o próprio
   * teto de tempo, chamadas e custo.
   */
  budget: BudgetTracker;
  /**
   * Middlewares registrados por `app.use(...)`, na ordem de registro — o
   * primeiro é o mais externo. Herdados pelas runs aninhadas: um sub-workflow
   * passa pelas mesmas camadas do pai.
   */
  middleware: RunMiddleware;
}

/** As cadeias de middleware do usuário, por ponto de acoplamento. */
export interface RunMiddleware {
  tool: ToolMiddleware[];
  chat: ChatMiddleware[];
}

const SEM_MIDDLEWARE: RunMiddleware = { tool: [], chat: [] };

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
      "[thena] Nenhuma execução em curso. Use `bootstrapWorkflow(...)` e " +
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
}

/**
 * Contexto de uma execução de topo. Sem `recorder` informado, cria um inativo —
 * o caminho de custo zero de quem não pediu report, log nem plugin.
 */
export function newRunContext(options: RunContextOptions = {}): RunContext {
  const runId = options.runId ?? randomUUID();
  return {
    runId,
    settings: { ...DEFAULTS, ...prune(options.settings ?? {}) },
    recorder: options.recorder ?? new ReportRecorder({ runId }),
    budget: new BudgetTracker(options.budget),
    middleware: options.middleware ?? SEM_MIDDLEWARE,
  };
}

/**
 * Contexto de uma execução aninhada (uma tool que dispara outro workflow).
 * Herda id, recorder e settings do pai; ganha orçamento próprio.
 */
export function childRunContext(parent: RunContext, budget?: RunBudget): RunContext {
  return {
    runId: parent.runId,
    settings: parent.settings,
    recorder: parent.recorder,
    budget: new BudgetTracker(budget),
    middleware: parent.middleware,
  };
}

/** Chaves `undefined` não devem sobrescrever o default. */
function prune(overrides: Partial<RuntimeSettings>): Partial<RuntimeSettings> {
  const out: Partial<RuntimeSettings> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}
