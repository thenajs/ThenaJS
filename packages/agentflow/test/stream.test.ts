import { describe, expect, it } from "vitest";
import { lerLinhas, lerSse } from "../src/http/index.js";

/**
 * Leitura de resposta em stream.
 *
 * O problema difícil não é o formato — é que um chunk da rede não respeita
 * fronteira de linha nem de caractere UTF-8. Uma linha JSON pode chegar
 * partida em três leituras, e um emoji com metade dos bytes em cada uma.
 */

/** Resposta falsa a partir de pedaços de bytes, como a rede entrega. */
function respostaCom(...pedacos: (string | Uint8Array)[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const p of pedacos) {
        controller.enqueue(typeof p === "string" ? enc.encode(p) : p);
      }
      controller.close();
    },
  });
  return new Response(stream);
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe("lerLinhas", () => {
  it("separa linhas de um chunk único", async () => {
    expect(await collect(lerLinhas(respostaCom("a\nb\nc\n")))).toEqual(["a", "b", "c"]);
  });

  it("junta linha partida entre chunks", async () => {
    // O caso comum: o JSON chega pela metade.
    expect(
      await collect(lerLinhas(respostaCom('{"content":"o', 'la"}\n{"done":true}\n'))),
    ).toEqual(['{"content":"ola"}', '{"done":true}']);
  });

  it("entrega a última linha mesmo sem \\n no fim", async () => {
    expect(await collect(lerLinhas(respostaCom("a\nb")))).toEqual(["a", "b"]);
  });

  it("não parte caractere multibyte entre chunks", async () => {
    // "é" em UTF-8 são dois bytes; aqui eles chegam em leituras diferentes.
    const bytes = new TextEncoder().encode("café\n");
    const meio = bytes.length - 2;
    const lines = await collect(
      lerLinhas(respostaCom(bytes.slice(0, meio), bytes.slice(meio))),
    );
    expect(lines).toEqual(["café"]);
  });

  it("ignora linhas vazias", async () => {
    expect(await collect(lerLinhas(respostaCom("a\n\n\nb\n")))).toEqual(["a", "b"]);
  });

  it("corpo vazio não emite nada", async () => {
    expect(await collect(lerLinhas(respostaCom("")))).toEqual([]);
  });
});

describe("lerSse", () => {
  it("descasca o prefixo `data:`", async () => {
    const r = respostaCom('data: {"a":1}\n\ndata: {"a":2}\n\n');
    expect(await collect(lerSse(r))).toEqual(['{"a":1}', '{"a":2}']);
  });

  it("para no [DONE]", async () => {
    const r = respostaCom('data: {"a":1}\n\ndata: [DONE]\n\ndata: {"a":2}\n\n');
    expect(await collect(lerSse(r))).toEqual(['{"a":1}']);
  });

  it("ignora linhas que não são `data:` (comentário, event, id)", async () => {
    const r = respostaCom(': keep-alive\nevent: ping\ndata: {"a":1}\n\n');
    expect(await collect(lerSse(r))).toEqual(['{"a":1}']);
  });

  it("tolera `data:` sem espaço depois dos dois-pontos", async () => {
    expect(await collect(lerSse(respostaCom('data:{"a":1}\n\n')))).toEqual(['{"a":1}']);
  });
});
