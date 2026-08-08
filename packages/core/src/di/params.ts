import type { VectorMemory } from "@thenajs/agentflow";
import type { InjectionPoint } from "../decorators/inject.js";
import type { AgentContext } from "../types.js";

/** O que está disponível para injetar num dado momento da execução. */
export interface Injectable {
  workflowState?: object;
  memories: VectorMemory[];
  ctx?: AgentContext;
  args?: unknown;
}

/**
 * Resolve um parâmetro decorado. Falha com mensagem que aponta a classe e o
 * parâmetro — injeção silenciosamente `undefined` é o pior modo de errar aqui.
 */
export function resolvePoint(
  ponto: InjectionPoint,
  d: Injectable,
  onde: string,
  indice: number,
): unknown {
  switch (ponto.kind) {
    case "input":
      return d.args;

    case "context":
      if (!d.ctx) {
        throw new Error(
          `[thena] @context() em ${onde} (parâmetro ${indice}): o contexto ainda ` +
            `não existe quando a classe é construída. Use @context() no execute de ` +
            `uma tool, ou receba o ctx como parâmetro do hook.`,
        );
      }
      return d.ctx;

    case "state":
      if (!d.workflowState) {
        throw new Error(
          `[thena] @state() em ${onde} (parâmetro ${indice}): nenhum estado ` +
            `declarado. Acrescente \`state: MinhaClasse\` no @Workflow.`,
        );
      }
      return d.workflowState;

    case "memory": {
      if (!ponto.store) return d.memories[0];
      const found = d.memories.find((m) => m.store instanceof ponto.store!);
      if (!found) {
        throw new Error(
          `[thena] @memory(${ponto.store.name}) em ${onde}: esse store não está ` +
            `registrado em ThenaConfig.memory.`,
        );
      }
      return found;
    }
  }
}
