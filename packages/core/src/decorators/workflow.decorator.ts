import { setWorkflowMetadata } from "./metadata.js";
import type { WorkflowConfig } from "../types.js";

/**
 * Decorator de workflow, no estilo do `@Agent`.
 *
 * Registra a classe como um workflow que orquestra vários agentes. Os agentes
 * são executados em sequência num único pipeline do engine, compartilhando o
 * mesmo estado/contexto — a saída de cada agente é a entrada do próximo.
 */
export function Workflow(config: WorkflowConfig): ClassDecorator {
  return (target) => {
    setWorkflowMetadata(target, { steps: config.steps, state: config.state });
  };
}
