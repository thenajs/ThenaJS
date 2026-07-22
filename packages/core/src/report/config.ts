/** Opções do report de execução. */
export interface ReportOptions {
  /** Pasta de saída (default: "report"). */
  dir?: string;
  /** Formato gerado (default: "both"). */
  format?: "html" | "json" | "both";
}

/** Configuração opcional passada ao `bootstrapWorkflow`. */
export interface MimirConfig {
  /**
   * Gera um report da execução (HTML + JSON) ao final da run, estilo Playwright.
   * `true` usa os defaults; um objeto permite ajustar pasta/formato.
   */
  report?: boolean | ReportOptions;
}
