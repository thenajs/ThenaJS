import type { VectorMemory } from "@thenajs/agentflow";
import type { PontoDeInjecao } from "../decorators/inject.js";
import type { AgentContext } from "../types.js";

/** O que está disponível para injetar num dado momento da execução. */
export interface Disponivel {
  estado?: object;
  memorias: VectorMemory[];
  ctx?: AgentContext;
  args?: unknown;
}

/**
 * Resolve um parâmetro decorado. Falha com mensagem que aponta a classe e o
 * parâmetro — injeção silenciosamente `undefined` é o pior modo de errar aqui.
 */
export function resolverPonto(
  ponto: PontoDeInjecao,
  d: Disponivel,
  onde: string,
  indice: number,
): unknown {
  switch (ponto.tipo) {
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
      if (!d.estado) {
        throw new Error(
          `[thena] @state() em ${onde} (parâmetro ${indice}): nenhum estado ` +
            `declarado. Acrescente \`state: MinhaClasse\` no @Workflow.`,
        );
      }
      return d.estado;

    case "memory": {
      if (!ponto.store) return d.memorias[0];
      const achada = d.memorias.find((m) => m.store instanceof ponto.store!);
      if (!achada) {
        throw new Error(
          `[thena] @memory(${ponto.store.name}) em ${onde}: esse store não está ` +
            `registrado em ThenaConfig.memory.`,
        );
      }
      return achada;
    }
  }
}
