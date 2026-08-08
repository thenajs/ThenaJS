import { afterEach, describe, expect, it } from "vitest";
import { Agent, Workflow, Thena, memory } from "@thenajs/core";
import type { VectorMemory } from "@thenajs/core";
import { FakeProvider, FakeVectorStore, FakeVectorStoreB, PROMPT } from "./harness.js";

/**
 * Memória vetorial: os stores do `ThenaConfig` chegam ao construtor do agente.
 *
 * Não confundir com `ctx.state.memory`, que é o bucket de texto projetado no
 * prompt — este aqui é busca por similaridade.
 */

afterEach(() => FakeVectorStore.limpar());

describe("injeção de memória", () => {
  it("sem decorator, chegam na ordem em que foram registrados", async () => {
    const provider = new FakeProvider();
    let recebidos: VectorMemory[] = [];

    @Agent({ provider, prompt: PROMPT, tools: [] })
    class Agente {
      constructor(a: VectorMemory, b: VectorMemory) {
        recebidos = [a, b];
      }
    }

    @Workflow({ steps: [Agente] })
    class Fluxo {}

    const app = Thena.create(Fluxo, {
      memory: [FakeVectorStore, FakeVectorStoreB],
    });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    expect(recebidos).toHaveLength(2);
    expect(recebidos[0].store).toBeInstanceOf(FakeVectorStore);
    expect(recebidos[1].store).toBeInstanceOf(FakeVectorStoreB);
  });

  it("@memory(Store) escolhe pelo tipo, sem depender da ordem", async () => {
    const provider = new FakeProvider();
    let recebido: VectorMemory | undefined;

    @Agent({ provider, prompt: PROMPT, tools: [] })
    class Agente {
      // registrado em segundo, pedido em primeiro
      constructor(@memory(FakeVectorStoreB) b: VectorMemory) {
        recebido = b;
      }
    }

    @Workflow({ steps: [Agente] })
    class Fluxo {}

    const app = Thena.create(Fluxo, {
      memory: [FakeVectorStore, FakeVectorStoreB],
    });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    expect(recebido?.store).toBeInstanceOf(FakeVectorStoreB);
  });

  it("@memory() sem argumento pega o primeiro registrado", async () => {
    const provider = new FakeProvider();
    let recebido: VectorMemory | undefined;

    @Agent({ provider, prompt: PROMPT, tools: [] })
    class Agente {
      constructor(@memory() m: VectorMemory) {
        recebido = m;
      }
    }

    @Workflow({ steps: [Agente] })
    class Fluxo {}

    const app = Thena.create(Fluxo, {
      memory: [FakeVectorStore, FakeVectorStoreB],
    });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    expect(recebido?.store).toBeInstanceOf(FakeVectorStore);
    expect(recebido?.store).not.toBeInstanceOf(FakeVectorStoreB);
  });

  it("o store é instanciado UMA vez e compartilhado por todos os agentes", async () => {
    const provider = new FakeProvider([{ content: "a" }, { content: "b" }]);
    const stores: unknown[] = [];

    @Agent({ provider, prompt: PROMPT, tools: [] })
    class A {
      constructor(@memory() m: VectorMemory) {
        stores.push(m.store);
      }
    }
    @Agent({ provider, prompt: PROMPT, tools: [] })
    class B {
      constructor(@memory() m: VectorMemory) {
        stores.push(m.store);
      }
    }

    @Workflow({ steps: [A, B] })
    class Fluxo {}

    const app = Thena.create(Fluxo, { memory: [FakeVectorStore] });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    expect(stores).toHaveLength(2);
    expect(stores[0]).toBe(stores[1]);
    expect(FakeVectorStore.instancias).toHaveLength(1);
  });
});

describe("remember / recall", () => {
  it("grava usando o embed do provider e cria a collection com a dimensão certa", async () => {
    const provider = new FakeProvider();
    let mem: VectorMemory | undefined;

    @Agent({ provider, prompt: PROMPT, tools: [] })
    class Agente {
      constructor(@memory() m: VectorMemory) {
        mem = m;
      }
    }

    @Workflow({ steps: [Agente] })
    class Fluxo {}

    const app = Thena.create(Fluxo, { memory: [FakeVectorStore] });
    await app.run({ input: { message: "vai" } });

    await mem!.remember("um texto qualquer");
    await app.dispose();

    const store = FakeVectorStore.instancias[0];
    // O FakeProvider devolve um vetor de 3 posições.
    expect(store.collectionCriada).toEqual({ size: 3, distance: "cosine" });
    expect(store.docs).toHaveLength(1);
    expect(store.docs[0].payload).toMatchObject({
      text: "um texto qualquer",
      dataset: "default",
    });
  });

  it("recall filtra pelo dataset e devolve texto e score", async () => {
    const provider = new FakeProvider();
    let mem: VectorMemory | undefined;

    @Agent({ provider, prompt: PROMPT, tools: [] })
    class Agente {
      constructor(@memory() m: VectorMemory) {
        mem = m;
      }
    }

    @Workflow({ steps: [Agente] })
    class Fluxo {}

    const app = Thena.create(Fluxo, { memory: [FakeVectorStore] });
    await app.run({ input: { message: "vai" } });

    await mem!.remember("lembrança", { dataset: "notas" });
    const achados = await mem!.recall("busca", { dataset: "notas", limit: 3 });
    await app.dispose();

    const store = FakeVectorStore.instancias[0];
    expect(store.buscas[0]).toMatchObject({
      limit: 3,
      where: { dataset: "notas" },
      withPayload: true,
    });
    expect(achados[0]).toMatchObject({ text: "lembrança", dataset: "notas" });
  });

  it("dataset null busca em todos — sem filtro", async () => {
    const provider = new FakeProvider();
    let mem: VectorMemory | undefined;

    @Agent({ provider, prompt: PROMPT, tools: [] })
    class Agente {
      constructor(@memory() m: VectorMemory) {
        mem = m;
      }
    }

    @Workflow({ steps: [Agente] })
    class Fluxo {}

    const app = Thena.create(Fluxo, { memory: [FakeVectorStore] });
    await app.run({ input: { message: "vai" } });

    await mem!.remember("x");
    await mem!.recall("busca", { dataset: null });
    await app.dispose();

    const store = FakeVectorStore.instancias[0];
    expect(store.buscas[0].where).toBeUndefined();
  });
});
