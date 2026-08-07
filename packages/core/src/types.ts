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
import type { RunHandle } from "./run-handle.js";

/** Classe de provider que o framework instancia com `new ProviderCtor()`. */
export type ProviderCtor = new (...args: any[]) => Providers;

/**
 * Como o provider é resolvido pelo `@Agent`.
 *
 * As três formas são um mecanismo de **escopo**, e quem escolhe o eixo é você:
 *
 * - **instância** — configurada uma vez, compartilhada por todas as execuções;
 * - **classe** — instanciada com `new`, sem argumentos;
 * - **factory** — chamada **por execução**, já dentro do escopo da run. Lê
 *   `context()`, então chave, modelo e endpoint podem sair dos dados
 *   daquela execução:
 *
 * ```ts
 * @Agent({
 *   provider: () => new OpenAIProvider({ apiKey: minhaChave(context().data) }),
 *   prompt: "./a.agent.md",
 * })
 * ```
 */
export type ProviderInput = Providers | ProviderCtor | ProviderFactory;

/** Factory de provider, chamada uma vez por execução. */
export type ProviderFactory = () => Providers;

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
export type AgentContext<D extends DadosDaRun = DadosDaRun> = PipelineContext &
  RunControls<D> & {
    turn?: TurnInfo;
    /**
     * Consumo acumulado da run até aqui. Presente quando há `budget` — é a
     * partir daqui que se escreve política própria (dedupe, corte por
     * heurística) num `beforeTool` ou num `until`, sem o framework opinar.
     */
    budget?: BudgetUsage;
  } & Record<string, unknown>;

/**
 * A forma do `run({ data })`.
 *
 * Aberto por padrão, porque o framework **não interpreta nada** aqui — o que
 * tem dentro é da sua aplicação. Declare o seu para não precisar de cast a cada
 * leitura:
 *
 * ```ts
 * type MinhaExecucao = { contaId: string; regiao: string };
 *
 * const app = Thena.create<string, MinhaExecucao>(Fluxo, config);
 * await app.run({ input, data: { contaId: "acme", regiao: "sa-east-1" } });
 *
 * context<MinhaExecucao>().data.contaId;   // string, sem cast
 * ```
 *
 * Prefira `type` a `interface X extends DadosDaRun`: a interface herda o índice
 * livre desta assinatura, e aí um campo inexistente passa como `unknown` em vez
 * de dar erro de compilação.
 */
export type DadosDaRun = Record<string, unknown>;

/**
 * O que uma tool ou um hook alcança **da execução**, e não do passo.
 *
 * Estes campos existem no mesmo `ctx` que o `@context()` já injeta — a adição
 * é aditiva, e nada do que havia antes mudou de lugar. A separação importa
 * porque os dois grupos têm ciclos de vida diferentes: `state`, `output` e
 * `turn` são do passo (e num bloco `parallel` são compartilhados entre os
 * ramos); os campos abaixo valem para a execução inteira.
 */
export interface RunControls<D extends DadosDaRun = DadosDaRun> {
  /** Id da execução. O mesmo que aparece em todo `ExecutionEvent`. */
  readonly runId: string;
  /**
   * O canal de dados da execução (`run({ data })`). **Nunca vai para o
   * modelo** — é a diferença para o `run({ memory })`.
   *
   * Sempre presente (objeto vazio quando não informado), e não opcional: é o
   * acesso mais frequente da API, e um `?.` aqui apareceria em todo call site
   * por um caso que não existe. O objeto é seu — o framework não interpreta
   * nada dentro dele, e o tipo é o que **você** declarar.
   */
  readonly data: D;
  /**
   * Cancelamento da execução. Repasse ao seu `fetch` para uma tool longa
   * parar de verdade quando alguém aborta:
   *
   * ```ts
   * await fetch(url, { signal: ctx.signal });
   * ```
   */
  readonly signal: AbortSignal;
  /** Consumo acumulado da execução até aqui. */
  usage(): BudgetUsage;
  /**
   * Cancela a execução inteira, de dentro. A `reason` chega no `catch` de quem
   * chamou `run()`. Encerra abrupto — o turno em voo é interrompido.
   */
  abort(reason?: unknown): void;
  /**
   * Encerra a execução **graciosamente**: os passos seguintes são pulados e a
   * run devolve o output que já tinha, sem lançar.
   *
   * É a diferença para o `abort()` — e o mesmo comportamento do orçamento no
   * modo `"stop"`. Use quando a tool descobre que já há resposta suficiente.
   */
  stop(): void;
  /**
   * Registra uma limpeza para o fim da execução — sucesso, erro ou abort.
   * Roda na ordem inversa do registro, como um `defer`.
   *
   * ```ts
   * const conn = await pool.acquire();
   * ctx.onDispose(() => conn.release());
   * ```
   */
  onDispose(fn: () => void | Promise<void>): void;
  /**
   * Grava telemetria no nó **deste passo**: aparece no `report.json` e no
   * payload do nó no Flow. No-op sem observação ativa.
   */
  meta(dados: Record<string, unknown>): void;
}

/**
 * O contexto que uma tool recebe com `@context()`.
 *
 * Nome preferido daqui em diante; `AgentContext` continua válido e é o mesmo
 * tipo.
 */
export type Context<D extends DadosDaRun = DadosDaRun> = AgentContext<D>;

/** Alias usado nos `until` de workflow — mesma forma do `AgentContext`. */
export type WorkflowContext<D extends DadosDaRun = DadosDaRun> = AgentContext<D>;

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
  ): string | ToolOutput | void | Promise<string | ToolOutput | void>;
  /** Transforma a resposta final do passo do agente. */
  afterResponse?(
    response: string,
    ctx: AgentContext,
  ): string | void | Promise<string | void>;
  /** Trata erros do fluxo; o retorno (se houver) vira a saída do agente. */
  onError?(error: Error, ctx: AgentContext): string | void | Promise<string | void>;
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
export type LoopStopReason = "until" | "exhausted" | "fails" | "budget" | "stop";

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
  onFail?: (ctx: WorkflowContext, info: LoopFailure) => unknown | Promise<unknown>;
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
export interface WorkflowRunOptions<D extends DadosDaRun = DadosDaRun> {
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
  /**
   * Liga a observação desta execução: `onEvent`/`eventStream` do handle passam
   * a receber os passos, e `onToken`/`textStream` a receber o texto.
   *
   * **O default é ligado só quando já há um observador** — `report`, `log` ou
   * um plugin com `onEvent`. Sem nenhum deles a run não constrói a árvore de
   * execução, não emite eventos e não pede streaming ao provider: é o caminho
   * de custo zero, e ele vale ~2× em tempo de CPU por run.
   *
   * Use `observe: true` no padrão POST+SSE, em que o único consumidor é o
   * handle:
   *
   * ```ts
   * const exec = app.run({ input, observe: true });
   * res.json({ runId: exec.runId });
   * for await (const e of exec.eventStream) sse(e);
   * ```
   */
  observe?: boolean;
  /**
   * Cancela a execução. Combina com o `abort()` do handle: o que disparar
   * primeiro vence.
   *
   * ```ts
   * app.run({ input, signal: req.signal });              // cliente desconectou
   * app.run({ input, signal: AbortSignal.timeout(30_000) });
   * ```
   */
  signal?: AbortSignal;
  /**
   * O canal de dados desta execução, disponível em `context().data` e em
   * `ctx.data`. O conteúdo é seu — o framework transporta e propaga, sem
   * interpretar nem nomear nada.
   *
   * **Não vai para o modelo** — é a diferença para o `memory` acima, que é
   * serializado na mensagem `system` e portanto lido pelo modelo e gravado no
   * report. Use `data` para o que a execução precisa carregar e o modelo não
   * deve ver; use `memory` para o contexto que o modelo **deve** ler.
   *
   * ```ts
   * await app.run({ input, data: { contaId: "acme", regiao: "sa-east-1" } });
   * ```
   */
  data?: D;
}

/** O que `Thena.create(...)` devolve — o "app" do workflow. */
export interface WorkflowApp<T = string, D extends DadosDaRun = DadosDaRun> {
  /**
   * Executa o workflow e devolve a execução, de forma **síncrona**.
   *
   * Com `await`, você pede o resultado; sem `await`, a execução — com
   * `runId`, `abort()` e `onEvent()`. Rejeita quando a execução falha: o erro
   * não é engolido, e o processo não é marcado por baixo dos panos.
   *
   * Chamadas concorrentes são seguras: cada uma abre o próprio `RunContext`.
   */
  run(options: WorkflowRunOptions<D>): RunHandle<T>;
  /**
   * Acopla um observador do stream ao vivo. Vários coexistem, e nenhum toma o
   * lugar do `log` do config. Chame antes do `run`.
   */
  use(plugin: ThenaPlugin): Promise<WorkflowApp<T, D>>;
  /** Aborta as execuções em voo, espera elas soltarem, e encerra os plugins. */
  dispose(): Promise<void>;
}
