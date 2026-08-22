import type { ToolType, VectorMemory } from "@thenajs/agentflow";
import type { InjectionPoint } from "../decorators/inject.js";
import type { AgentContext } from "../types.js";

/** O que está disponível para injetar num dado momento da execução. */
export interface Injectable {
  workflowState?: object;
  memories: VectorMemory[];
  ctx?: AgentContext;
  args?: unknown;
  /** As tools do agente, já embrulhadas. Só existe durante o `execute`. */
  peers?: ToolType[];
}

/**
 * Resolve um parâmetro decorado. Falha com mensagem que aponta a classe e o
 * parâmetro — injeção silenciosamente `undefined` é o pior modo de errar aqui.
 */
export function resolvePoint(
  point: InjectionPoint,
  d: Injectable,
  where: string,
  index: number,
): unknown {
  switch (point.kind) {
    case "input":
      return d.args;

    case "context":
      if (!d.ctx) {
        throw new Error(
          `[thena] @context() in ${where} (parameter ${index}): the context ` +
            `does not exist yet when the class is constructed. Use @context() ` +
            `in a tool's execute, or take ctx as a hook parameter.`,
        );
      }
      return d.ctx;

    case "state":
      if (!d.workflowState) {
        throw new Error(
          `[thena] @state() in ${where} (parameter ${index}): no state ` +
            `declared. Add \`state: MyClass\` to the @Workflow.`,
        );
      }
      return d.workflowState;

    case "tools":
      if (!d.peers) {
        throw new Error(
          `[thena] @tools() in ${where} (parameter ${index}): the tool list ` +
            `does not exist yet when the class is constructed — the tools are ` +
            `wrapped per step invocation. Use @tools() in a tool's execute.`,
        );
      }
      return d.peers;

    case "memory": {
      if (!point.store) return d.memories[0];
      const found = d.memories.find((m) => m.store instanceof point.store!);
      if (!found) {
        throw new Error(
          `[thena] @memory(${point.store.name}) in ${where}: that store is not ` +
            `registered in ThenaConfig.stores.`,
        );
      }
      return found;
    }
  }
}
