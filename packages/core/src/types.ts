import type {
  PipelineContext,
  Providers,
  SamplingParams,
  ToolOutput,
  ToolType,
} from "@thenajs/agentflow";
import type { BudgetUsage, RunBudget } from "./budget.js";
import type { ThenaPlugin } from "./plugin.js";
import type { LogConfig, ReportOptions } from "./config.js";

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
 *
 * O `execute` aceita parâmetros variádicos porque pode ser decorado com
 * `@input()`, `@context()` e `@state()`. O que a restrição garante é que o
 * método **existe** — que é o erro que ela foi criada para pegar.
 */
export type ToolClass = new (...args: any[]) => {
  execute(...args: any[]): unknown;
};

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
  /**
   * Sampling deste agente. Sobrescreve, chave a chave, o sampling configurado
   * no provider — útil para deixar um agente determinístico e outro criativo
   * usando o mesmo provider.
   */
  sampling?: SamplingParams;
}

/**
 * Metadados que o `@Agent` registra para a classe: a config informada
 * mais o prompt carregado automaticamente do `.agent.md` irmão.
 */
export interface AgentMetadata {
  provider: ProviderInput;
  tools: ToolInput[];
  prompt: string;
  sampling?: SamplingParams;
}

/** Classe de agente decorada com `@Agent`. */
export type AgentClass = new (...args: any[]) => object;

/**
 * Resumo do último turno do agente, gravado em `ctx.turn` pelo runtime a cada
 * passo de agente. Deixa o `until` de um loop decidir a parada sem boilerplate
 * (ex.: `untilAnswered` = parar quando o agente respondeu sem chamar tool).
 */
export interface TurnInfo {
  /** O modelo chamou (e o engine executou) uma tool neste turno? */
  calledTool: boolean;
  /** Nome da tool que o modelo chamou, se houve. */
  toolName?: string;
  /** A tool executada neste turno sinalizou falha. */
  toolError?: boolean;
  /**
   * De onde veio a chamada: `"native"` (o provider trouxe tool calls) ou
   * `"rescued"` (o runtime extraiu do texto da resposta). Útil para medir o
   * quanto um modelo depende do resgate.
   */
  toolCallSource?: "native" | "rescued";
  /** Resposta final do turno (conteúdo da tool, ou do assistant). */
  response: string;
}

/**
 * Contexto compartilhado do agente/pipeline. Estende o `PipelineContext` do
 * engine com um índice livre, para que os agentes possam gravar campos próprios
 * no ctx (ex.: `ctx.reviewApproved`) e os hooks/`until` possam lê-los. O runtime
 * grava o resumo do último turno em `ctx.turn` (a prop explícita vence o índice,
 * então fica tipada).
 */
export type AgentContext = PipelineContext & {
  turn?: TurnInfo;
  /**
   * Consumo acumulado da run até aqui. Presente quando há `budget` — é a partir
   * daqui que se escreve política própria (dedupe, corte por heurística) num
   * `beforeTool` ou num `until`, sem o framework opinar sobre ela.
   */
  budget?: BudgetUsage;
} & Record<string, unknown>;

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
  /** A tool sinalizou falha — devolvendo `isError`, ou lançando. */
  isError?: boolean;
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
  /**
   * Transforma a saída de uma tool; o retorno substitui o `output`. Devolver
   * uma string troca só o texto e **preserva** o `isError`; para mudar a marca
   * de erro, devolva um `ToolOutput` completo.
   */
  afterTool?(
    result: ToolResult,
    ctx: AgentContext,
  ):
    | string
    | ToolOutput
    | void
    | Promise<string | ToolOutput | void>;
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

/**
 * Classe de estado do workflow. Os valores iniciais são as próprias
 * inicializações de campo — o framework instancia uma por execução.
 *
 * ```ts
 * export class RevisaoState {
 *     aprovado = false;
 *     rodadas = 0;
 * }
 * ```
 */
export type StateCtor<S extends object = object> = new () => S;

/** Passo de um workflow: um agente, um bloco `parallel` ou um bloco `loop`. */
export type WorkflowStep = AgentClass | ParallelStep | LoopStep;

/** Bloco paralelo criado por `parallel([...])`. */
export interface ParallelStep {
  kind: "parallel";
  steps: WorkflowStep[];
}

/**
 * Uma falha de tool observada dentro de um loop, entregue ao `onFail`.
 *
 * O que o `maxFails` compara é `consecutive`: o sinal de "preso" é a
 * repetição, não o acúmulo. Um agente que erra, corrige e avança tem `total`
 * alto e `consecutive` baixo — e é exatamente o comportamento que se quer.
 */
export interface LoopFailure {
  /** Falhas seguidas até agora. Uma tool que funciona zera a contagem. */
  consecutive: number;
  /** Falhas desde o início desta execução do loop. */
  total: number;
  /** A tool que falhou, quando o provider informou o nome. */
  toolName?: string;
  /** A observação de erro que voltou para o modelo. */
  message: string;
}

/** Por que o loop terminou. Registrado no nó `loop` do report. */
export type LoopStopReason = "until" | "exhausted" | "fails" | "budget";

/** Bloco de repetição criado por `loop({ ... })`. */
export interface LoopStep {
  kind: "loop";
  steps: WorkflowStep[];
  /**
   * Devolva `true` para **parar**. O segundo parâmetro é o estado declarado em
   * `@Workflow({ state })`, quando houver.
   */
  until: (ctx: WorkflowContext, state?: any) => unknown;
  maxIterations?: number;
  /** Chamado quando o loop parou por `maxIterations` em vez de por `until`. */
  onExhausted?: (
    ctx: WorkflowContext,
    iterations: number,
  ) => unknown | Promise<unknown>;
  /**
   * Falhas de tool **consecutivas** que encerram o loop. `Infinity` desliga.
   */
  maxFails?: number;
  /** Chamado a cada falha de tool — para alertar antes de o corte acontecer. */
  onFail?: (
    ctx: WorkflowContext,
    info: LoopFailure,
  ) => unknown | Promise<unknown>;
}

/** Configuração passada para `@Workflow({ ... })`. */
export interface WorkflowConfig {
  /** Passos executados em ordem; podem ser agentes, `parallel` ou `loop`. */
  steps: WorkflowStep[];
  /**
   * Estado compartilhado desta execução. O framework instancia a classe uma vez
   * por `run` e a entrega a quem pedir com `@state()` — e ao `until` dos loops,
   * como segundo parâmetro.
   */
  state?: StateCtor;
}

/** Metadados que o `@Workflow` registra para a classe. */
export interface WorkflowMetadata {
  steps: WorkflowStep[];
  state?: StateCtor;
}

/**
 * Entrada de uma execução do workflow. `message`, quando presente, vira a
 * entrada inicial do pipeline; senão o objeto inteiro é serializado.
 */
export interface WorkflowInput {
  message?: string;
  [key: string]: unknown;
}

/**
 * Opções de `app.run(...)`.
 *
 * `report` e `log` sobrescrevem o `ThenaConfig` **apenas nesta execução** —
 * possível porque cada run tem o próprio contexto.
 */
export interface WorkflowRunOptions {
  input: WorkflowInput;
  /**
   * Contexto inicial / memória persistente do workflow. É semeada no `memory`
   * do estado antes da execução, ficando disponível para os agentes e para os
   * `until` dos loops (ex.: `userId`, `sessionId`).
   */
  memory?: Record<string, unknown>;
  /**
   * Teto da execução inteira (tempo, chamadas, tokens, custo). Sem `budget`,
   * nada é medido nem checado.
   */
  budget?: RunBudget;
  /** Sobrescreve `ThenaConfig.report` só nesta execução. */
  report?: boolean | ReportOptions;
  /** Sobrescreve `ThenaConfig.log` só nesta execução. */
  log?: LogConfig;
}

/** Handle retornado por `bootstrapWorkflow` — o "app" do workflow. */
export interface WorkflowApp<T = string> {
  /**
   * Executa o workflow. Rejeita quando a execução falha — o erro **não** é
   * engolido, e o processo não é marcado por baixo dos panos.
   *
   * Chamadas concorrentes são seguras: cada uma abre o próprio `RunContext`.
   */
  run(options: WorkflowRunOptions): Promise<T>;
  /**
   * Acopla um observador do stream ao vivo. Vários coexistem, e nenhum toma o
   * lugar do `log` do config. Chame antes do `run`.
   */
  use(plugin: ThenaPlugin): Promise<WorkflowApp<T>>;
  /** Encerra os plugins e solta o recorder. */
  dispose(): Promise<void>;
}
