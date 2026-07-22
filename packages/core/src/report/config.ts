import type { ExecutionEvent } from "./recorder.js";

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
export interface MimirConfig {
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
}
