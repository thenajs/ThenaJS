# MimirJs

Framework para desenvolvimento de agentes de IA em TypeScript, de forma
declarativa. Cada agente é uma classe de lógica (`.agent.ts`) unida
automaticamente ao seu prompt (`.agent.md`).

O engine de execução (pipeline, providers, tools, contexto e estado) vive no
próprio monorepo, em `@mimir/agentflow`. O `@mimir/core` é a camada de DX e
organização por cima dele.

## Monorepo

É um monorepo npm workspaces. `packages/` contém o framework; `src/` é o app do
usuário que o consome.

```text
packages/
  agentflow/   @mimir/agentflow   engine: pipeline, providers, estado, tools
  core/        @mimir/core        decorators (@Agent/@Workflow/@Tool) + runtime
  tools/       @mimir/tools       tools prontas (ex.: ShellTool)
  cli/         @mimir/cli         gerador "mimir g agent <nome>"

src/                              o app (organização por convenção)
  agents/
    explorer/
      explorer.agent.ts   # só a lógica
      explorer.agent.md   # só o prompt
  tools/                  # tools do usuário
  providers/              # providers do usuário
  workflows/              # workflows do usuário
```

Grafo de dependências: `core`, `tools` → `agentflow` → `zod`. Sem dependências
externas privadas — nada de registry/token do GitHub Packages.

## Instalação

```bash
npm install     # instala e cria os symlinks dos @mimir/*
npm run build   # tsc -b: compila os pacotes na ordem correta
```

## Criando um agente

```bash
npx mimir g agent explorer
# ou: npm run mimir -- g agent explorer
```

Gera `src/agents/explorer/explorer.agent.ts` e `explorer.agent.md`.

Edite o **`.md`** para escrever o prompt e o **`.ts`** para a lógica. O caminho
do markdown é **obrigatório** no `@Agent` (campo `prompt`); um caminho relativo
como `"./explorer.agent.md"` é resolvido em relação ao arquivo do agente.

### `explorer.agent.ts`

```ts
import { Agent } from "@mimir/core";
import { ShellTool } from "@mimir/tools";
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
import { Tool } from "@mimir/core";
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

O pacote `@mimir/tools` já traz a `ShellTool`; tools próprias do app ficam em
`src/tools/`.

### Uma tool chamando um workflow

O construtor da tool pode receber o `WorkflowRuntime` injetado, para disparar
outro workflow:

```ts
import { Tool, WorkflowRuntime } from "@mimir/core";
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

## Executando um agente

```ts
import { run } from "@mimir/core";
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
manipular o fluxo padrão. Veja [docs/agent-hooks.md](docs/agent-hooks.md).

## Workflows

Um workflow orquestra vários agentes num único pipeline do engine que compartilha
o mesmo estado. Os passos ficam em `steps` e podem ser de três tipos, combináveis
e aninháveis:

- **agente** (a classe) → passo sequencial; a saída de um alimenta o próximo;
- **`parallel([...])`** → passos concorrentes sobre o mesmo contexto;
- **`loop({ steps, until, maxIterations })`** → repete até `until(ctx)` ou o limite.

```ts
// src/workflows/explorer.workflow.ts
import { Workflow, parallel, loop } from "@mimir/core";
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
import { bootstrapWorkflow } from "@mimir/core";
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
import { runWorkflow } from "@mimir/core";
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

## Report de execução

O `bootstrapWorkflow` aceita um `config`. Com `report: true`, ao final da run é
gerado um **report estilo Playwright** (HTML + JSON) em `report/`, com a
árvore da execução (`workflow → loop / parallel → agent → chat → tool`), durações,
status e o conteúdo de cada passo (o que foi enviado ao modelo, a resposta, a
decisão de tool e o I/O das tools).

```ts
// src/config.ts
import type { MimirConfig } from "@mimir/core";

export const config: MimirConfig = {
  report: true, // ou { dir: "report", format: "html" | "json" | "both" }
};

// src/main.ts
const app = await bootstrapWorkflow(ExplorerWorkflow, config);
```

Rode `npm start` e abra **`report/index.html`** (HTML autocontido, sem
dependências — colapsável via `<details>`). É **opt-in**: sem `report`, nada é
gerado e não há overhead. Não há serviço/telemetria externa.

## Scripts

| Script | O que faz |
| --- | --- |
| `npm run build` | Compila todos os pacotes (`tsc -b`) |
| `npm start` | Build + executa o bootstrap (`src/main.ts`) |
| `npm run typecheck` | Build + typecheck do app em `src/` |
| `npm run mimir` | Executa a CLI (`-- g agent <nome>`) |
