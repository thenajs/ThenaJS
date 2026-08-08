import { describe, expect, it } from "vitest";
import { normalizeToolCallEnvelope } from "../src/providers/utils/index.js";

/**
 * Normalização do envelope de tool call emitido como texto.
 *
 * Modelos locais raramente acertam o formato nativo: uns mandam
 * `{name, parameters}`, outros embrulham em `{function:{…}}`, outros
 * serializam os argumentos como string JSON. Tudo isso precisa virar o mesmo
 * `{ name, arguments }` — senão o resgate falha em silêncio e o JSON acaba
 * virando a resposta final do agente.
 */
describe("normalizeToolCallEnvelope", () => {
  describe("chave do nome", () => {
    it.each(["name", "tool", "tool_name", "toolName", "function_name"])(
      "reconhece `%s`",
      (key) => {
        expect(
          normalizeToolCallEnvelope({ [key]: "ler", arguments: { a: 1 } }),
        ).toEqual({ name: "ler", arguments: { a: 1 } });
      },
    );

    it("`function` como string também vale como nome", () => {
      expect(normalizeToolCallEnvelope({ function: "ler", args: {} })).toEqual({
        name: "ler",
        arguments: {},
      });
    });

    it("ignora nome vazio ou só espaço", () => {
      expect(normalizeToolCallEnvelope({ name: "   " })).toBeNull();
    });

    it("apara espaço em volta do nome", () => {
      expect(normalizeToolCallEnvelope({ name: "  ler  " })?.name).toBe("ler");
    });
  });

  describe("chave dos argumentos", () => {
    it.each(["arguments", "parameters", "args", "input", "params"])(
      "reconhece `%s`",
      (key) => {
        expect(normalizeToolCallEnvelope({ name: "ler", [key]: { p: 1 } })).toEqual({
          name: "ler",
          arguments: { p: 1 },
        });
      },
    );

    it("argumentos ausentes viram objeto vazio", () => {
      // Tools sem parâmetro obrigatório continuam chamáveis.
      expect(normalizeToolCallEnvelope({ name: "agora" })).toEqual({
        name: "agora",
        arguments: {},
      });
    });

    it("string JSON é desserializada", () => {
      expect(normalizeToolCallEnvelope({ name: "ler", arguments: '{"p":1}' })).toEqual({
        name: "ler",
        arguments: { p: 1 },
      });
    });

    it("string que não é JSON fica como string", () => {
      expect(normalizeToolCallEnvelope({ name: "ler", arguments: "a.ts" })).toEqual({
        name: "ler",
        arguments: "a.ts",
      });
    });

    it("null vira objeto vazio", () => {
      expect(normalizeToolCallEnvelope({ name: "ler", arguments: null })).toEqual({
        name: "ler",
        arguments: {},
      });
    });
  });

  describe("envelopes que embrulham", () => {
    it.each(["function", "tool_call", "toolCall", "tool_use"])(
      "desembrulha `%s`",
      (key) => {
        expect(
          normalizeToolCallEnvelope({ [key]: { name: "ler", arguments: { a: 1 } } }),
        ).toEqual({ name: "ler", arguments: { a: 1 } });
      },
    );

    it("desembrulha dois níveis", () => {
      expect(
        normalizeToolCallEnvelope({ tool_call: { function: { name: "ler" } } }),
      ).toEqual({ name: "ler", arguments: {} });
    });

    it("para na profundidade máxima em vez de recursar sem fim", () => {
      const fundo = {
        tool_call: { tool_call: { tool_call: { tool_call: { name: "ler" } } } },
      };
      expect(normalizeToolCallEnvelope(fundo)).toBeNull();
    });

    it("o formato da OpenAI, com id e arguments em string", () => {
      expect(
        normalizeToolCallEnvelope({
          id: "call_1",
          type: "function",
          function: { name: "ler", arguments: '{"path":"a.ts"}' },
        }),
      ).toEqual({ name: "ler", arguments: { path: "a.ts" } });
    });
  });

  describe("listas", () => {
    it("honra a primeira chamada, igual ao caminho nativo", () => {
      expect(
        normalizeToolCallEnvelope([{ name: "primeira" }, { name: "segunda" }]),
      ).toEqual({ name: "primeira", arguments: {} });
    });

    it("lista vazia é null", () => {
      expect(normalizeToolCallEnvelope([])).toBeNull();
    });
  });

  describe("o que não é chamada de tool", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["string", "só texto"],
      ["número", 42],
      ["objeto sem nome", { foo: "bar" }],
      ["objeto vazio", {}],
    ])("%s devolve null", (_rotulo, entrada) => {
      expect(normalizeToolCallEnvelope(entrada)).toBeNull();
    });

    it("é permissivo de propósito: não confere se a tool existe", () => {
      // Quem chama é que valida o nome contra as tools registradas — é o que
      // impede um JSON qualquer na resposta de virar chamada.
      expect(normalizeToolCallEnvelope({ name: "tool_inexistente" })).toEqual({
        name: "tool_inexistente",
        arguments: {},
      });
    });
  });
});
