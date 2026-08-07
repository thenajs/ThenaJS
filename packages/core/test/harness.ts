import { Providers, VectorStore } from "@thenajs/agentflow";
import type {
  CollectionOptions,
  Message,
  ProviderCredentials,
  RawAssistant,
  SamplingParams,
  ToolType,
  VectorDocument,
  VectorMatch,
  VectorSearch,
  VectorSelector,
} from "@thenajs/agentflow";
import { Agent, Tool, Workflow } from "@thenajs/core";
import type {
  AgentClass,
  AgentConfig,
  ProviderInput,
  StateCtor,
  ToolConfig,
  ToolInput,
  WorkflowStep,
} from "@thenajs/core";

/**
 * Prompt de verdade num arquivo, porque o `@Agent` lê o markdown do disco.
 * Passamos uma `URL` para não depender do stack trace do `resolveCallerFile`.
 */
export const PROMPT = new URL("./fixtures/agente.md", import.meta.url);

/** Um turno roteirizado do modelo falso. */
export interface TurnoFalso {
  content?: string;
  /** Emite uma tool call **nativa** (o caminho sem resgate por texto). */
  tool?: { name: string; arguments?: unknown };
  usage?: { promptTokens?: number; completionTokens?: number };
}

/**
 * Provider roteirizado — o harness que o framework não tinha e sem o qual não
 * dá para testar um agente sem falar com um modelo de verdade.
 *
 * Consome `turnos` em ordem; esgotada a fila, repete o último indefinidamente
 * (senão um loop com `maxIterations` alto quebraria por falta de roteiro).
 */
export interface FakeProviderOptions extends ProviderCredentials {
  /**
   * Atraso de cada resposta. Existe para forçar a intercalação de execuções
   * concorrentes nos testes de isolamento — sem ele, uma run termina antes de
   * a outra começar e o teste não prova nada.
   */
  delayMs?: number;
}

export class FakeProvider extends Providers {
  /** Tudo que foi enviado ao "modelo" — para asserções sobre prompt e tools. */
  readonly chamadas: {
    messages: Message[];
    tools: ToolType[];
    sampling?: SamplingParams;
    /** O provider recebeu um sink de token nesta chamada? */
    streaming?: boolean;
  }[] = [];

  private readonly fila: TurnoFalso[];
  private readonly ultimo: TurnoFalso;
  private readonly delayMs: number;

  constructor(
    turnos: TurnoFalso[] = [{ content: "ok" }],
    options: FakeProviderOptions = {},
  ) {
    super();
    this.configure(options);
    this.fila = [...turnos];
    this.ultimo = turnos.at(-1) ?? { content: "ok" };
    this.delayMs = options.delayMs ?? 0;
  }

  protected async chatInternal(
    tools: ToolType[],
    messages: Message[],
    sampling?: SamplingParams,
    signal?: AbortSignal,
    onToken?: (token: string) => void,
  ): Promise<RawAssistant> {
    this.chamadas.push({ messages, tools, sampling, streaming: Boolean(onToken) });

    // O delay respeita o signal, como um `fetch` de verdade: sem isso o fake
    // não simula um provider cancelável, e teste de abort passaria por engano.
    if (this.delayMs) {
      await esperar(this.delayMs, signal);
    }

    const turno = this.fila.shift() ?? this.ultimo;

    // Transmite palavra a palavra quando alguém está ouvindo, como um provider
    // de verdade. Sem sink, devolve inteiro.
    if (onToken && turno.content) {
      for (const pedaco of turno.content.match(/\S+\s*/g) ?? []) {
        onToken(pedaco);
      }
    }

    return {
      content: turno.content ?? "",
      toolCalls: turno.tool
        ? [{ name: turno.tool.name, arguments: turno.tool.arguments ?? {} }]
        : undefined,
      usage: turno.usage,
      attempts: 1,
    };
  }

  /** Vetor determinístico, para os testes de memória vetorial. */
  public async embed(input?: string): Promise<number[]> {
    const n = (input ?? "").length;
    return [n, n + 1, n + 2];
  }
}

/**
 * Banco vetorial de mentira, em memória.
 *
 * O `VectorStoreCtor` exige construtor sem argumentos, então não dá para
 * inspecionar a instância por fora — daí o registro estático, que é como o
 * teste alcança o que foi gravado.
 */
export class FakeVectorStore extends VectorStore {
  static readonly instancias: FakeVectorStore[] = [];

  readonly docs: VectorDocument[] = [];
  readonly buscas: VectorSearch[] = [];
  readonly removidos: VectorSelector[] = [];
  collectionCriada?: CollectionOptions;

  constructor() {
    super();
    (this.constructor as typeof FakeVectorStore).instancias.push(this);
  }

  /** Zera os registros de todas as subclasses, entre testes. */
  static limpar(): void {
    FakeVectorStore.instancias.length = 0;
    FakeVectorStoreB.instancias.length = 0;
  }

  async ensureCollection(options: CollectionOptions): Promise<void> {
    this.collectionCriada = options;
  }
  async collectionExists(): Promise<boolean> {
    return this.collectionCriada !== undefined;
  }
  async dropCollection(): Promise<void> {
    this.collectionCriada = undefined;
  }
  async upsert(docs: VectorDocument[]): Promise<void> {
    this.docs.push(...docs);
  }
  async search(params: VectorSearch): Promise<VectorMatch[]> {
    this.buscas.push(params);
    // Devolve o que foi gravado, na ordem — determinístico é o que o teste quer.
    return this.docs
      .slice(0, params.limit ?? 5)
      .map((d, i) => ({ id: d.id, score: 1 - i * 0.1, payload: d.payload }));
  }
  async remove(selector: VectorSelector): Promise<void> {
    this.removidos.push(selector);
  }
}

/** Um segundo store, para os testes de `@memory(Store)` com mais de um. */
export class FakeVectorStoreB extends FakeVectorStore {
  static readonly instancias: FakeVectorStoreB[] = [];
}

// --------------------------------------------------------------------------
// Fábricas: aplicam os decorators como função comum (`Agent(cfg)(Classe)`), o
// que permite montar agente/tool/workflow dentro de cada teste, com provider e
// roteiro próprios — impossível com a sintaxe `@`, avaliada uma vez no import.
// --------------------------------------------------------------------------

export function criarAgente(
  config: Partial<AgentConfig> & { provider: ProviderInput },
  corpo: Record<string, unknown> = {},
): AgentClass {
  const Classe = class {};
  Object.assign(Classe.prototype, corpo);
  Agent({ prompt: PROMPT, tools: [], ...config })(Classe);
  return Classe;
}

export function criarTool(
  config: ToolConfig,
  execute: (...args: any[]) => unknown,
): ToolInput {
  const Classe = class {
    execute(...args: any[]) {
      return execute(...args);
    }
  };
  Tool(config as any)(Classe as any);
  return Classe as unknown as ToolInput;
}

export function criarWorkflow(steps: WorkflowStep[], state?: StateCtor): Function {
  const Classe = class {};
  Workflow({ steps, state })(Classe);
  return Classe;
}

/** `setTimeout` que rejeita na hora se o signal abortar. */
function esperar(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * Captura o motivo da rejeição.
 *
 * `signal.throwIfAborted()` lança o `reason` do signal, que por padrão é uma
 * `DOMException` — e no Node ela **não** é `instanceof Error`, então
 * `rejects.toThrow()` não casa. Aqui o teste inspeciona o valor cru.
 */
export async function capturarErro(p: PromiseLike<unknown>): Promise<any> {
  try {
    await p;
    throw new Error("esperava uma rejeição, mas resolveu");
  } catch (e) {
    return e;
  }
}
