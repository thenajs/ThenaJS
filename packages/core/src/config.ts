import type { VectorStoreCtor } from "@thenajs/agentflow";
import type { ExecutionEvent } from "./observability/recorder.js";
import type { RedactConfig } from "./observability/redact.js";

/** Opções do report de execução. */
export interface ReportOptions {
  /** Pasta de saída (default: "report"). */
  dir?: string;
  /** Formato gerado (default: "both"). */
  format?: "html" | "json" | "both";
  /**
   * Gravar o conteúdo de cada passo — prompt, resposta e I/O das tools
   * (default: `true`).
   *
   * `false` mantém a árvore, as durações e a telemetria, e descarta o texto.
   * É a saída para quem trata dado pessoal: os segredos conhecidos já são
   * mascarados pelo `redact`, mas não existe regex para nome ou endereço.
   */
  content?: boolean;
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
  /**
   * Mascaramento de segredo no conteúdo capturado — prompt, resposta, I/O das
   * tools e mensagem de erro — antes de ir para o report, para o log e para os
   * plugins.
   *
   * **Vem ligado**, com um conjunto de padrões conhecidos (`Bearer …`,
   * connection string com senha, `sk-…`, `ghp_…`, JWT, campos nomeados como
   * `api_key` e `password`). Um arquivo em disco, sem retenção nem controle de
   * acesso, é o pior lugar para um segredo aparecer por descuido.
   *
   * `false` desliga; uma função substitui o default — use `redactSecrets` se
   * quiser acrescentar padrões sem perder os de fábrica.
   */
  redact?: RedactConfig;
}
