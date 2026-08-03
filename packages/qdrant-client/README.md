# @thenajs/qdrant-client

Cliente [Qdrant](https://qdrant.tech) nativo para [ThenaJS](https://github.com/thenajs/ThenaJS) —
implementação de `VectorStore` sobre a API REST. Sem SDK: `fetch` puro, herdando o retry e o
timeout do transporte do framework.

> **Requer Qdrant 1.10 ou superior.** O endpoint unificado `/points/query`, que o cliente usa
> para buscar, estreou nessa versão.

## Instalação

```bash
npm install @thenajs/qdrant-client
```

## Uso

```ts
import { QdrantStore } from "@thenajs/qdrant-client";

export class MeuQdrant extends QdrantStore {
  constructor() {
    super({
      url: "http://localhost:6333",
      collection: "conhecimento",
      retry: { maxAttempts: 3, timeoutMs: 10_000 },
    });
  }
}
```

Registre uma vez no config:

```ts
export const config: ThenaConfig = {
  memory: [MeuQdrant],
};
```

E injete em qualquer agente:

```ts
@Agent({
  provider: LocalOllamaProvider,   // o embed() dele gera os vetores
  prompt: "./assistente.agent.md",
})
export class Assistente {
  constructor(private readonly memory: VectorMemory) {}

  async beforePrompt(prompt: string) {
    const achados = await this.memory.recall("como faço deploy?", {
      dataset: "persistent",
      limit: 3,
    });
    return `${prompt}\n\n${achados.map((a) => `- ${a.text}`).join("\n")}`;
  }
}
```

Documentação completa em [thenajs.github.io](https://thenajs.github.io/concepts/memory.html).

## Credentials

| Campo | Default | O que faz |
| --- | --- | --- |
| `url` | — | Endereço do Qdrant (obrigatório) |
| `apiKey` | — | Header `api-key`, para Qdrant Cloud |
| `collection` | `"thena_memory"` | A collection onde tudo é gravado |
| `datasetField` | `"dataset"` | Campo do payload que particiona |
| `retry` | ligado | Política de retry/timeout do `HttpTransport` |

## Uma collection, vários contextos

O `dataset` **não** vira collection. É um campo do payload, com índice dedicado — que é a
recomendação do próprio Qdrant: muitas collections geram overhead de recursos, e o Qdrant Cloud
limita a 1000 por cluster.

Na prática isso significa que dá para buscar dentro de um contexto ou através de todos:

```ts
await this.memory.recall("pergunta", { dataset: "persistent" });  // um dataset
await this.memory.recall("pergunta");                             // o "default"
await this.memory.recall("pergunta", { dataset: null });          // todos
```

Em Qdrant 1.12+, o índice é criado com `is_tenant: true`, que co-loca os pontos do mesmo dataset
em disco. Em versões anteriores o cliente cai para o índice `keyword` simples — funciona igual,
só sem essa otimização.

## Licença

MIT
