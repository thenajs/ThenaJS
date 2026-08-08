import type { AgentMetadata, ToolConfig, WorkflowMetadata } from "../types.js";

/** Registro classe-do-agente -> metadados, preenchido pelo `@Agent`. */
const agents = new WeakMap<Function, AgentMetadata>();

/** Registro classe-do-workflow -> metadados, preenchido pelo `@Workflow`. */
const workflows = new WeakMap<Function, WorkflowMetadata>();

/** Registro classe-da-tool -> config, preenchido pelo `@Tool`. */
const tools = new WeakMap<Function, ToolConfig>();

export function setAgentMetadata(target: Function, meta: AgentMetadata): void {
  agents.set(target, meta);
}

export function getAgentMetadata(target: Function): AgentMetadata {
  const meta = agents.get(target);
  if (!meta) {
    throw new Error(`[thena] Class "${target.name}" is not decorated with @Agent().`);
  }
  return meta;
}

export function setWorkflowMetadata(target: Function, meta: WorkflowMetadata): void {
  workflows.set(target, meta);
}

export function getWorkflowMetadata(target: Function): WorkflowMetadata {
  const meta = workflows.get(target);
  if (!meta) {
    throw new Error(
      `[thena] Class "${target.name}" is not decorated with @Workflow().`,
    );
  }
  return meta;
}

export function setToolMetadata(target: Function, meta: ToolConfig): void {
  tools.set(target, meta);
}

/** Retorna a config do `@Tool` ou `undefined` se a classe não for decorada. */
export function getToolMetadata(target: Function): ToolConfig | undefined {
  return tools.get(target);
}
