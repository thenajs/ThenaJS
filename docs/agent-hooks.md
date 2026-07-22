# AgentHooks

Hooks de ciclo de vida de um agente: métodos **opcionais** que você declara na
classe do agente e o framework chama
nos momentos certos do fluxo. Nada é obrigatório — o runtime chama apenas os que
existirem.

Este documento cobre o **núcleo enxuto** atual:
`beforePrompt`, `beforeTool`, `afterTool`, `afterResponse`, `onError`.

## Interface

```ts
import type { AgentContext, ToolCall, ToolResult } from "@mimir/core";

export interface AgentHooks {
  beforePrompt?(prompt: string, ctx: AgentContext): string | void | Promise<string | void>;
  beforeTool?(call: ToolCall, ctx: AgentContext): ToolCall | void | Promise<ToolCall | void>;
  afterTool?(result: ToolResult, ctx: AgentContext): string | void | Promise<string | void>;
  afterResponse?(response: string, ctx: AgentContext): string | void | Promise<string | void>;
  onError?(error: Error, ctx: AgentContext): string | void | Promise<string | void>;
}
```

`implements AgentHooks` é **opcional** — serve só para tipagem e autocomplete. O
runtime verifica `typeof instance.beforePrompt === "function"` e chama o que
existir.

## Contrato dos transformadores

Os hooks que transformam valores (`beforePrompt`, `afterTool`, `afterResponse`)
seguem uma regra única:

> **retornou um valor → substitui; retornou `undefined` → mantém o original.**

Assim, `async beforePrompt(p) { return p.trim(); }` e `async beforePrompt() {}`
são ambos válidos e previsíveis.

## Ordem de disparo

```
input do passo
     │
     ▼
beforePrompt(prompt, ctx) ─────► prompt'
     │
     ▼
provider.chat(prompt', tools)
     │   se o modelo pede uma tool:
     │      beforeTool(call, ctx) ──► troca args | throw cancela
     │      tool.execute(args')
     │      afterTool(result, ctx) ──► troca output
     ▼
afterResponse(response, ctx) ──► response'
     │
     ▼
ctx.output / ctx.state.history
     │
  (qualquer throw no caminho)
     ▼
onError(error, ctx) ──► retorno vira a saída (fallback)
```

## Hooks

### `beforePrompt(prompt, ctx)`

Transforma o prompt final (prompt do `.md` + input) **antes** de enviar ao
provider. Use para injetar contexto dinâmico, data, dados da `memory`, etc.

```ts
async beforePrompt(prompt: string, ctx: AgentContext) {
  const hoje = new Date().toISOString().slice(0, 10);
  return `${prompt}\n\n[contexto] data=${hoje}`;
}
```

### `beforeTool(call, ctx)`

Intercepta uma tool **antes** de executar. `call` é `{ name, args }` (os `args`
já validados pelo schema).

- Retorne um `ToolCall` novo para **trocar os args**.
- Dê `throw` para **cancelar** a execução da tool.

```ts
async beforeTool(call: ToolCall, ctx: AgentContext) {
  if (call.name === "shell") {
    const { command } = call.args as { command: string };
    if (/\brm\b|sudo/.test(command)) throw new Error(`bloqueado: ${command}`);
  }
  // undefined -> segue com os args originais
}
```

> Um `throw` no `beforeTool` cancela a execução da tool e **propaga** como erro
> do passo — ou seja, cai no `onError` (que pode devolver um fallback). A
> execução da tool acontece dentro do `provider.chat` do engine, mas o erro não
> é engolido: sobe até o agente.

### `afterTool(result, ctx)`

Transforma a saída de uma tool. `result` é `{ name, args, output }`; o retorno
substitui o `output`.

```ts
async afterTool(result: ToolResult, ctx: AgentContext) {
  if (result.output.length > 2000) return result.output.slice(0, 2000) + "\n…(truncado)";
  // undefined -> mantém o output
}
```

### `afterResponse(response, ctx)`

Transforma a resposta final do passo (seja texto do modelo ou saída de tool),
logo antes de gravar em `ctx.output`/`history`.

```ts
async afterResponse(response: string, ctx: AgentContext) {
  return response.trim().replace(/^```[a-z]*\n?|\n?```$/g, "");
}
```

### `onError(error, ctx)`

Trata erros do fluxo padrão. Se retornar um valor, ele vira a saída do agente
(fallback); sem retorno, o erro propaga.

```ts
async onError(error: Error, ctx: AgentContext) {
  ctx.logs.push(`falhou: ${error.message}`);
  return "Não consegui completar agora.";
}
```

## Interação com `run(input, ctx)`

O `run` é o **escape hatch**: se a classe define `run`, ela assume o controle
total do passo e os hooks automáticos **não** são chamados. Use `run` quando
quiser orquestrar você mesmo (várias chamadas ao provider, loop de tool-use,
etc.); use os hooks para estender o fluxo padrão em pontos específicos.

## Exemplo completo

```ts
import { Agent } from "@mimir/core";
import type { AgentContext, ToolCall, ToolResult, AgentHooks } from "@mimir/core";
import { ShellTool } from "@mimir/tools";
import { LocalOllamaProvider } from "../../providers/ollama.provider.js";
import { ReadFileTool } from "../../tools/read-file.tool.js";

@Agent({
  provider: LocalOllamaProvider,
  tools: [ShellTool, ReadFileTool],
  prompt: "./explorer.agent.md",
})
export class ExplorerAgent implements AgentHooks {
  async beforePrompt(prompt: string, ctx: AgentContext) {
    return `${prompt}\n\n[data] ${new Date().toISOString().slice(0, 10)}`;
  }

  async beforeTool(call: ToolCall) {
    if (call.name === "shell") {
      const { command } = call.args as { command: string };
      if (/\brm\b|sudo/.test(command)) throw new Error(`bloqueado: ${command}`);
    }
  }

  async afterTool(result: ToolResult) {
    if (result.output.length > 2000) return result.output.slice(0, 2000) + "\n…(truncado)";
  }

  async afterResponse(response: string) {
    return response.trim();
  }

  async onError(error: Error, ctx: AgentContext) {
    ctx.logs.push(`falhou: ${error.message}`);
    return "Não consegui completar a exploração agora.";
  }
}
```

## Tipos auxiliares

```ts
type AgentContext = PipelineContext & Record<string, unknown>; // ctx com campos livres
type ToolCall     = { name: string; args: unknown };
type ToolResult   = { name: string; args: unknown; output: string };
```

## Roadmap

Segundo passo, aditivo (não quebra nada acima): `onStart`, `onFinish` e
`resolveVariables` (com interpolação `{{variavel}}` no prompt, antes do
`beforePrompt`).
