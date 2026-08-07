// API pública do @thenajs/core — a camada de DX sobre o @thenajs/agentflow.

export { Agent } from "./decorators/agent.decorator.js";
export { Workflow } from "./decorators/workflow.decorator.js";
export { Tool } from "./decorators/tool.decorator.js";
export {
  parallel,
  loop,
  untilAnswered,
  calledTool,
  turnOf,
  wasExhausted,
  MAX_ITERATIONS_PADRAO,
  MAX_FAILS_PADRAO,
} from "./steps.js";
export { run, runWorkflow } from "./runtime/run-workflow.js";
export { buildAgentStep } from "./runtime/agent-step.js";
export { WorkflowRuntime } from "./runtime/workflow-runtime.js";
export { bootstrapWorkflow } from "./bootstrap.js";
export { input, context, state, memory } from "./decorators/inject.js";
export type { ThenaPlugin } from "./plugin.js";
export type { RunContext, RunMiddleware } from "./run-context.js";
export type { RunHandle } from "./run-handle.js";

/** Middlewares: o ponto de acoplamento de `app.use({ tool, chat })`. */
export type { Middleware } from "./middleware/compose.js";
export type { ToolMiddleware, ToolInvocation } from "./middleware/tool.js";
export type { ChatMiddleware, ChatInvocation } from "./middleware/chat.js";
export type { RuntimeSettings } from "./settings.js";
export { BudgetExceededError } from "./budget.js";
export { FatalToolError } from "./tool-error.js";
export type { RunBudget, BudgetUsage, BudgetExceeded } from "./budget.js";
export type { ThenaConfig, ReportOptions, LogConfig } from "./config.js";
/** Mascaramento de segredo no que vai para o report, o log e os plugins. */
export { redactSecrets } from "./observability/redact.js";
export type { RedactConfig } from "./observability/redact.js";
export type {
  ExecutionEvent,
  ExecutionNode,
  ExecutionKind,
} from "./observability/recorder.js";
export { getAgentMetadata, getWorkflowMetadata } from "./decorators/metadata.js";

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
  StateCtor,
  WorkflowStep,
  WorkflowContext,
  WorkflowApp,
  WorkflowRunOptions,
  WorkflowInput,
  ParallelStep,
  LoopStep,
  LoopFailure,
  LoopStopReason,
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
  VectorStore,
  VectorMemory,
  HttpTransport,
} from "@thenajs/agentflow";

// Ferramentas para escrever um provider próprio: parsers de resposta em texto,
// normalização de envelope de tool call e o helper de mapeamento de sampling.
export { parser, normalizeToolCallEnvelope, pruneUndefined } from "@thenajs/agentflow";

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

/**
 * Tipos para escrever um provider próprio.
 *
 * Atenção ao `ProviderToolCall`: é a chamada no formato do provider
 * (`{ id, name, arguments, source }`), diferente do `ToolCall` dos hooks
 * (`{ name, args }`) exportado acima.
 */
export type {
  RawAssistant,
  ChatParams,
  ProviderCredentials,
  ProviderToolCall,
  NormalizedToolCall,
  RetryPolicy,
  RetryAttempt,
  TransportCredentials,
} from "@thenajs/agentflow";

/** Memória vetorial: o contrato do store e o que é injetado nos agentes. */
export type {
  VectorStoreCredentials,
  VectorStoreCtor,
  VectorDocument,
  VectorMatch,
  VectorSearch,
  VectorSelector,
  VectorDistance,
  CollectionOptions,
  RecallHit,
  RecallOptions,
  RememberOptions,
  ForgetSelector,
  VectorMemoryOptions,
} from "@thenajs/agentflow";
