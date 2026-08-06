import type { VectorStoreCtor } from "@thenajs/agentflow";
import type { ExecutionEvent } from "./observability/recorder.js";

/** Opções do report de execução. */
export interface ReportOptions {
  /** Pasta de saída (default: "report"). */
  dir?: string;
  /** Formato gerado (default: "both"). */
  format?: "html" | "json" | "both";
}

/**
 * Logging ao vivo da execução:
 * - `true` — logger de console (árvore indentada, com duração);
 * - `"verbose"` — idem, incluindo conteúdo (resposta, I/O das tools);
 * - função — sink customizado (pino/winston, arquivo, JSON lines).
 */
export type LogConfig = boolean | "verbose" | ((event: ExecutionEvent) => void);

/** Configuração opcional passada ao `bootstrapWorkflow`. */
export interface ThenaConfig {
  /**
   * Gera um report da execução (HTML + JSON) ao final da run, estilo Playwright.
   * `true` usa os defaults; um objeto permite ajustar pasta/formato.
   */
  report?: boolean | ReportOptions;
  /**
   * Loga ao vivo o que está sendo executado (agentes, chats, tools).
   * Independente do `report` — pode usar um, outro ou os dois.
   */
  log?: LogConfig;
  /**
   * Bancos vetoriais da aplicação. Cada classe é instanciada **uma vez** e
   * compartilhada por todos os agentes — uma conexão e um `ensureCollection`
   * por store, independente de quantos agentes existem.
   *
   * A injeção é posicional: a ordem do array é a ordem dos parâmetros do
   * construtor dos agentes.
   *
   * ```ts
   * export const config: ThenaConfig = {
   *     memory: [QdrantNomic, QdrantOpenAI],
   * };
   *
   * // no agente:
   * constructor(
   *     private readonly nomic: VectorMemory,
   *     private readonly openai: VectorMemory,
   * ) {}
   * ```
   *
   * Vários stores fazem sentido quando eles são incompatíveis entre si —
   * tipicamente modelos de embedding de dimensões diferentes, que não cabem na
   * mesma collection.
   *
   * ⚠️ Reordenar o array troca qual store cada agente usa, e o TypeScript não
   * acusa — os parâmetros têm o mesmo tipo. Trate a ordem como contrato:
   * acrescente no fim, nunca no meio.
   *
   * Os embeddings saem do `provider` de cada agente, que já tem `embed()`
   * público e aceita `embedModel` para apontar um modelo dedicado.
   */
  memory?: VectorStoreCtor[];
}
