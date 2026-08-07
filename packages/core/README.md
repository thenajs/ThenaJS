# @thenajs/core

A camada de DX do [ThenaJS](https://github.com/thenajs/ThenaJS): os decorators
`@Agent`, `@Workflow` e `@Tool`, mais o runtime que os executa sobre o
[`@thenajs/agentflow`](https://www.npmjs.com/package/@thenajs/agentflow).

É o único pacote que a maioria dos projetos importa.

```bash
npm install @thenajs/core zod
```

> `zod` é **peerDependency**: o schema das suas tools tem que vir da mesma
> instância que o framework usa para gerar o JSON Schema.

## Um agente

Um agente é uma classe com o prompt num markdown ao lado:

```
src/agents/explorer/
  explorer.agent.ts   ← a lógica
  explorer.agent.md   ← o prompt
```

```ts
import { Agent } from "@thenajs/core";
import { LocalOllama } from "../../providers/ollama.provider.js";

@Agent({
  provider: LocalOllama,
  tools: [ReadFileTool],
  prompt: "./explorer.agent.md",
})
export class ExplorerAgent {}
```

## Um workflow

```ts
import { Workflow, loop, untilAnswered } from "@thenajs/core";

@Workflow({
  steps: [
    PlannerAgent,
    loop({ steps: [ExplorerAgent], until: untilAnswered }),
  ],
})
export class ExplorerWorkflow {}
```

```ts
const app = Thena.create(ExplorerWorkflow, { log: true, report: true });
console.log(await app.run({ input: { message: "Revise o diretório src/" } }));
```

## O que este pacote garante

| | |
| --- | --- |
| **Execuções isoladas** | Cada `run()` tem o próprio contexto — id, config, recorder e orçamento. Chamadas concorrentes, inclusive num handler HTTP, não se contaminam. |
| **Teto por padrão** | `maxIterations: 10` e `maxFails: 5` vêm ligados; `budget` limita tempo, chamadas, tokens e custo da run inteira. |
| **Falha de tool é observação** | O erro volta para o modelo, que corrige no turno seguinte. Para o que ele não conserta, `FatalToolError`. |
| **Observabilidade embutida** | Report HTML+JSON por execução e um stream de eventos para plugins — sem serviço externo. |
| **Erro que diz o conserto** | As mensagens nomeiam a classe, o parâmetro e o que fazer. |

## API

**Decorators** — `@Agent`, `@Workflow`, `@Tool`

**Injeção por parâmetro** — `@input()`, `@context()`, `@state()`, `@memory(Store)`

**Passos** — `loop`, `parallel`, `untilAnswered`, `calledTool`, `turnOf`, `wasExhausted`

**Execução** — `Thena.create`, `runWorkflow`, `run`, `WorkflowRuntime`

**Erros** — `FatalToolError`, `BudgetExceededError`

**Extensão** — `ThenaPlugin` com `onEvent` (observar) e `tool` / `chat` (interceptar)

Os blocos do engine (`Providers`, `OllamaProvider`, `OpenAIProvider`,
`VectorStore`, `VectorMemory`, `Pipeline`, `StateManager`) são reexportados por
conveniência — não é preciso depender do `@thenajs/agentflow` diretamente.

## Documentação

A referência completa — hooks, providers próprios, memória vetorial,
orçamentos, report e as armadilhas conhecidas — está no
[README do monorepo](https://github.com/thenajs/ThenaJS#readme) e em
<https://thenajs.github.io>.

## Requisitos

Node ≥ 20. TypeScript com `experimentalDecorators: true`.

## Licença

MIT
