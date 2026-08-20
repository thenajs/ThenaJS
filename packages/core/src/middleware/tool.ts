import { toToolOutput } from "@thenajs/agentflow";
import type { ToolOutput } from "@thenajs/agentflow";
import { BudgetExceededError } from "../budget.js";
import type { ExecutionNode } from "../observability/recorder.js";
import type { RunContext } from "../run-context.js";
import { FatalToolError } from "../tool-error.js";
import type { AgentContext, ToolCall } from "../types.js";
import type { Middleware } from "./compose.js";

/** A execução de uma tool, atravessando a cadeia. */
export interface ToolInvocation {
  readonly name: string;
  /** Mutável de propósito: o `beforeTool` pode trocar os argumentos. */
  args: unknown;
  /** A instância do agente — de onde saem os hooks. */
  readonly agent: any;
  readonly ctx: AgentContext;
  readonly run: RunContext;
  /**
   * Grava telemetria no nó deste passo: aparece no `report.json` e no payload
   * do nó no grafo do Flow. É como um middleware conta o que fez — sem isso,
   * um cache que acerta em 4ms só pode ser **deduzido** pela duração.
   *
   * No-op quando não há observação ativa (sem `report`, `log` nem plugin).
   */
  meta(data: Record<string, unknown>): void;
  /** @internal Preenchido pelo `registrarTool` quando o nó é aberto. */
  node?: ExecutionNode;
}

export type ToolMiddleware = Middleware<ToolInvocation, ToolOutput>;

/**
 * Abre o nó `tool` do report e grava I/O e status ao final.
 *
 * É o mais externo: o nó cobre tudo, inclusive os hooks. E lê `inv.args` só
 * **depois** do `next()`, então registra os argumentos já trocados por um
 * `beforeTool`, não os originais.
 */
export const recordTool: ToolMiddleware = (inv, next) =>
  inv.run.recorder.around("tool", inv.name, async (node) => {
    // A partir daqui o `inv.meta(...)` das camadas de dentro tem onde escrever.
    inv.node = node;

    const result = await next();

    inv.run.recorder.capture(node, {
      input: JSON.stringify(inv.args),
      output: result.content,
    });
    inv.run.recorder.meta(node, { isError: result.isError });
    if (result.isError) inv.run.recorder.markError(node, result.content);

    return result;
  });

/**
 * `beforeTool` antes, `afterTool` depois — a forma da cebola é exatamente a
 * dos dois hooks.
 *
 * Um `throw` no `beforeTool` **cancela** a execução: `next()` nunca é chamado,
 * então nem o contador nem a tool rodam. É o cancelamento documentado.
 */
export const toolHooks: ToolMiddleware = async (inv, next) => {
  const { agent, ctx } = inv;

  if (typeof agent.beforeTool === "function") {
    const call: ToolCall = { name: inv.name, args: inv.args };
    const rewritten = await agent.beforeTool(call, ctx);
    if (rewritten !== undefined) inv.args = rewritten.args;
  }

  let result = await next();

  if (typeof agent.afterTool === "function") {
    const replacement = await agent.afterTool(
      {
        name: inv.name,
        args: inv.args,
        output: result.content,
        isError: result.isError,
      },
      ctx,
    );
    // String substitui só o texto (preserva o `isError`); para mudar a marca
    // de erro, o hook devolve um `ToolOutput` completo.
    if (replacement !== undefined) {
      result =
        typeof replacement === "string"
          ? { ...result, content: replacement }
          : toToolOutput(replacement);
    }
  }

  return result;
};

/** Conta a execução no orçamento da run. */
export const countTool: ToolMiddleware = (inv, next) => {
  inv.run.budget.addTool();
  return next();
};

/**
 * Falha de tool é **observação**: o texto do erro volta para o modelo, que tem
 * a chance de corrigir no turno seguinte.
 *
 * Três coisas não são "a tool falhou" e por isso continuam subindo:
 *
 * - `FatalToolError` — a tool declarando que a falha não é recuperável;
 * - `BudgetExceededError` — o teto da run estourou. Virar observação seria
 *   entregar ao modelo, como texto, o aviso de que não há mais orçamento — e
 *   deixá-lo tentar de novo, gastando o que já não existe;
 * - **cancelamento** — quem mandou parar não quer que a run siga com "a tool
 *   falhou, tente outra coisa" no histórico.
 *
 * Os dois últimos só apareciam por aqui quando uma tool dispara um
 * sub-workflow: é lá dentro que o checkpoint de orçamento e o de abort rodam,
 * e a exceção deles atravessa o `execute` da tool na volta.
 *
 * Envolve só o centro da cadeia — um `throw` vindo de um hook continua subindo.
 */
export const toolErrorPolicy: ToolMiddleware = async (inv, next) => {
  try {
    return await next();
  } catch (err) {
    if (err instanceof FatalToolError) throw err;
    if (err instanceof BudgetExceededError) throw err;
    // O `reason` de um abort é livre (`controller.abort(qualquerCoisa)`), então
    // a pergunta certa é sobre o signal, não sobre o tipo do erro.
    if (inv.run.signal?.aborted) throw err;
    return {
      content: (err as Error)?.message ?? String(err),
      isError: true,
    };
  }
};

/**
 * Monta a cadeia, encaixando os middlewares do usuário na posição certa.
 *
 * ```
 * registrarTool          ← roda SEMPRE: sem ele o passo some do report e do Flow
 *   hooksDeTool          ← o `beforeTool` do agente dá a última palavra nos args
 *     [ do usuário ]     ← aqui
 *       contarTool       ← só conta o que foi de fato gasto
 *         políticaDeErro
 *           [execute]
 * ```
 *
 * A posição não é arbitrária. **Acima do `contarTool`**, porque um middleware
 * que curto-circuita (cache) não gastou nada e não pode somar no orçamento —
 * senão o `maxCostUsd` fura. **Abaixo do `registrarTool`**, porque um passo que
 * não abre o nó desaparece do grafo, e um report que omite chamadas é pior que
 * report nenhum. E **abaixo do `hooksDeTool`**, para a checagem enxergar os
 * argumentos que realmente vão executar — um `beforeTool` que os reescreve
 * depois de uma autorização a tornaria contornável.
 */
export function toolChain(usuario: ToolMiddleware[] = []): ToolMiddleware[] {
  return [recordTool, toolHooks, ...usuario, countTool, toolErrorPolicy];
}
