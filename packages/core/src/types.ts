import type { PipelineContext, Providers, ToolType } from "@thenajs/agentflow";

/** Classe de provider que o framework instancia com `new ProviderCtor()`. */
export type ProviderCtor = new (...args: any[]) => Providers;

/** Provider aceito no decorator: uma instância já configurada ou a classe. */
export type ProviderInput = Providers | ProviderCtor;

/** Configuração passada para `@Tool({ ... })`. */
export interface ToolConfig {
  name: string;
  description: string;
  schema: ToolType["schema"];
}

/**
 * Classe de tool decorada com `@Tool`. Fornece só o método `execute`; nome,
 * descrição e schema vêm do decorator. O construtor pode receber dependências
 * injetadas (ex.: `WorkflowRuntime`).
 */
export type ToolClass = new (...args: any[]) => { execute(input: any): unknown };

/** Tool aceita no decorator do agente: um objeto `ToolType` ou a classe da tool. */
export type ToolInput = ToolType | ToolClass;

/** Configuração passada para `@Agent({ ... })`. */
export interface AgentConfig {
  /** Provider criado/utilizado através do `@thenajs/agentflow`. */
  provider: ProviderInput;
  /** Tools injetadas para o agente. */
  tools?: ToolInput[];
  /**
   * Origem do prompt em markdown (obrigatório). Aceita:
   * - caminho relativo (ex.: `"./explorer.agent.md"`) — relativo ao arquivo do agente;
   * - caminho absoluto;
   * - `URL` (ex.: `new URL("./explorer.agent.md", import.meta.url)`) — sem stack trace.
   */
  prompt: string | URL;
}

/**
 * Metadados que o `@Agent` registra para a classe: a config informada
 * mais o prompt carregado automaticamente do `.agent.md` irmão.
 */
export interface AgentMetadata {
  provider: ProviderInput;
  tools: ToolInput[];
  prompt: string;
}

/** Classe de agente decorada com `@Agent`. */
export type AgentClass = new (...args: any[]) => object;

/**
 * Contexto compartilhado do agente/pipeline. Estende o `PipelineContext` do
 * engine com um índice livre, para que os agentes possam gravar campos próprios
 * no ctx (ex.: `ctx.reviewApproved`) e os hooks/`until` possam lê-los.
 */
export type AgentContext = PipelineContext & Record<string, unknown>;

/** Alias usado nos `until` de workflow — mesma forma do `AgentContext`. */
export type WorkflowContext = AgentContext;

/** Chamada de tool interceptável por `beforeTool`. */
export interface ToolCall {
  name: string;
  args: unknown;
}

/** Resultado de tool interceptável por `afterTool`. */
export interface ToolResult {
  name: string;
  args: unknown;
  output: string;
}

/**
 * Hooks de ciclo de vida do agente (todos opcionais). A classe do agente pode
 * fazer `implements AgentHooks` só para tipagem; o runtime chama o que existir.
 *
 * Contrato dos transformadores: retornar um valor **substitui**; retornar
 * `undefined` **mantém** o valor original.
 */
export interface AgentHooks {
  /** Transforma o prompt final antes de enviar ao provider. */
  beforePrompt?(
    prompt: string,
    ctx: AgentContext,
  ): string | void | Promise<string | void>;
  /**
   * Intercepta uma tool antes de executar: retorne um `ToolCall` novo para
   * trocar os args, ou dê `throw` para cancelar a execução.
   */
  beforeTool?(
    call: ToolCall,
    ctx: AgentContext,
  ): ToolCall | void | Promise<ToolCall | void>;
  /** Transforma a saída de uma tool; o retorno substitui o `output`. */
  afterTool?(
    result: ToolResult,
    ctx: AgentContext,
  ): string | void | Promise<string | void>;
  /** Transforma a resposta final do passo do agente. */
  afterResponse?(
    response: string,
    ctx: AgentContext,
  ): string | void | Promise<string | void>;
  /** Trata erros do fluxo; o retorno (se houver) vira a saída do agente. */
  onError?(
    error: Error,
    ctx: AgentContext,
  ): string | void | Promise<string | void>;
}

/** Passo de um workflow: um agente, um bloco `parallel` ou um bloco `loop`. */
export type WorkflowStep = AgentClass | ParallelStep | LoopStep;

/** Bloco paralelo criado por `parallel([...])`. */
export interface ParallelStep {
  kind: "parallel";
  steps: WorkflowStep[];
}

/** Bloco de repetição criado por `loop({ ... })`. */
export interface LoopStep {
  kind: "loop";
  steps: WorkflowStep[];
  until: (ctx: WorkflowContext) => unknown;
  maxIterations?: number;
}

/** Configuração passada para `@Workflow({ ... })`. */
export interface WorkflowConfig {
  /** Passos executados em ordem; podem ser agentes, `parallel` ou `loop`. */
  steps: WorkflowStep[];
}

/** Metadados que o `@Workflow` registra para a classe. */
export interface WorkflowMetadata {
  steps: WorkflowStep[];
}

/**
 * Entrada de uma execução do workflow. `message`, quando presente, vira a
 * entrada inicial do pipeline; senão o objeto inteiro é serializado.
 */
export interface WorkflowInput {
  message?: string;
  [key: string]: unknown;
}

/** Opções de `app.run(...)`. */
export interface WorkflowRunOptions {
  input: WorkflowInput;
  /**
   * Contexto inicial / memória persistente do workflow. É semeada no `memory`
   * do estado antes da execução, ficando disponível para os agentes e para os
   * `until` dos loops (ex.: `userId`, `sessionId`).
   */
  memory?: Record<string, unknown>;
}

/** Handle retornado por `bootstrapWorkflow` — o "app" do workflow. */
export interface WorkflowApp<T = string> {
  run(options: WorkflowRunOptions): Promise<T | void>;
}
