import z from "zod";
import type { ToolType } from "./tools.types.js";

/**
 * Conversão do schema Zod para JSON Schema, memoizada.
 *
 * `z.toJSONSchema` percorre o schema inteiro, e os providers a chamavam **a
 * cada requisição**: com 10 tools e 20 turnos, 200 conversões onde bastavam
 * 10. O schema é estático — vem do `@Tool` e nunca muda.
 *
 * A memoização é chaveada pelo **objeto do schema**, num `WeakMap`, e não pela
 * tool: o framework remonta o objeto da tool a cada turno (para injetar o
 * contexto nos hooks), mas o `schema` que ele carrega é sempre a mesma
 * instância. Chavear pela tool não pegaria nada.
 */
const cache = new WeakMap<object, unknown>();

/** JSON Schema dos parâmetros de uma tool. */
export function toJsonSchema(schema: z.ZodType): unknown {
  const guardado = cache.get(schema);
  if (guardado !== undefined) return guardado;

  const convertido = z.toJSONSchema(schema);
  cache.set(schema, convertido);
  return convertido;
}

/**
 * Formato de tools do OpenAI e do Ollama — os dois usam o mesmo envelope.
 * Estava duplicado nos dois providers.
 */
export function toFunctionTools(tools: ToolType[]) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toJsonSchema(tool.schema),
    },
  }));
}
