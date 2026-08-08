import type { Usage } from "@thenajs/agentflow";

/**
 * Orçamento de uma execução inteira. `maxIterations` limita um loop; isto aqui
 * limita a run — tempo de parede, chamadas ao modelo, tokens e custo.
 *
 * São contadores e um sinal de parada, não heurística de comportamento: o que
 * conta como "andar em círculos" varia por fluxo e fica com quem usa, lendo
 * `ctx.budget` num `beforeTool` ou num `until` próprio.
 *
 * ## O teto vale para as runs aninhadas
 *
 * Um sub-workflow disparado por uma tool conta no orçamento do pai. Sem
 * orçamento próprio ele **usa o tracker do pai**; com orçamento próprio, ganha
 * um encadeado, e corta quem estourar primeiro.
 *
 * ## Precisão
 *
 * A parada é checada **entre** unidades de trabalho, e uma chamada ao modelo só
 * é contabilizada depois de responder — antes disso não existe `usage` para
 * somar. Na prática o teto é uma barreira, não um corte no meio da frase: a run
 * pode gastar mais uma chamada além do limite antes de parar, e uma tool que
 * dispara sub-workflow permite mais uma por nível de aninhamento. É limite
 * superior conhecido e constante, não vazamento proporcional.
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
      `[thena] Run budget exhausted (${info.reason}: ${info.value} of ${info.limit}).`,
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

  /**
   * @param budget Limites deste nível.
   * @param pai    O orçamento em que este está **contido**.
   *
   * Uma run aninhada conta no próprio teto **e** no do pai. Sem isso, herdar
   * virava a forma de escapar: um `maxCostUsd` de $1 no topo era contornável
   * por qualquer tool que disparasse um sub-workflow, e o gasto de dentro dele
   * não aparecia em lugar nenhum. O teto que vale é sempre o mais apertado da
   * cadeia.
   */
  constructor(
    private readonly budget: RunBudget = {},
    private readonly parent?: BudgetTracker,
  ) {}

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

  /**
   * Conta a chamada **antes** de ela ser feita.
   *
   * Parece detalhe e não é: uma tool executa *dentro* de `provider.chat`, então
   * uma chamada contabilizada só na volta ainda vale zero enquanto o
   * sub-workflow que ela disparou roda. Numa recursão (workflow → tool → o
   * mesmo workflow) o contador nunca saía de zero na descida, e nenhum teto
   * segurava nada. Contando na ida, `maxChatCalls` vira barreira de verdade.
   */
  openChat(): void {
    this.chatCalls++;
    // O gasto sobe a cadeia inteira: o que o filho consome, o pai pagou.
    this.parent?.openChat();
  }

  /** Soma tokens e custo — que só existem depois de o modelo responder. */
  closeChat(usage?: Usage): void {
    this.tokens += (usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0);
    this.costUsd += usage?.costUsd ?? 0;
    this.parent?.closeChat(usage);
  }

  /** Chamada e consumo de uma vez, para quem contabiliza fora do middleware. */
  addChat(usage?: Usage): void {
    this.openChat();
    this.closeChat(usage);
  }

  addTool(): void {
    this.toolCalls++;
    this.parent?.addTool();
  }

  /** Consulta sem efeito de controle de fluxo — para relatar, não para decidir. */
  exceeded(): boolean {
    return this.evaluate() !== undefined || this.parent?.exceeded() === true;
  }

  /**
   * Único ponto de decisão: chamado antes de uma unidade de trabalho e no
   * `until` dos loops. Devolve `true` quando a execução deve parar (modo
   * `"stop"`); lança `BudgetExceededError` no modo `"throw"`.
   *
   * Checa o nível local primeiro e só então o pai — assim o motivo relatado é
   * o do teto mais próximo, e o `mode` que decide entre parar e lançar é
   * sempre o de quem de fato estourou.
   */
  checkpoint(): boolean {
    const breach = this.evaluate();
    if (breach) {
      if (this.budget.mode === "throw") {
        throw new BudgetExceededError(breach);
      }
      return true;
    }

    // O teto do pai vale aqui dentro: estar aninhado não é permissão para
    // gastar o que o pai já não tem.
    return this.parent?.checkpoint() === true;
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
