# ThenaJS

Framework para desenvolvimento de agentes de IA em TypeScript, de forma
declarativa. Cada agente é uma classe de lógica (`.agent.ts`) unida
automaticamente ao seu prompt (`.agent.md`).

O engine de execução (pipeline, providers, tools, contexto e estado) vive no
próprio monorepo, em `@thenajs/agentflow`. O `@thenajs/core` é a camada de DX e
organização por cima dele.

## Monorepo

É um monorepo npm workspaces. `packages/` contém o framework; `src/` é o app do
usuário que o consome.

```text
packages/
  agentflow/       @thenajs/agentflow       engine: pipeline, providers, estado, tools, vetorial
  core/            @thenajs/core            decorators (@Agent/@Workflow/@Tool) + runtime
  tools/           @thenajs/tools           tools prontas (ex.: ShellTool)
  qdrant-client/   @thenajs/qdrant-client   VectorStore para Qdrant, sobre a REST API
  flow/            @thenajs/flow            site local que mostra a execução ao vivo
  cli/             @thenajs/cli             gerador "thena g agent <nome>"

src/                              o app (organização por convenção)
  agents/
    explorer/
      explorer.agent.ts   # só a lógica
      explorer.agent.md   # só o prompt
  tools/                  # tools do usuário
  providers/              # providers do usuário
  workflows/              # workflows do usuário
```

Grafo de dependências: `tools`, `qdrant-client`, `flow` → `core` → `agentflow` → `zod`. Sem dependências
externas privadas — nada de registry/token do GitHub Packages.

## CLI — criar um projeto

O `@thenajs/cli` é instalado globalmente e faz o scaffolding de um projeto novo,
já apontando para os pacotes `@thenajs/*` (publicados no npm público):

```bash
npm install -g @thenajs/cli
thena create my-agent        # cria ./my-agent
cd my-agent
npm install
npm start                    # roda o assistente de exemplo
```

O projeto gerado vem com um agente, um provider, um workflow, `config` (log +
report) e `main.ts` — pronto para editar.

## Desenvolvendo este monorepo

```bash
npm install     # instala e cria os symlinks dos @thenajs/*
npm run build   # tsc -b: compila os pacotes na ordem correta
```

## Criando um agente (dentro de um projeto)

```bash
thena g agent explorer
# no monorepo: npm run thena -- g agent explorer
```

Gera `src/agents/explorer/explorer.agent.ts` e `explorer.agent.md`.

Edite o **`.md`** para escrever o prompt e o **`.ts`** para a lógica. O caminho
do markdown é **obrigatório** no `@Agent` (campo `prompt`); um caminho relativo
como `"./explorer.agent.md"` é resolvido em relação ao arquivo do agente.

### `explorer.agent.ts`

```ts
import { Agent } from "@thenajs/core";
import { ShellTool } from "@thenajs/tools";
import { LocalOllamaProvider } from "../../providers/ollama.provider.js";

@Agent({
  provider: LocalOllamaProvider,
  tools: [ShellTool],
  prompt: "./explorer.agent.md",
})
export class ExplorerAgent {}
```

O `provider` pode ser uma **classe** (instanciada com `new`) ou uma **instância**
já configurada. Cada item de `tools` pode ser uma **classe de tool** ou um objeto
`ToolType`.

## Tools

Uma tool é uma classe decorada com `@Tool({ name, description, schema })`; a
lógica fica no método `execute(input)`. O framework monta a `ToolType` do engine
a partir disso.

```ts
import { Tool } from "@thenajs/core";
import { readFile } from "node:fs/promises";
import { z } from "zod";

@Tool({
  name: "read_file",
  description: "Lê o conteúdo de um arquivo.",
  schema: z.object({ path: z.string() }),
})
export class ReadFileTool {
  async execute({ path }: { path: string }) {
    return readFile(path, "utf8");
  }
}
```

O pacote `@thenajs/tools` já traz a `ShellTool`; tools próprias do app ficam em
`src/tools/`.

Por padrão o `execute` recebe **só os argumentos** já validados pelo schema — o
que mantém a tool trivial de testar. Quando precisar de mais, decore os
parâmetros; a ordem não importa:

```ts
import { Tool, input, context, state } from "@thenajs/core";

async execute(
  @input() { path }: { path: string },   // os argumentos validados
  @context() ctx: AgentContext,           // o contexto da execução
  @state() s: ExplorerState,              // o estado do workflow
) {
  s.arquivosLidos.push(path);
  return readFile(path, "utf8");
}
```

### Quando a tool falha

**Falha de tool é observação, não exceção.** O erro volta para o modelo como
resultado da tool, e ele tem a chance de corrigir no turno seguinte — é o que
faz um loop ReAct funcionar. Vale para as quatro formas de falhar:

| Como falha | O que acontece |
| --- | --- |
| `execute` lança | a mensagem do erro vira a observação |
| `execute` devolve `{ content, isError: true }` | o seu texto vira a observação |
| o modelo chama uma tool que não existe | observação dizendo isso |
| o modelo manda argumentos fora do schema | observação com o erro do zod |

Não há nada para configurar. O nó `tool` do report fica `status: "error"`, o
hook `afterTool` recebe `isError`, e `ctx.turn.toolError` fica `true` — então
`tool_error_rate` é uma contagem de nós, não uma regex sobre o texto.

Devolver `isError` explicitamente é melhor do que deixar lançar, porque você
escolhe o texto que o modelo lê:

```ts
async execute({ path }: { path: string }) {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    return { content: `Não achei "${path}". Confira o caminho.`, isError: true };
  }
}
```

#### Falhas que o modelo não conserta

Um bug no seu código, uma credencial expirada ou um banco fora do ar não
melhoram com retentativa: o modelo não tem como resolver, cada volta custa uma
chamada, e a mensagem original pode carregar coisa que não deveria chegar ao
contexto dele nem ao report em disco. Para esses casos, lance `FatalToolError`:

```ts
import { FatalToolError } from "@thenajs/core";

async execute({ query }: { query: string }) {
  try {
    return await db.query(query);
  } catch (err) {
    // Encerra a run. O erro original fica em `cause`, fora do contexto do modelo.
    throw new FatalToolError("banco indisponível", { cause: err });
  }
}
```

> Com falha virando observação, uma tool quebrada dentro de um loop vira custo
> em vez de erro visível. É por isso que `loop()` vem com `maxFails: 5` ligado
> por padrão — veja [Os freios do loop](#os-freios-do-loop).

### Uma tool chamando um workflow

O construtor da tool pode receber o `WorkflowRuntime` injetado, para disparar
outro workflow:

```ts
import { Tool, WorkflowRuntime } from "@thenajs/core";
import { z } from "zod";
import { DeployWorkflow } from "../workflows/deploy.workflow.js";

@Tool({
  name: "deploy",
  description: "Executa o workflow de deploy.",
  schema: z.object({ repository: z.string() }),
})
export class DeployTool {
  constructor(private readonly runtime: WorkflowRuntime) {}

  async execute(input: { repository: string }) {
    return this.runtime.run(DeployWorkflow, { input });
  }
}
```

## Providers

Um provider é uma classe (normalmente subclasse de um provider do engine) com as
credenciais já configuradas. Veja
[`src/providers/ollama.provider.ts`](src/providers/ollama.provider.ts).

### Parâmetros de amostragem

`sampling` aceita um shape neutro que cada provider traduz para as chaves
nativas. Nada tem default: o que você não informar não é enviado, e o modelo
mantém o comportamento dele.

```ts
import { OllamaProvider } from "@thenajs/core";

export class LocalOllamaProvider extends OllamaProvider {
  constructor() {
    super({
      host: "http://localhost:11434",
      model: "qwen2.5-coder:7b",
      sampling: { temperature: 0, seed: 42, numCtx: 8192 },
      raw: { keep_alive: "30m" }, // escape hatch: chaves cruas no body
    });
  }
}
```

| `SamplingParams` | Ollama | OpenAI |
| --- | --- | --- |
| `temperature` | `options.temperature` | `temperature` |
| `topP` | `options.top_p` | `top_p` |
| `seed` | `options.seed` | `seed` |
| `maxTokens` | `options.num_predict` | `max_tokens` |
| `stop` | `options.stop` | `stop` |
| `topK` | `options.top_k` | — |
| `numCtx` | `options.num_ctx` | — |
| `repeatPenalty` | `options.repeat_penalty` | — |

> **Comece em `temperature: 0`.** Agente não é chat: você quer que a mesma
> entrada produza a mesma decisão de tool. Medimos num `qwen2.5-coder:1.5b`,
> mesma pergunta 3×: sem `sampling`, **3 respostas diferentes**; com
> `temperature: 0` + `seed`, **3 idênticas**. O `seed` só tem efeito junto da
> temperatura baixa. Suba a temperatura depois, por agente, onde quiser variedade.

Um agente pode sobrescrever chave a chave, útil para deixar parte do fluxo
determinística e parte criativa com o mesmo provider:

```ts
@Agent({ provider: LocalOllamaProvider, prompt: "./writer.agent.md",
         sampling: { temperature: 0.8 } })
export class WriterAgent {}
```

### Escrevendo um provider próprio

Qualquer backend vira provider. Tudo o que você precisa sai do `@thenajs/core`,
sem dependência extra:

```ts
import { Providers, pruneUndefined } from "@thenajs/core";
import type {
  ProviderCredentials, RawAssistant, ProviderToolCall,
  ToolType, Message, SamplingParams,
} from "@thenajs/core";

// herda sampling, raw, rescueToolCalls e costPer1kTokens
type Credentials = ProviderCredentials & { apiKey: string; model?: string };

export class AnthropicProvider extends Providers {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(credentials: Credentials) {
    super();
    this.configure(credentials);   // os campos comuns, de uma vez
    this.apiKey = credentials.apiKey;
    this.model = credentials.model ?? "claude-sonnet-5";
  }

  protected async chatInternal(
    tools: ToolType[],
    messages: Message[],
    sampling?: SamplingParams,
  ): Promise<RawAssistant> {
    // traduz messages/tools, mapeia sampling com pruneUndefined,
    // e devolve { content, toolCalls?, usage? }
  }
}
```

`chatInternal` é o **único** método obrigatório. O que a base já faz por você:

| A base garante | Você devolve |
| --- | --- |
| remover blocos de raciocínio (`<think>` e afins) | `content` — o texto como veio |
| resgatar a chamada do texto quando não houver `toolCalls`, e marcar `source` | `toolCalls?` — só as **nativas** |
| validar os args contra o schema e executar a tool | nada — a execução não é sua |
| mesclar o `sampling` do agente sobre o do provider | o mapeamento para as chaves da sua API |
| calcular `costUsd` a partir de `costPer1kTokens` | `usage?` — tokens, se a API reportar |

Opcionalmente sobrescreva `embed(input)` se o backend tiver embeddings (o default
devolve `[]`). Para reaproveitar o parsing de resposta em texto, `parser` e
`normalizeToolCallEnvelope` também são exportados.

> **Credenciais obrigatórias?** `@Agent({ provider })` aceita a **classe** — e
> nesse caso a instancia com `new Provider()`, logo ela precisa de construtor sem
> argumentos. Se o seu provider exige credenciais, passe uma **instância**:
> `@Agent({ provider: new AnthropicProvider({ apiKey }) })`.

> **Nomes:** `ProviderToolCall` (`{ id, name, arguments, source }`) é o que você
> devolve em `toolCalls` — não confunda com o `ToolCall` dos hooks
> (`{ name, args }`). O `ToolCall` do `@thenajs/agentflow` é um alias deprecado
> do primeiro.

### Retry e timeout

Chamadas HTTP falham de formas transitórias. O retry vem **ligado por padrão**:
sem configurar nada, são 3 tentativas com backoff exponencial e *full jitter*.

```ts
super({
  host, model,
  retry: {
    maxAttempts: 3,        // default
    timeoutMs: 120_000,    // sem default — veja abaixo
    initialDelayMs: 500,   // default
    maxDelayMs: 8_000,     // default
    onRetry: (i) => console.warn(`tentativa ${i.attempt} falhou (${i.status})`),
  },
});

super({ host, model, retry: false });   // desliga: uma tentativa só
```

| Situação | Tenta de novo? |
| --- | --- |
| `429` rate limit · `408` · `425` | sim |
| `500` · `502` · `503` · `504` | sim |
| erro de rede, conexão caída, abort por timeout | sim |
| `400` · `401` · `403` · `404` e demais 4xx | **não** — erro de contrato não melhora repetindo |

Um `Retry-After` do servidor vence o backoff calculado. Para uma decisão própria,
passe `isRetryable`.

> ⚠️ **`timeoutMs` não tem default**, de propósito — é o único parâmetro capaz de
> quebrar setup que já funcionava (abortar um modelo local lento que hoje responde
> em 200s). Ligue quando quiser que travamento vire falha recuperável: sem ele,
> uma requisição pendurada só falha no limite do runtime (300s no undici).

> ⚠️ **Custo.** Reexecutar um `5xx` pode cobrar duas vezes se o servidor processou
> a requisição e só a resposta se perdeu; e um 5xx *permanente* gasta as três
> tentativas antes de falhar. Em fluxo sensível a custo, use `maxAttempts: 1`.

O retry **não** infla o `maxChatCalls` de um orçamento — as tentativas são uma
chamada lógica só —, mas as esperas contam no `maxDurationMs`. Quando houve
retry, o nó `chat` do report registra `attempts`.

### Tool calls emitidas como texto

Quando o provider não devolve tool calls nativas, o runtime tenta extrair a
chamada do texto da resposta — o caso comum em modelos locais. São reconhecidos
`<tool_call>…</tool_call>`, blocos markdown e os envelopes que os modelos de
fato emitem (`{name, arguments}`, `{name, parameters}`, `{tool, args}`,
`{function:{…}}`, argumentos como string JSON…).

O nó `chat` do report registra `toolCallSource: "native" | "rescued"`, então dá
para medir o quanto um modelo depende do resgate. Para desligar — e expor que o
modelo não está usando o formato nativo em vez de mascarar:

```ts
super({ host, model, rescueToolCalls: false });
```

## Memória vetorial

Busca semântica: o agente grava textos e recupera por similaridade, não por
ordem. É o par que faltava para o `embed()` dos providers.

> ⚠️ Não confunda com **`ctx.state.memory`**, que é outra coisa: o bucket
> `string[]` de contexto durável projetado como mensagem `system` no prompt.

Registre o store **uma vez** no config. Todo agente que declarar `VectorMemory`
no construtor recebe uma memória sobre ele — mesma conexão, um
`ensureCollection` só, independente de quantos agentes existem:

```ts
// src/vector/qdrant.store.ts
import { QdrantStore } from "@thenajs/qdrant-client";

export class MeuQdrant extends QdrantStore {
  constructor() {
    super({
      url: "http://localhost:6333",
      collection: "conhecimento",
    });
  }
}
```

```ts
// src/config.ts
export const config: ThenaConfig = {
  log: true,
  report: true,
  memory: [MeuQdrant],   // as classes — o framework instancia uma vez cada
};
```

```ts
// qualquer agente — nada a declarar no @Agent
@Agent({
  provider: LocalOllamaProvider,   // o embed() dele gera os vetores
  prompt: "./explorer.agent.md",
})
export class ExplorerAgent {
  constructor(private readonly memory: VectorMemory) {}

  async beforePrompt(prompt: string, ctx: AgentContext) {
    const pergunta = ctx.state.history.at(-1)?.content ?? "";
    const achados = await this.memory.recall(pergunta, {
      dataset: "persistent",
      limit: 3,
      scoreThreshold: 0.5,
    });

    if (!achados.length) return;   // undefined mantém o prompt

    return `${prompt}\n\n## Contexto\n${achados.map((a) => `- ${a.text}`).join("\n")}`;
  }

  async afterResponse(resposta: string) {
    await this.memory.remember(resposta, { dataset: "sessao" });
  }
}
```

Agentes que não usam memória simplesmente não escrevem construtor — o argumento
extra é ignorado. Sem `memory` no config, o parâmetro chega `undefined`.

#### Mais de um store

Uma collection guarda **um tamanho de vetor só**. Se dois agentes usam modelos de
embedding com dimensões diferentes (768 e 1536, por exemplo), eles precisam de
stores separados — basta acrescentar ao array:

```ts
export const config: ThenaConfig = {
  memory: [QdrantNomic, QdrantOpenAI],
};

@Agent({ provider: LocalOllamaProvider, prompt: "./a.agent.md" })   // 768
export class AgenteNomic {
  constructor(private readonly nomic: VectorMemory) {}
}

@Agent({ provider: OpenAIProvider, prompt: "./b.agent.md" })        // 1536
export class AgenteOpenAI {
  constructor(
    private readonly _naoUso: VectorMemory,   // posição 1
    private readonly openai: VectorMemory,    // posição 2
  ) {}
}
```

> ⚠️ **A ordem do array é contrato.** Reordenar troca qual store cada agente usa,
> e o TypeScript não acusa — os parâmetros têm o mesmo tipo `VectorMemory`.
> Acrescente sempre no fim, nunca no meio. Se as dimensões forem incompatíveis o
> erro aparece na primeira escrita; se forem iguais, você grava na collection
> errada em silêncio.

Se você misturar dimensões num store só, a falha é clara e vem antes de gastar o
embedding:

```
[thena] Este store já foi preparado com 768 dimensões, mas agora recebeu
embeddings de 1536. Uma collection aceita um único tamanho de vetor — modelos
de embedding diferentes precisam de stores diferentes.
```

> A injeção é **posicional**, não por tipo. `reflect-metadata` foi evitado de
> propósito: o esbuild (que o `tsx` usa no `npm start`) não emite
> `design:paramtypes`, então DI por tipo compilaria e quebraria em silêncio no dev.

### Datasets

`dataset` é sempre **opcional** — omitido, usa `"default"`:

```ts
await this.memory.remember("um fato solto");             // grava no "default"
await this.memory.recall("pergunta");                    // busca no "default"
await this.memory.recall("pergunta", { dataset: null }); // busca em TODOS
await this.memory.forget({ dataset: "sessao" });         // limpa um dataset
```

Datasets **não** são collections separadas: são um campo do payload com índice
dedicado, que é a recomendação do Qdrant — muitas collections geram overhead, e o
Qdrant Cloud limita a 1000 por cluster. Por isso `dataset: null` consegue buscar
através de todos, o que com collections exigiria N buscas e merge manual.

> ⚠️ A collection guarda um **`size` fixo**, descoberto no primeiro `remember`
> pelo tamanho do vetor (768 com `nomic-embed-text`, 1536 com
> `text-embedding-3-small`). Dois agentes com modelos de embedding de dimensões
> diferentes apontando para o mesmo store vão colidir — o Qdrant recusa. Falha
> barulhenta, que é o certo, mas vale saber.

### Trazendo seu próprio banco

O contrato é o `VectorStore`, e tudo sai do `@thenajs/core`:

```ts
import { VectorStore } from "@thenajs/core";
import type { VectorStoreCredentials, VectorDocument, VectorMatch,
              VectorSearch, CollectionOptions } from "@thenajs/core";

export class PgVectorStore extends VectorStore {
  constructor(credentials: VectorStoreCredentials) {
    super();
    this.configureTransport(credentials);   // ganha retry e timeout
  }

  async ensureCollection(options: CollectionOptions) { /* … */ }
  async collectionExists() { /* … */ return false; }
  async dropCollection() { /* … */ }
  async upsert(docs: VectorDocument[]) { /* … */ }
  async search(params: VectorSearch): Promise<VectorMatch[]> { /* … */ return []; }
  async remove(selector: { ids?: (string | number)[] }) { /* … */ }
}
```

Filtros seguem o mesmo padrão de `sampling` + `raw` dos providers: `where` para
igualdade simples e `rawFilter` para o formato nativo do banco.

### Sem o `@Agent`

`VectorMemory` funciona solto, fora de qualquer agente:

```ts
import { VectorMemory } from "@thenajs/core";

const memoria = new VectorMemory({
  store: new MeuQdrant(),
  provider: new LocalOllamaProvider(),
});

await memoria.remember("o deploy roda pelo scripts/deploy.sh");
const achados = await memoria.recall("como faço deploy?", { limit: 3 });
```

## Executando um agente

```ts
import { run } from "@thenajs/core";
import { ExplorerAgent } from "./agents/explorer/explorer.agent.js";

const output = await run(ExplorerAgent, "Liste os arquivos do diretório atual.");
console.log(output);
```

O `run` monta o `Pipeline`/`StateManager` do engine, instancia provider e tools,
injeta-os na classe e executa. Se a classe define um método `run(input, ctx)`,
ele é usado como lógica; caso contrário, o passo padrão chama `provider.chat`
com o prompt do `.md`.

## Hooks do agente

A classe do agente pode declarar hooks **opcionais** (`beforePrompt`,
`beforeTool`, `afterTool`, `afterResponse`, `onError`) para interceptar e
manipular o fluxo padrão. Veja [docs/concepts/hooks.html](docs/concepts/hooks.html).

Contrato: **retornar um valor substitui, retornar `undefined` mantém**.

```ts
beforePrompt(prompt: string, ctx: AgentContext): string | void
beforeTool(call: ToolCall, ctx: AgentContext): ToolCall | void
afterTool(result: ToolResult, ctx: AgentContext): string | ToolOutput | void
afterResponse(response: string, ctx: AgentContext): string | void
onError(error: Error, ctx: AgentContext): string | void
// todos aceitam Promise<…> também

ToolCall   = { name: string; args: unknown }
ToolResult = { name: string; args: unknown; output: string; isError?: boolean }
ToolOutput = { content: string; isError?: boolean; data?: unknown }
```

> ⚠️ Duas pegadinhas de nome. O `ToolCall` dos hooks usa `args`, não `arguments`
> — e existe um **outro** tipo também chamado `ToolCall`, o do engine
> (`{ id, name, arguments, source }`), que é o que aparece em `ctx.turn` e no
> report. E o `afterTool` recebe um `ToolResult` mas não devolve um: devolva uma
> string (troca só o texto, preserva o `isError`) ou um `ToolOutput` completo.

Dois padrões que aparecem com frequência e que os hooks já resolvem, sem API dedicada:

**A saída de um passo como contexto, não como fala.** Por padrão a resposta de um
agente entra no transcript do próximo como mensagem `assistant`. Para que um
plano vire contexto durável, reescreva o history no próprio agente:

```ts
class PlannerAgent implements AgentHooks {
  afterResponse(plano: string, ctx: AgentContext) {
    // tira o turno do transcript e promove para memória (vira `system` no topo)
    ctx.state.set("history", ctx.state.history.slice(0, -1));
    ctx.state.append("memory", `Plano:\n${plano}`);
    ctx.plan = plano;
  }
}
```

**Cortar uma chamada repetida.** `beforeTool` cancela a execução com um `throw` —
veja o exemplo em [Orçamentos de run](#orçamentos-de-run).

## Workflows

Um workflow orquestra vários agentes num único pipeline do engine que compartilha
o mesmo estado. Os passos ficam em `steps` e podem ser de três tipos, combináveis
e aninháveis:

- **agente** (a classe) → passo sequencial; a saída de um alimenta o próximo;
- **`parallel([...])`** → passos concorrentes sobre o mesmo contexto;
- **`loop({ steps, until, ... })`** → repete até `until(ctx)`, ou até um dos
  freios (`maxFails`, `maxIterations`) — ambos ligados por padrão.

```ts
// src/workflows/explorer.state.ts — o estado desta execução
export class ExplorerState {
  aprovado = false;
  rodadas = 0;
}
```

```ts
// src/workflows/explorer.workflow.ts
import { Workflow, loop } from "@thenajs/core";
import { ExplorerState } from "./explorer.state.js";

@Workflow({
  state: ExplorerState,
  steps: [
    PlannerAgent,
    loop({
      steps: [ExplorerAgent, ReviewerAgent],
      // `true` significa PARAR; o 2º parâmetro é a instância de ExplorerState
      until: (_ctx, s: ExplorerState) => s.aprovado,
      maxIterations: 5,
    }),
  ],
})
export class ExplorerWorkflow {}
```

```ts
// o revisor grava a decisão que o `until` lê
import { Agent, state } from "@thenajs/core";

@Agent({ provider: LocalOllamaProvider, prompt: "./reviewer.agent.md" })
export class ReviewerAgent {
  constructor(@state() private readonly estado: ExplorerState) {}

  async afterResponse(resposta: string) {
    this.estado.rodadas++;
    this.estado.aprovado = /\bAPROVADO\b/i.test(resposta);
  }
}
```

O `state` é instanciado **uma vez por execução** e é a mesma instância em todos
os passos, hooks, tools e no `until`. Sem alguém gravar `aprovado`, a condição
nunca ficaria verdadeira e o loop rodaria até `maxIterations` toda vez.

### Bootstrap

O ponto de entrada da aplicação fica em `src/main.ts`:

```ts
// src/main.ts
import { bootstrapWorkflow } from "@thenajs/core";
import { ExplorerWorkflow } from "./workflows/explorer.workflow.js";

const app = await bootstrapWorkflow(ExplorerWorkflow);

const saida = await app.run({
  input: { message: "Olá" },
  memory: { userId: "123", sessionId: "abc" },
});

console.log(saida);
```

`bootstrapWorkflow(WorkflowClass)` devolve um `app`; `app.run({ input, memory })`
executa o workflow e **devolve** a saída. Um erro **rejeita a promise** — nada é
engolido, nada é impresso e o `process.exitCode` não é tocado: o que fazer com a
falha é decisão da aplicação. Rode com `npm start`.

- **`input.message`** é a entrada inicial do pipeline.
- **`memory`** é o contexto inicial / memória persistente do workflow: é semeado
  em `state.memory` antes da execução e fica disponível para os agentes e para
  os `until` dos loops.

Para obter o resultado sem passar pelo `app`, use `runWorkflow` diretamente:

```ts
import { runWorkflow } from "@thenajs/core";
import { ExplorerWorkflow } from "./workflows/explorer.workflow.js";

const parecer = await runWorkflow(ExplorerWorkflow, "Revise o diretório src/");
```

#### Execuções concorrentes

Cada `run(...)` abre o próprio contexto de execução (`RunContext`): id, config,
recorder e orçamento são dela. Duas execuções em paralelo — do mesmo `app` ou de
apps diferentes no mesmo processo — não se contaminam, o que torna o `app`
utilizável dentro de um servidor:

```ts
const app = await bootstrapWorkflow(ChatWorkflow, config);

server.post("/chat", async (req, res) => {
  res.json({ resposta: await app.run({ input: req.body }) });
});
```

`report` e `log` podem ser sobrescritos por execução, valendo só para aquela run:

```ts
await app.run({ input: { message: "…" }, report: false, log: "verbose" });
```

> No `parallel`, os agentes rodam sobre a **mesma** entrada e todos escrevem em
> `ctx.output` (a última escrita vence); leia os resultados em `ctx.state`.

#### ⚠️ A saída de um step vira fala do próximo agente

O turno de um agente é anexado ao `history` com `role: "assistant"`. Como o
próximo agente lê o mesmo `history`, ele recebe aquilo **como se ele próprio já
tivesse respondido** — e um modelo que "já falou" tende a devolver vazio ou a
encerrar cedo.

É o erro mais silencioso do framework, e aparece no arranjo mais natural:
`steps: [PlannerAgent, loop([OrchestratorAgent])]`. Se a saída é *contexto* (um
plano, um resumo) e não fala, promova-a:

```ts
class PlannerAgent implements AgentHooks {
  afterResponse(plano: string, ctx: AgentContext) {
    ctx.state.set("history", ctx.state.history.slice(0, -1)); // tira do transcript
    ctx.state.append("memory", `Plano a seguir:\n${plano}`);  // vira `system` no topo
    ctx.plan = plano;
  }
}
```

A alternativa, quando o passo precisa de histórico próprio, é isolá-lo atrás de
uma tool — veja [Workflow como Tool](#workflow-como-tool).

#### ⚠️ `untilAnswered` trata resposta vazia como resposta

Ele pergunta uma coisa só: "não chamou tool?". Um modelo local que devolve string
vazia encerra o loop com sucesso aparente. E ele não distingue "terminou" de
"escreveu o que faria em vez de chamar a tool" — os dois dão `calledTool: false`.
Para tarefas de várias etapas, escreva o seu:

```ts
import { turnOf } from "@thenajs/core";

// só encerra se respondeu E disse alguma coisa
const until = (ctx: WorkflowContext) => {
  const t = turnOf(ctx);
  return !!t && !t.calledTool && !!t.response?.trim();
};
```

### Workflow como Tool

Uma tool pode disparar um workflow inteiro. O filho roda com **estado próprio** e
devolve **uma string** ao pai — isolamento de contexto sem escrever nada para isso:

```
agente pai  (histórico enxuto)
 └─ tool ──▶ workflow isolado  (StateManager próprio)
              ├─ 10 turnos de tentativa e erro
              └─ devolve UMA string ao pai
```

Isso importa muito com modelo pequeno: dez turnos de tentativa e erro no
histórico do pai degradam as decisões dele. Passando pelo filho, o pai vê uma linha.

| | sub-agente como **step** | sub-agente como **workflow-tool** |
| --- | --- | --- |
| Histórico | compartilhado com o pai | próprio, isolado |
| A saída vira | mensagem `assistant` | observação `tool` |
| Quem decide se roda | você, na ordem dos `steps` | o modelo, chamando a tool |
| Custo de contexto no pai | todos os turnos do filho | uma string |
| Use quando | é uma conversa só e o pai precisa ver o caminho | a subtarefa é ruidosa, ou só o resultado importa |

O report **aninha** o filho dentro do nó `tool` do pai, então a visibilidade não
se perde. Já o `budget` **não** atravessa: cada `run` tem o próprio contador, e um
teto no pai não soma o consumo dos filhos — se o subworkflow é caro, passe um
`budget` no `runtime.run` dele também.

#### Os freios do loop

Como falha de tool vira observação, um agente preso não morre — ele repete, e
cada volta é uma chamada paga. Por isso **os freios vêm ligados**: um loop sem
teto gasta o cartão de quem usa o framework, e ilimitado não pode ser o default.

| Freio | Default | Pega |
| --- | --- | --- |
| `maxFails` | `5` | agente **preso**, repetindo a mesma falha de tool |
| `maxIterations` | `10` | loop que **não converge**, mesmo sem erro nenhum |
| `budget` da run | — | a execução inteira: tempo, chamadas, tokens, custo |

Os dois primeiros são complementares, e nenhum substitui o outro: `maxFails` só
conta quando há falha; um loop cujo `until` nunca fica verdadeiro e cujas tools
funcionam só é contido por `maxIterations`.

```ts
loop({
  steps: [ExplorerAgent],
  until: untilAnswered,

  maxFails: 3,
  onFail: (ctx, { consecutive, total, toolName }) =>
    logger.warn(`${toolName} falhou ${consecutive}x seguidas (${total} no total)`),

  maxIterations: 10,
  onExhausted: (ctx, n) => console.warn(`[app] loop estourou em ${n} iterações`),
})
```

**`maxFails` conta falhas consecutivas, não totais.** Uma tool que funciona zera
a contagem, então um agente que erra, corrige e avança não é punido:

```
✓ ✗ ✓ ✓ ✗ ✓ ✗ …   40 voltas, 20 falhas espalhadas → agente explorando. Passa.
✗ ✗ ✗ ✗ ✗          5 falhas seguidas              → agente travado. Corta.
```

`onFail` dispara a **cada** falha, não só no corte — é o que dá tempo de alertar
antes. Use `Infinity` em qualquer um dos dois para desligar, se souber por quê.

#### Como saber por que o loop parou

- o nó `loop` do report registra `stoppedBy` (`"until"`, `"exhausted"`,
  `"fails"` ou `"budget"`), além de `iterations` e `fails`;
- `ctx.loop` → `{ iterations, exhausted, maxIterations }`;
- `wasExhausted(ctx)` → helper para ler a exaustão num `until` ou hook.

`stoppedBy` importa porque um loop cortado por `maxFails` tem `exhausted: false`
— sem ele, "convergiu" e "desistiu" ficariam indistinguíveis no report.

Em loops aninhados `ctx.loop` sofre last-writer-wins — para o dado aninhado,
leia a árvore do report.

### Orçamentos de run

`maxIterations` limita um loop; `budget` limita a **execução inteira**:

```ts
await app.run({
  input: { message: "faça o deploy" },
  budget: {
    maxDurationMs: 5 * 60_000,
    maxChatCalls: 30,
    maxToolCalls: 40,
    maxTokens: 200_000,
    maxCostUsd: 1.5,
    mode: "stop", // ou "throw"; default "stop"
    onExceeded: (i) => console.warn(`[app] orçamento estourado: ${i.reason}`),
  },
});
```

- **`"stop"`** encerra graciosamente: os passos seguintes são pulados e a run
  devolve o `output` que já tinha;
- **`"throw"`** lança `BudgetExceededError`.

Sem `budget`, nada é medido nem checado. Os limites são conferidos **entre
unidades de trabalho** (um turno = uma chamada ao modelo + no máximo uma tool),
então o consumo pode passar do teto dentro do turno em que ele é atingido.

`maxTokens` e `maxCostUsd` dependem do que o provider reporta. Tokens vêm de
graça (Ollama e OpenAI já são lidos); custo exige informar o preço, porque não há
tabela embutida para envelhecer em silêncio:

```ts
super({ host, model, costPer1kTokens: { input: 0.0005, output: 0.0015 } });
```

O consumo acumulado fica em **`ctx.budget`** (`chatCalls`, `toolCalls`, `tokens`,
`costUsd`, `elapsedMs`). É a partir daí que se escreve política própria — cortar
uma chamada repetida, aplicar heurística de parada — num `beforeTool` ou num
`until`, sem o framework opinar sobre ela:

```ts
class ExplorerAgent implements AgentHooks {
  private vistas = new Set<string>();

  beforeTool(call: ToolCall) {
    const assinatura = `${call.name}:${JSON.stringify(call.args)}`;
    if (this.vistas.has(assinatura)) {
      throw new Error(`Já chamei ${call.name} com esses argumentos.`);
    }
    this.vistas.add(assinatura);
  }
}
```

## Report de execução

O `bootstrapWorkflow` aceita um `config`. Com `report: true`, ao final da run é
gerado um **report estilo Playwright** (HTML + JSON) em `report/<runId>/`, com a
árvore da execução (`workflow → loop / parallel → agent → chat → tool`), durações,
status e o conteúdo de cada passo (o que foi enviado ao modelo, a resposta, a
decisão de tool e o I/O das tools).

Cada execução grava na **própria subpasta** — execuções concorrentes não
sobrescrevem o report uma da outra — e o `report/index.html` da raiz é o índice
das runs.

```ts
// src/config.ts
import type { ThenaConfig } from "@thenajs/core";

export const config: ThenaConfig = {
  log: true,     // logs ao vivo; ou "verbose", ou (event) => logger.info(event)
  report: true,  // ou { dir: "report", format: "html" | "json" | "both" }
};

// src/main.ts
const app = await bootstrapWorkflow(ExplorerWorkflow, config);
```

Rode `npm start` e abra **`report/index.html`** — o índice das execuções, que
leva ao report de cada uma (HTML autocontido, sem dependências — colapsável via
`<details>`). É **opt-in**: sem `report`, nada é gerado e não há overhead. Não há
serviço/telemetria externa.

Para ver **o que está sendo executado em tempo real**, use `log`: `true` (árvore
indentada no console, com durações), `"verbose"` (inclui o conteúdo) ou uma
função `(event) => void` (sink customizado — pino/winston, arquivo, JSON lines).
Log e report reutilizam a mesma camada de interceptação — uma instrumentação,
dois "outputs".

### O que dá para medir sem regex

Além de duração e status, cada nó carrega metadados estruturados em `data`:

| Nó | Campos |
| --- | --- |
| `workflow` | `chatCalls`, `toolCalls`, `tokens`, `costUsd`, `elapsedMs`, `exceeded` |
| `loop` | `iterations`, `exhausted`, `maxIterations`, `stoppedBy`, `fails` |
| `chat` | `toolCallSource`, `promptTokens`, `completionTokens`, `costUsd` |
| `tool` | `isError` (e `status: "error"` no nó) |

Ou seja: `tool_error_rate` é contar nós `kind: "tool"` com `status: "error"`; a
taxa de resgate é contar `toolCallSource === "rescued"`; e loops que não
convergiram são `exhausted: true`. Nada disso exige parsear o texto de saída.

## Plugins e middlewares

`app.use(...)` acopla comportamento à execução. Um plugin pode **observar**, com
`onEvent`, e/ou **interceptar**, com `tool` e `chat`. Vários coexistem, e nenhum
toma o lugar do outro.

```ts
await app.use(thenaFlow());   // observa: o grafo ao vivo no navegador
```

Um middleware envolve cada execução de tool ou cada chamada ao modelo. A
assinatura é a mesma dos dois lados — sua função recebe a invocação e um
`next()`:

```ts
await app.use({
  name: "cronometro",
  chat: async (inv, next) => {
    const inicio = Date.now();
    const turno = await next();               // chama o modelo de verdade
    inv.meta({ latenciaMs: Date.now() - inicio });
    return turno;
  },
});
```

**Chamar `next()` é seguir a cadeia. Não chamar é responder no lugar dela.** É o
que permite um cache:

```ts
import type { ChatTurn, Message } from "@thenajs/core";

const cache = new Map<string, ChatTurn>();
const chave = (messages: Message[]) => JSON.stringify(messages);

await app.use({
  name: "cache",
  chat: async (inv, next) => {
    const k = chave(inv.messages);

    const guardado = cache.get(k);
    if (guardado) {
      inv.meta({ cacheHit: true });   // aparece no report e no grafo do Flow
      return guardado;                 // o modelo não é chamado
    }

    const turno = await next();
    cache.set(k, turno);
    return turno;
  },
});
```

### O que vem na invocação

| Campo | `tool` | `chat` |
| --- | --- | --- |
| `name` | nome da tool | — |
| `args` | argumentos (mutáveis) | — |
| `messages` / `tools` / `sampling` | — | o que vai para o modelo |
| `ctx` | contexto da execução | idem |
| `run` | `runId`, `settings`, `budget`, `recorder` | idem |
| `meta(dados)` | grava telemetria no nó do report | idem |

### Onde a sua camada entra na cadeia

A posição é contrato, e não é arbitrária:

```
registrarTool          ← observação do framework
  hooksDeTool          ← beforeTool/afterTool do agente
    [ o seu middleware ]
      contarTool       ← orçamento
        [execute]
```

- **Abaixo da observação**, porque um passo que não abre o nó desaparece do
  `report.json` e do grafo do Flow. Um cache que acerta precisa continuar
  visível — só com 4ms em vez de 2s.
- **Acima da contabilidade**, porque quem curto-circuita não gastou nada. Somar
  o `usage` de um turno cacheado cobraria de novo tokens já pagos e furaria o
  `maxCostUsd`.
- **Abaixo dos hooks do agente**, para a sua checagem enxergar os argumentos que
  de fato vão executar — um `beforeTool` que os reescrevesse depois tornaria uma
  autorização contornável.

Vários middlewares rodam na ordem de registro: o primeiro `use()` é o mais
externo.

### Erro num middleware

Diferente de uma tool, um `throw` seu **não** vira observação — ele derruba a
run. O controle é pelo retorno:

```ts
tool: async (inv, next) => {
  if (!podeUsar(inv.ctx.usuario, inv.name)) {
    // observação: o modelo lê e tenta outra coisa
    return { content: `Sem permissão para ${inv.name}.`, isError: true };
  }
  return next();
}
```

> Um middleware **não** pode chamar `next()` duas vezes — a cadeia inteira
> rodaria de novo, incluindo a chamada paga ao modelo. Retry de chamada HTTP já
> existe um nível abaixo, no transporte, com backoff e `Retry-After`.

## Scripts

| Script | O que faz |
| --- | --- |
| `npm run build` | Compila todos os pacotes (`tsc -b`) |
| `npm test` | Roda a suíte (Vitest) contra o código-fonte, sem build |
| `npm run test:watch` | Idem, em modo watch |
| `npm start` | Build + executa o bootstrap (`src/main.ts`) |
| `npm run typecheck` | Build + typecheck do app em `src/` |
| `npm run thena` | Executa a CLI (`-- g agent <nome>`) |

## Publicação

Os pacotes são publicados no **npm público** (scope `@thenajs`, org npm
`thenajs`) pela GitHub Action
[`.github/workflows/publish.yml`](.github/workflows/publish.yml), disparada por
uma tag `v*`:

```bash
# bump da versão nos package.json, então:
git tag v0.1.1 && git push --tags
```

A Action roda `npm ci` → `npm run build` → `npm publish` de cada pacote
(agentflow → core → tools → cli), com provenance. Pré-requisito:

- **Secret `NPM_TOKEN`** (npm automation token com acesso à org `thenajs`) no
  repositório: npmjs.com › _Access Tokens_ › _Generate_ › _Automation_.

> Sendo npm público, qualquer um instala com `npm i @thenajs/core` (ou
> `npm i -g @thenajs/cli`) **sem autenticação** — por isso não há `.npmrc` no
> projeto gerado.
