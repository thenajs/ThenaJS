// API pública do @thenajs/core — a camada de DX sobre o @thenajs/agentflow.

export { Agent } from "./agent.decorator.js";
export { Workflow } from "./workflow.decorator.js";
export { Tool } from "./tool.decorator.js";
export {
  parallel,
  loop,
  untilAnswered,
  calledTool,
  turnOf,
  wasExhausted,
} from "./steps.js";
export { run, runWorkflow, buildAgentStep, WorkflowRuntime } from "./runner.js";
export { bootstrapWorkflow } from "./bootstrap.js";
export { BudgetExceededError } from "./budget.js";
export type { RunBudget, BudgetUsage, BudgetExceeded } from "./budget.js";
export type { ThenaConfig, ReportOptions, LogConfig } from "./report/config.js";
export type { ExecutionEvent, ExecutionNode, ExecutionKind } from "./report/recorder.js";
export { getAgentMetadata, getWorkflowMetadata } from "./metadata.js";

export type {
  AgentConfig,
  AgentMetadata,
  AgentClass,
  AgentContext,
  AgentHooks,
  TurnInfo,
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
  toToolOutput,
  md,
} from "@thenajs/agentflow";

export type {
  ToolType,
  ToolOutput,
  PipelineContext,
  LoopInfo,
  Step,
  State,
  Message,
  Role,
  ChatTurn,
  Usage,
  TokenCost,
  OllamaCredentials,
  OpenAICredentials,
  SamplingParams,
} from "@thenajs/agentflow";
