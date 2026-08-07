import { describe, expect, it } from "vitest";
import { parser } from "../src/providers/utils/index.js";

/**
 * As cinco estratégias de extração de JSON e a limpeza de blocos de raciocínio.
 *
 * São o resgate de tool call: quando o modelo não usa o formato nativo, é isto
 * que decide entre executar a tool e devolver um JSON cru como resposta final.
 * Puras e determinísticas — os testes mais baratos do repositório, e por muito
 * tempo os que não existiam.
 */

const {
  parseAsJson,
  parseAsMarkdownJson,
  parseAsExtractedJson,
  parseAsBalancedJson,
  parseAsTaggedJson,
  stripThinkTags,
} = parser;

describe("parseAsJson", () => {
  it("aceita JSON puro", () => {
    expect(parseAsJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("rejeita qualquer coisa em volta", () => {
    expect(() => parseAsJson('texto {"a":1}')).toThrow();
  });
});

describe("parseAsMarkdownJson", () => {
  it("descasca ```json", () => {
    expect(parseAsMarkdownJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("descasca ``` sem linguagem", () => {
    expect(parseAsMarkdownJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("tolera espaço em volta", () => {
    expect(parseAsMarkdownJson('  ```json\n  {"a":1}  \n```  ')).toEqual({ a: 1 });
  });

  it("funciona sem cerca nenhuma", () => {
    expect(parseAsMarkdownJson('{"a":1}')).toEqual({ a: 1 });
  });
});

describe("parseAsBalancedJson", () => {
  it("pega o primeiro objeto e ignora o que vem depois", () => {
    expect(parseAsBalancedJson('lixo {"a":1} mais lixo {"b":2}')).toEqual({ a: 1 });
  });

  it("conta chaves aninhadas", () => {
    expect(parseAsBalancedJson('{"a":{"b":{"c":1}}} sobra')).toEqual({
      a: { b: { c: 1 } },
    });
  });

  it("não se confunde com chave dentro de string", () => {
    expect(parseAsBalancedJson('{"a":"tem } aqui dentro"}')).toEqual({
      a: "tem } aqui dentro",
    });
  });

  it("respeita aspas escapadas", () => {
    expect(parseAsBalancedJson('{"a":"aspas \\" e } juntos"}')).toEqual({
      a: 'aspas " e } juntos',
    });
  });

  it("respeita barra invertida escapada antes de aspas", () => {
    expect(parseAsBalancedJson('{"a":"termina com barra \\\\"}')).toEqual({
      a: "termina com barra \\",
    });
  });

  it("falha quando não há objeto", () => {
    expect(() => parseAsBalancedJson("só texto")).toThrow(/No JSON found/);
  });

  it("falha quando as chaves não fecham", () => {
    expect(() => parseAsBalancedJson('{"a":{"b":1}')).toThrow(/Unbalanced/);
  });
});

describe("parseAsExtractedJson", () => {
  it("é ganancioso: vai até a ÚLTIMA chave", () => {
    // É por isso que ele é a última estratégia da cascata — com dois objetos
    // na resposta, ele junta os dois e falha, enquanto o balanceado acerta.
    expect(() => parseAsExtractedJson('{"a":1} e {"b":2}')).toThrow();
    expect(parseAsBalancedJson('{"a":1} e {"b":2}')).toEqual({ a: 1 });
  });

  it("resgata JSON cercado de texto", () => {
    expect(parseAsExtractedJson('Claro! {"a":1} espero ter ajudado')).toEqual({
      a: 1,
    });
  });

  it("falha sem objeto", () => {
    expect(() => parseAsExtractedJson("nada aqui")).toThrow(/No JSON object/);
  });
});

describe("parseAsTaggedJson", () => {
  it.each([
    ["<tool_call>", '<tool_call>{"name":"ler"}</tool_call>'],
    ["<function_call>", '<function_call>{"name":"ler"}</function_call>'],
    ["<tool_use>", '<tool_use>{"name":"ler"}</tool_use>'],
    ["[TOOL_CALL]", '[TOOL_CALL]{"name":"ler"}'],
  ])("reconhece %s", (_rotulo, entrada) => {
    expect(parseAsTaggedJson(entrada)).toEqual({ name: "ler" });
  });

  it("é insensível a maiúsculas", () => {
    expect(parseAsTaggedJson('<TOOL_CALL>{"name":"ler"}')).toEqual({ name: "ler" });
  });

  it("dispensa a tag de fechamento — resposta truncada ainda é recuperável", () => {
    expect(parseAsTaggedJson('<tool_call>{"name":"ler","args":{}}')).toEqual({
      name: "ler",
      args: {},
    });
  });

  it("ignora o texto antes da tag", () => {
    expect(parseAsTaggedJson('Vou ler o arquivo.\n<tool_call>{"name":"ler"}')).toEqual({
      name: "ler",
    });
  });

  it("falha quando não há tag", () => {
    expect(() => parseAsTaggedJson('{"name":"ler"}')).toThrow(/No tool call tag/);
  });
});

describe("stripThinkTags", () => {
  it.each(["think", "thinking", "reasoning", "thought", "reasoning_scratchpad"])(
    "remove <%s> fechado",
    (tag) => {
      expect(stripThinkTags(`<${tag}>ruído</${tag}>resposta`)).toBe("resposta");
    },
  );

  it("remove vários blocos", () => {
    expect(stripThinkTags("<think>a</think>meio<think>b</think>fim")).toBe("meiofim");
  });

  it("remove bloco NÃO fechado até o fim do texto", () => {
    // Modelo que estourou o limite de tokens no meio do raciocínio.
    expect(stripThinkTags("resposta\n<think>ficou pela metade")).toBe("resposta");
  });

  it("remove tag aberta com atributos", () => {
    expect(stripThinkTags("ok\n<thinking depth=3>algo")).toBe("ok");
  });

  it("preserva texto sem tag", () => {
    expect(stripThinkTags("  resposta limpa  ")).toBe("resposta limpa");
  });

  it("não confunde com uma tag parecida", () => {
    expect(stripThinkTags("<thinker>fica</thinker>")).toBe("<thinker>fica</thinker>");
  });

  it("é multilinha dentro do bloco", () => {
    expect(stripThinkTags("<think>\nlinha 1\nlinha 2\n</think>\nresposta")).toBe(
      "resposta",
    );
  });
});
