# @thenajs/agentflow

O engine de execução do [ThenaJS](https://github.com/thenajs/ThenaJS): pipeline,
providers, estado, tools e memória vetorial.

**Você provavelmente não quer instalar este pacote diretamente.** Use o
[`@thenajs/core`](https://www.npmjs.com/package/@thenajs/core), que reexporta
tudo o que é público daqui e acrescenta os decorators e o runtime.

```bash
npm install @thenajs/agentflow zod
```

> `zod` é **peerDependency**: o schema das tools tem que vir da mesma instância
> que o engine usa para gerar o JSON Schema.

## O que ele é

Este pacote **não conhece política**. Ele oferece o mecanismo; quem decide o que
fazer com ele é a camada de cima. É o motivo de `ToolOutput` ter um campo
`isError` em vez de o engine decidir se um erro derruba a execução.

| Módulo | O quê |
| --- | --- |
| `Pipeline` | Encadeia passos, com os combinadores `parallel` e `loop` |
| `StateManager` | `history`, `tasks` e `memory`, projetados nas mensagens que o modelo lê |
| `Providers` | Classe base dos providers, com `OllamaProvider` e `OpenAIProvider` |
| `HttpTransport` | `fetch` com retry, backoff com *full jitter* e `Retry-After` |
| `VectorStore` / `VectorMemory` | Contrato de banco vetorial e a memória semântica sobre ele |
| `ToolType` | O formato de tool que o provider executa |

## Escrever um provider

Implemente **um** método. A classe base cuida do resto — remove blocos de
raciocínio, decide entre tool call nativa e resgatada do texto, valida os
argumentos contra o schema, executa a tool, calcula o custo e aplica o retry.

```ts
import { Providers } from "@thenajs/agentflow";
import type {
  Message,
  ProviderCredentials,
  RawAssistant,
  SamplingParams,
  ToolType,
} from "@thenajs/agentflow";

type MinhasCredentials = ProviderCredentials & { apiKey: string };

export class MeuProvider extends Providers {
  constructor(credentials: MinhasCredentials) {
    super();
    this.configure(credentials); // absorve sampling, raw, retry, custo…
  }

  protected async chatInternal(
    tools: ToolType[],
    messages: Message[],
    sampling?: SamplingParams,
  ): Promise<RawAssistant> {
    const { response, attempts } = await this.request(url, { /* … */ });
    const data = await response.json();
    return { content: data.text, usage: { /* … */ }, attempts };
  }
}
```

Use `this.request()` no lugar do `fetch` — é o que faz sua implementação herdar
retry e timeout sem código.

## Escrever um banco vetorial

Mesmo modelo: estenda `VectorStore`, implemente as seis operações, e o
transporte vem de graça. O `@thenajs/qdrant-client` é a implementação de
referência.

## Resgate de tool call

Modelos locais raramente acertam o formato nativo. Quando o provider não devolve
tool calls prontas, o engine tenta extrair uma do texto — cinco estratégias em
cascata, da mais específica para a mais permissiva, mais a normalização de
envelope (`{name, parameters}`, `{function:{…}}`, `<tool_call>…`, arrays,
argumentos como string JSON).

A chamada resgatada só vale se o nome for de uma tool registrada, e o turno é
marcado com `toolCallSource: "rescued"` — dá para medir o quanto um modelo
depende disso.

Desligue com `rescueToolCalls: false` nas credentials para diagnosticar.

## Requisitos

Node ≥ 20.

## Licença

MIT
