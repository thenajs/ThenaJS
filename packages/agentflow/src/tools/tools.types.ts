import z from "zod";

/**
 * Retorno rico de uma tool. Devolver uma `string` continua válido e equivale a
 * `{ content, isError: false }` — o objeto existe só para quem precisa sinalizar
 * falha sem lançar, tornando o erro visível para o report e para os hooks.
 */
export type ToolOutput = {
  /** O texto que volta para o modelo como observação. */
  content: string;
  /** `true` marca a observação como falha (nó `tool` vira `status: "error"`). */
  isError?: boolean;
  /** Carga estruturada livre, ignorada pelo modelo — para hooks e telemetria. */
  data?: unknown;
};

export type ToolType = {
  name: string;
  description: string;
  schema: z.ZodType;
  execute: (args: any) => Promise<string | ToolOutput>;
};

/** Normaliza o retorno de uma tool: string crua vira `ToolOutput` sem erro. */
export function toToolOutput(value: string | ToolOutput): ToolOutput {
  if (typeof value === "string") {
    return { content: value, isError: false };
  }
  // Tools em JS podem devolver qualquer coisa; `content` precisa ser texto.
  return { ...value, content: String(value?.content ?? "") };
}
