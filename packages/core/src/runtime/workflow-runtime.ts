import type { WorkflowRunOptions } from "../types.js";
import { runWorkflow, toInitial } from "./run-workflow.js";

/**
 * Serviço injetável que executa workflows. Uma tool pode recebê-lo no construtor
 * (`constructor(private runtime: WorkflowRuntime)`) e disparar outro workflow.
 *
 * Sem estado: tudo que a execução precisa vem do `RunContext`. Por isso o
 * `resolveTool` cria uma instância por tool em vez de compartilhar um singleton
 * de módulo.
 */
export class WorkflowRuntime {
  run<T = string>(
    WorkflowClass: Function,
    options: WorkflowRunOptions,
  ): Promise<T> {
    return runWorkflow<T>(
      WorkflowClass,
      toInitial(options.input),
      options.memory,
      options.budget,
    );
  }
}
