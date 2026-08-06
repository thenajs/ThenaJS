import type { Usage } from "@thenajs/agentflow";

/**
 * Orçamento de uma execução inteira. `maxIterations` limita um loop; isto aqui
 * limita a run — tempo de parede, chamadas ao modelo, tokens e custo.
 *
 * São contadores e um sinal de parada, não heurística de comportamento: o que
 * conta como "andar em círculos" varia por fluxo e fica com quem usa, lendo
 * `ctx.budget` num `beforeTool` ou num `until` próprio.
 */
export interface RunBudget {
  /** Tempo de parede da run inteira. */
  maxDurationMs?: number;
  /** Quantidade de chamadas ao modelo. */
  maxChatCalls?: number;
  /** Quantidade de execuções de tool. */
  maxToolCalls?: number;
  /** Soma de tokens de prompt + completion (só conta o que o provider reporta). */
  maxTokens?: number;
  /** Custo acumulado; exige `costPer1kTokens` no provider. */
  maxCostUsd?: number;
  /**
   * O que fazer ao estourar (default: `"stop"`).
   *
   * - `"stop"` — encerra graciosamente: os passos seguintes são pulados e a run
   *   devolve o `output` que já tinha;
   * - `"throw"` — lança `BudgetExceededError`.
   */
  mode?: "stop" | "throw";
  /** Chamado uma única vez, no momento em que o orçamento estoura. */
  onExceeded?: (info: BudgetExceeded) => void;
}

/** Consumo acumulado da run. Exposto em `ctx.budget`. */
export interface BudgetUsage {
  chatCalls: number;
  toolCalls: number;
  tokens: number;
  costUsd: number;
  elapsedMs: number;
}

/** Qual limite estourou, e com que valor. */
export interface BudgetExceeded {
  reason: keyof Omit<RunBudget, "mode" | "onExceeded">;
  limit: number;
  value: number;
  usage: BudgetUsage;
}

export class BudgetExceededError extends Error {
  constructor(public readonly info: BudgetExceeded) {
    super(
      `[thena] Orçamento da execução esgotado (${info.reason}: ${info.value} de ${info.limit}).`,
    );
    this.name = "BudgetExceededError";
  }
}

export class BudgetTracker {
  private readonly startedAt = Date.now();
  private chatCalls = 0;
  private toolCalls = 0;
  private tokens = 0;
  private costUsd = 0;
  private breach?: BudgetExceeded;
  private notified = false;

  constructor(private readonly budget: RunBudget = {}) {}

  /** `false` quando nenhum limite foi configurado — o caminho sem custo. */
  get enabled(): boolean {
    return (
      this.budget.maxDurationMs !== undefined ||
      this.budget.maxChatCalls !== undefined ||
      this.budget.maxToolCalls !== undefined ||
      this.budget.maxTokens !== undefined ||
      this.budget.maxCostUsd !== undefined
    );
  }

  usage(): BudgetUsage {
    return {
      chatCalls: this.chatCalls,
      toolCalls: this.toolCalls,
      tokens: this.tokens,
      costUsd: this.costUsd,
      elapsedMs: Date.now() - this.startedAt,
    };
  }

  addChat(usage?: Usage): void {
    this.chatCalls++;
    this.tokens += (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0);
    this.costUsd += usage?.costUsd ?? 0;
  }

  addTool(): void {
    this.toolCalls++;
  }

  /** Consulta sem efeito de controle de fluxo — para relatar, não para decidir. */
  exceeded(): boolean {
    return this.evaluate() !== undefined;
  }

  /**
   * Único ponto de decisão: chamado antes de uma unidade de trabalho e no
   * `until` dos loops. Devolve `true` quando a execução deve parar (modo
   * `"stop"`); lança `BudgetExceededError` no modo `"throw"`.
   */
  checkpoint(): boolean {
    const breach = this.evaluate();
    if (!breach) return false;

    if (this.budget.mode === "throw") {
      throw new BudgetExceededError(breach);
    }

    return true;
  }

  /**
   * Memoiza a primeira violação: o motivo relatado é o que estourou primeiro.
   * `onExceeded` dispara aqui — na detecção — para que valha por qualquer
   * caminho que observe o estouro, inclusive o `until` de um loop.
   */
  private evaluate(): BudgetExceeded | undefined {
    if (this.breach) return this.breach;
    if (!this.enabled) return undefined;

    const usage = this.usage();
    const checks: [BudgetExceeded["reason"], number | undefined, number][] = [
      ["maxDurationMs", this.budget.maxDurationMs, usage.elapsedMs],
      ["maxChatCalls", this.budget.maxChatCalls, usage.chatCalls],
      ["maxToolCalls", this.budget.maxToolCalls, usage.toolCalls],
      ["maxTokens", this.budget.maxTokens, usage.tokens],
      ["maxCostUsd", this.budget.maxCostUsd, usage.costUsd],
    ];

    for (const [reason, limit, value] of checks) {
      if (limit !== undefined && value >= limit) {
        this.breach = { reason, limit, value, usage };
        if (!this.notified) {
          this.notified = true;
          this.budget.onExceeded?.(this.breach);
        }
        return this.breach;
      }
    }

    return undefined;
  }
}
