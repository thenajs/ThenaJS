// API pública do @thenajs/core — a camada de DX sobre o @thenajs/agentflow.

export { Agent } from "./agent.decorator.js";
export { Workflow } from "./workflow.decorator.js";
export { Tool } from "./tool.decorator.js";
export { parallel, loop } from "./steps.js";
export { run, runWorkflow, buildAgentStep, WorkflowRuntime } from "./runner.js";
export { bootstrapWorkflow } from "./bootstrap.js";
export type { ThenaConfig, ReportOptions, LogConfig } from "./report/config.js";
export type { ExecutionEvent, ExecutionNode, ExecutionKind } from "./report/recorder.js";
export { getAgentMetadata, getWorkflowMetadata } from "./metadata.js";

export type {
  AgentConfig,
  AgentMetadata,
  AgentClass,
  AgentContext,
  AgentHooks,
  ToolCall,
  ToolResult,
  WorkflowConfig,
  WorkflowMetadata,
  WorkflowStep,
  WorkflowContext,
  WorkflowApp,
  WorkflowRunOptions,
  WorkflowInput,
  ParallelStep,
  LoopStep,
  ToolConfig,
  ToolClass,
  ProviderInput,
  ProviderCtor,
  ToolInput,
} from "./types.js";

// Blocos do engine reexportados por conveniência (providers, estado, tipos).
export {
  OllamaProvider,
  OpenAIProvider,
  Providers,
  StateManager,
  Pipeline,
  md,
} from "@thenajs/agentflow";

export type {
  ToolType,
  PipelineContext,
  Step,
  State,
  Message,
  Role,
  ChatTurn,
  OllamaCredentials,
  OpenAICredentials,
} from "@thenajs/agentflow";
