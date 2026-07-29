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

Grafo de dependências: `tools`, `qdrant-client` → `core` → `agentflow` → `zod`. Sem dependências
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

> ⚠️ O `execute` recebe **só os argumentos** já validados pelo schema — não
> enxerga `ctx`, `history` nem `memory`. Injeção acontece no construtor, e a
> única dependência injetável é o `WorkflowRuntime`. Para dar contexto a uma
> tool: coloque nos args, rederive dentro dela, ou use
> [Workflow como Tool](#workflow-como-tool).

### Sinalizando falha

Devolver uma `string` continua sendo o caminho normal. Para marcar que a
observação é um erro — sem lançar e sem derrubar a run — devolva um `ToolOutput`:

```ts
async execute({ path }: { path: string }) {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    return { content: `Falhou: ${(err as Error).message}`, isError: true };
  }
}
```

O nó `tool` do report fica `status: "error"`, o hook `afterTool` recebe
`isError`, e `ctx.turn.toolError` fica `true`. Com isso `tool_error_rate` é uma
contagem de nós, não uma regex sobre o texto de saída.

Uma tool que **lança** continua derrubando a run por padrão. Se preferir que o
erro volte ao modelo como observação, ligue a política no config:

```ts
export const config: ThenaConfig = { toolErrors: "observe" }; // default: "throw"
```

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
      datasets: ["persistent", "sessao"],   // opcional: valida os nomes
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
await ctx.memory.remember("um fato solto");             // grava no "default"
await ctx.memory.recall("pergunta");                    // busca no "default"
await ctx.memory.recall("pergunta", { dataset: null }); // busca em TODOS
await ctx.memory.forget({ dataset: "sessao" });         // limpa um dataset
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
- **`loop({ steps, until, maxIterations, onExhausted })`** → repete até `until(ctx)` ou o limite.

```ts
// src/workflows/explorer.workflow.ts
import { Workflow, parallel, loop } from "@thenajs/core";
import { ExplorerAgent } from "../agents/explorer/explorer.agent.js";
import { PlannerAgent } from "../agents/planner/planner.agent.js";
import { ReviewerAgent } from "../agents/reviewer/reviewer.agent.js";

@Workflow({
  steps: [
    PlannerAgent,
    loop({
      maxIterations: 5,
      until: (ctx) => ctx.reviewApproved,
      steps: [
        parallel([ExplorerAgent, ReviewerAgent]),
      ],
    }),
  ],
})
export class CodeReviewWorkflow {}
```

### Bootstrap

O ponto de entrada da aplicação fica em `src/main.ts`:

```ts
// src/main.ts
import { bootstrapWorkflow } from "@thenajs/core";
import { ExplorerWorkflow } from "./workflows/explorer.workflow.js";

const app = await bootstrapWorkflow(ExplorerWorkflow);

await app.run({
  input: { message: "Olá" },
  memory: { userId: "123", sessionId: "abc" },
});
```

`bootstrapWorkflow(WorkflowClass)` devolve um `app`; `app.run({ input, memory })`
executa o workflow, imprime a saída final e, em erro, loga e marca
`exitCode = 1`. Rode com `npm start`.

- **`input.message`** é a entrada inicial do pipeline.
- **`memory`** é o contexto inicial / memória persistente do workflow: é semeado
  em `state.memory` antes da execução e fica disponível para os agentes e para
  os `until` dos loops.

Para obter o resultado no código, use `runWorkflow` diretamente:

```ts
import { runWorkflow } from "@thenajs/core";
import { ExplorerWorkflow } from "./workflows/explorer.workflow.js";

const parecer = await runWorkflow(ExplorerWorkflow, "Revise o diretório src/");
```

> A condição do `loop` lê campos que os agentes gravam no contexto (ex.:
> `ctx.reviewApproved`). Para isso um agente precisa de lógica própria — um
> método `run(input, ctx)` que faça `ctx.reviewApproved = ...`. Sem isso, o
> `loop` roda até `maxIterations`.
>
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

#### Quando o loop estoura

Parar por `maxIterations` é diferente de convergir, e o framework diz qual dos
dois aconteceu:

```ts
loop({
  steps: [ExplorerAgent],
  until: untilAnswered,
  maxIterations: 10,
  onExhausted: (ctx, n) => console.warn(`[app] loop estourou em ${n} iterações`),
})
```

- `ctx.loop` → `{ iterations, exhausted, maxIterations }`;
- `wasExhausted(ctx)` → helper para ler isso num `until` ou hook;
- o nó `loop` do report registra `iterations` e `exhausted`.

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
gerado um **report estilo Playwright** (HTML + JSON) em `report/`, com a
árvore da execução (`workflow → loop / parallel → agent → chat → tool`), durações,
status e o conteúdo de cada passo (o que foi enviado ao modelo, a resposta, a
decisão de tool e o I/O das tools).

```ts
// src/config.ts
import type { ThenaConfig } from "@thenajs/core";

export const config: ThenaConfig = {
  log: true,          // logs ao vivo; ou "verbose", ou (event) => logger.info(event)
  report: true,       // ou { dir: "report", format: "html" | "json" | "both" }
  toolErrors: "throw" // ou "observe" — erro de tool volta ao modelo (default: "throw")
};

// src/main.ts
const app = await bootstrapWorkflow(ExplorerWorkflow, config);
```

Rode `npm start` e abra **`report/index.html`** (HTML autocontido, sem
dependências — colapsável via `<details>`). É **opt-in**: sem `report`, nada é
gerado e não há overhead. Não há serviço/telemetria externa.

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
| `loop` | `iterations`, `exhausted`, `maxIterations` |
| `chat` | `toolCallSource`, `promptTokens`, `completionTokens`, `costUsd` |
| `tool` | `isError` (e `status: "error"` no nó) |

Ou seja: `tool_error_rate` é contar nós `kind: "tool"` com `status: "error"`; a
taxa de resgate é contar `toolCallSource === "rescued"`; e loops que não
convergiram são `exhausted: true`. Nada disso exige parsear o texto de saída.

## Scripts

| Script | O que faz |
| --- | --- |
| `npm run build` | Compila todos os pacotes (`tsc -b`) |
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
