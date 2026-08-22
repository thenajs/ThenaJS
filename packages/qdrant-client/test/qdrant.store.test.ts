import { afterEach, describe, expect, it, vi } from "vitest";
import { QdrantStore } from "@thenajs/qdrant-client";

/**
 * O único código do repositório que fala HTTP com um serviço de terceiro — e o
 * que mais tinha a ganhar com teste, porque a resposta do Qdrant é contrato de
 * outra pessoa.
 *
 * O `fetch` global é trocado por um roteiro. Não é preguiça de subir um Qdrant:
 * o que precisa ser fixado aqui é **o que sai daqui** (rota, corpo, header) e
 * **o que fazemos com o que volta** — e nada disso exige o banco de verdade. O
 * que exigiria é o formato da resposta mudar, e para isso um teste de
 * integração é outra tarefa, com outro custo.
 */

/** Uma chamada capturada. */
interface Chamada {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Instala um `fetch` roteirizado e devolve o que foi enviado. */
function interceptar(respostas: { status?: number; body?: unknown; text?: string }[]) {
  const chamadas: Chamada[] = [];
  const fila = [...respostas];

  vi.stubGlobal("fetch", async (url: string, init: any = {}) => {
    chamadas.push({
      url: String(url),
      method: init.method,
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const r = fila.shift() ?? { status: 200, body: {} };
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body ?? {},
      text: async () => r.text ?? JSON.stringify(r.body ?? {}),
    };
  });

  return chamadas;
}

const store = (extra: Record<string, unknown> = {}) =>
  new QdrantStore({ url: "http://localhost:6333", collection: "mem", ...extra } as any);

afterEach(() => vi.unstubAllGlobals());

describe("a URL e o header", () => {
  it("tira a barra final da URL, para não gerar rota com barra dupla", async () => {
    const chamadas = interceptar([{ body: { result: { exists: true } } }]);
    await new QdrantStore({
      url: "http://localhost:6333/",
      collection: "mem",
    } as any).collectionExists();

    expect(chamadas[0].url).toBe("http://localhost:6333/collections/mem/exists");
  });

  it("manda `api-key` quando há credencial, e não manda quando não há", async () => {
    let chamadas = interceptar([{ body: { result: { exists: true } } }]);
    await store({ apiKey: "segredo" }).collectionExists();
    expect(chamadas[0].headers["api-key"]).toBe("segredo");

    vi.unstubAllGlobals();
    chamadas = interceptar([{ body: { result: { exists: true } } }]);
    await store().collectionExists();
    expect(chamadas[0].headers).not.toHaveProperty("api-key");
  });
});

describe("ensureCollection", () => {
  it("não recria uma coleção que já existe", async () => {
    const chamadas = interceptar([{ body: { result: { exists: true } } }]);
    await store().ensureCollection({ size: 3 });

    expect(chamadas).toHaveLength(1); // só o `exists`
  });

  it("cria a coleção e o índice de partição quando não existe", async () => {
    const chamadas = interceptar([
      { body: { result: { exists: false } } },
      { body: {} }, // PUT da coleção
      { body: {} }, // PUT do índice
    ]);
    await store().ensureCollection({ size: 3, distance: "cosine" });

    expect(chamadas[1].method).toBe("PUT");
    expect(chamadas[1].body).toEqual({ vectors: { size: 3, distance: "Cosine" } });
    expect(chamadas[2].url).toContain("/index?wait=true");
    expect(chamadas[2].body).toMatchObject({ field_name: "dataset" });
  });

  it("cai para a forma abreviada do índice quando a de objeto falha", async () => {
    // O Qdrant 1.10 — nosso piso — não aceita `field_schema` como objeto. A
    // queda existe para o índice sair mesmo lá, só sem a co-locação.
    const chamadas = interceptar([
      { body: { result: { exists: false } } },
      { body: {} },
      { status: 400, text: "unknown field" }, // objeto recusado
      { body: {} }, // abreviada aceita
    ]);
    await store().ensureCollection({ size: 3 });

    expect(chamadas[2].body).toMatchObject({ field_schema: { type: "keyword" } });
    expect(chamadas[3].body).toMatchObject({ field_schema: "keyword" });
  });
});

describe("upsert", () => {
  it("não chama a API com lista vazia", async () => {
    const chamadas = interceptar([]);
    await store().upsert([]);
    expect(chamadas).toHaveLength(0);
  });

  it("envia id, vetor e payload de cada documento", async () => {
    const chamadas = interceptar([{ body: {} }]);
    await store().upsert([{ id: "a", vector: [1, 2], payload: { dataset: "x" } }]);

    expect(chamadas[0].url).toContain("/points?wait=true");
    expect(chamadas[0].body).toEqual({
      points: [{ id: "a", vector: [1, 2], payload: { dataset: "x" } }],
    });
  });
});

describe("search", () => {
  it("traduz `where` para o filtro do Qdrant e mapeia os pontos de volta", async () => {
    const chamadas = interceptar([
      { body: { result: { points: [{ id: 7, score: 0.9, payload: { t: "oi" } }] } } },
    ]);

    const achados = await store().search({
      vector: [1],
      limit: 2,
      where: { dataset: "x" },
    });

    expect(chamadas[0].body).toMatchObject({
      query: [1],
      limit: 2,
      filter: { must: [{ key: "dataset", match: { value: "x" } }] },
    });
    expect(achados).toEqual([{ id: 7, score: 0.9, payload: { t: "oi" } }]);
  });

  it("`rawFilter` vence o `where` — é o escape hatch para o que igualdade não cobre", async () => {
    const chamadas = interceptar([{ body: { result: { points: [] } } }]);
    const bruto = { must: [{ key: "n", range: { gte: 3 } }] };

    await store().search({ vector: [1], where: { dataset: "x" }, rawFilter: bruto });

    expect(chamadas[0].body).toMatchObject({ filter: bruto });
  });

  it("resposta sem `points` devolve lista vazia, não explode", async () => {
    interceptar([{ body: {} }]);
    expect(await store().search({ vector: [1] })).toEqual([]);
  });
});

describe("remove", () => {
  it("apaga por ids", async () => {
    const chamadas = interceptar([{ body: {} }]);
    await store().remove({ ids: ["a", "b"] });

    expect(chamadas[0].url).toContain("/points/delete?wait=true");
    expect(chamadas[0].body).toEqual({ points: ["a", "b"] });
  });

  it("apaga por filtro", async () => {
    const chamadas = interceptar([{ body: {} }]);
    await store().remove({ where: { dataset: "x" } });

    expect(chamadas[0].body).toEqual({
      filter: { must: [{ key: "dataset", match: { value: "x" } }] },
    });
  });

  it("SEM seletor não chama nada — apagar tudo não pode ser implícito", async () => {
    const chamadas = interceptar([]);
    await store().remove({});
    expect(chamadas).toHaveLength(0);
  });
});

describe("erro do Qdrant", () => {
  it("a mensagem carrega método, rota, status e o detalhe do servidor", async () => {
    interceptar([{ status: 404, text: "Collection `mem` doesn't exist" }]);

    await expect(store().dropCollection()).rejects.toThrow(
      /Qdrant DELETE \/collections\/mem failed \(404\).*doesn't exist/,
    );
  });
});
