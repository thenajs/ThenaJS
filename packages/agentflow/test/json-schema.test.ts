import { describe, expect, it } from "vitest";
import z from "zod";
import { toFunctionTools, toJsonSchema } from "../src/tools/index.js";
import type { ToolType } from "../src/tools/index.js";

/**
 * `z.toJSONSchema` percorre o schema inteiro, e os providers a chamavam a cada
 * requisição: com 10 tools e 20 turnos, 200 conversões onde bastavam 10. O
 * schema vem do `@Tool` e nunca muda.
 */

const tool = (name: string, schema: z.ZodType): ToolType => ({
  name,
  description: name,
  schema,
  execute: async () => "ok",
});

describe("toJsonSchema", () => {
  it("converte o schema", () => {
    const json = toJsonSchema(z.object({ path: z.string() })) as any;
    expect(json.type).toBe("object");
    expect(json.properties.path.type).toBe("string");
  });

  it("converte UMA vez por schema, mesmo em muitas chamadas", () => {
    // Sem memoização, cada chamada devolveria um objeto novo. Identidade é a
    // asserção direta — e não depende de espionar o zod, cujo export não é
    // configurável.
    const schema = z.object({ x: z.string() });

    const primeira = toJsonSchema(schema);
    for (let i = 0; i < 20; i++) {
      expect(toJsonSchema(schema)).toBe(primeira);
    }
  });

  it("schemas diferentes têm entradas diferentes", () => {
    const a = toJsonSchema(z.object({ a: z.string() })) as any;
    const b = toJsonSchema(z.object({ b: z.number() })) as any;
    expect(a.properties).toHaveProperty("a");
    expect(b.properties).toHaveProperty("b");
  });
});

describe("toFunctionTools", () => {
  it("monta o envelope que OpenAI e Ollama esperam", () => {
    const [t] = toFunctionTools([tool("ler", z.object({ path: z.string() }))]) as any[];
    expect(t.type).toBe("function");
    expect(t.function.name).toBe("ler");
    expect(t.function.parameters.type).toBe("object");
  });

  it("não reconverte o schema entre turnos, mesmo com a tool remontada", () => {
    // O framework remonta o objeto da tool a cada turno para injetar o
    // contexto nos hooks — mas o `schema` que ela carrega é a mesma instância.
    // É por isso que a memoização é chaveada pelo schema, não pela tool.
    const schema = z.object({ x: z.string() });

    const parametros = Array.from({ length: 5 }, () => {
      const [t] = toFunctionTools([{ ...tool("eco", schema) }]) as any[];
      return t.function.parameters;
    });

    expect(new Set(parametros).size).toBe(1);
  });

  it("chavear pela TOOL não pegaria nada — é por isso que é pelo schema", () => {
    const schema = z.object({ x: z.string() });
    const tools = Array.from({ length: 3 }, () => ({ ...tool("eco", schema) }));

    // Três objetos de tool diferentes…
    expect(new Set(tools).size).toBe(3);
    // …e um JSON Schema só.
    const parametros = tools.map(
      (t) => (toFunctionTools([t]) as any[])[0].function.parameters,
    );
    expect(new Set(parametros).size).toBe(1);
  });
});
