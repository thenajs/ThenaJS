import type { ToolType } from "@thenajs/agentflow";
import { getToolMetadata } from "../decorators/metadata.js";
import { pointsOf } from "../decorators/inject.js";
import type { InjectionPoint } from "../decorators/inject.js";
import type { ToolClass, ToolInput } from "../types.js";

/** Onde o plano de injeção do `execute` viaja até o ponto que tem o ctx. */
export const PLAN = Symbol("thena:plano-de-injecao");

export interface InjectionPlan {
  instance: any;
  points: (InjectionPoint | undefined)[];
  name: string;
}

/**
 * Objeto `ToolType` é usado direto; classe `@Tool` vira `ToolType` com DI.
 *
 * `criarRuntime` é injetado pelo chamador em vez de importado: é o que mantém
 * esta camada sem nenhuma dependência de `runtime/` — uma tool pode disparar um
 * workflow, e um workflow contém tools, então importar direto criaria ciclo.
 */
export function resolveTool(input: ToolInput, createRuntime: () => unknown): ToolType {
  if (typeof input !== "function") {
    return input;
  }
  const config = getToolMetadata(input);
  if (!config) {
    throw new Error(`[thena] Class "${input.name}" is not decorated with @Tool().`);
  }
  // Como `WorkflowRuntime` é a única dependência injetável, ele é passado a
  // toda tool; tools sem construtor apenas ignoram o argumento extra. Assim a
  // DI funciona tanto compilado (tsc) quanto via tsx, sem depender de
  // `reflect-metadata`/metadados de decorator.
  //
  // Uma instância por tool, e não um singleton de módulo: a classe é sem
  // estado (todo o contexto vem do `RunContext`), então o custo é uma alocação
  // — e o módulo fica sem nenhum estado de escopo global.
  const instance = new (input as ToolClass)(createRuntime());
  // Defesa em runtime: o TypeScript já barra isso na declaração (`Tool<T
  // extends ToolClass>`), mas cobre só quem passa pelo `tsc`. Sem isso, a
  // falha apareceria como `TypeError: instance.execute is not a function`
  // lá na frente — genérico, e mascarado como observação de falha da tool.
  if (typeof instance.execute !== "function") {
    throw new Error(`[thena] Class "${input.name}" does not implement execute(input).`);
  }
  const points = pointsOf(input, "execute");

  return {
    name: config.name,
    description: config.description,
    schema: config.schema,
    // Sem decorators, o contrato histórico: só os args validados.
    execute: (args: unknown) =>
      Promise.resolve(instance.execute(args)) as Promise<string>,
    // Com decorators, a chamada precisa do ctx — montada no passo de tool, que
    // é quem o tem. Guardado aqui para não duplicar a resolução da tool.
    ...(points ? { [PLAN]: { instance, points, name: input.name } } : {}),
  } as ToolType;
}
