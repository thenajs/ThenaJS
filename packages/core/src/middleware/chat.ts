import type { ChatTurn, Message, SamplingParams, ToolType } from "@thenajs/agentflow";
import type { ExecutionNode } from "../observability/recorder.js";
import type { RunContext } from "../run-context.js";
import type { AgentContext } from "../types.js";
import type { Middleware } from "./compose.js";

/** Uma chamada ao modelo, atravessando a cadeia. */
export interface ChatInvocation {
  messages: Message[];
  tools: ToolType[];
  sampling?: SamplingParams;
  /** Cancelamento da execução — repasse ao provider se você chamar por fora. */
  signal?: AbortSignal;
  /** Sink de token, quando alguém está ouvindo. Repasse junto com o signal. */
  onToken?: (token: string) => void;
  /** A instância do agente que originou a chamada. */
  readonly agent: any;
  readonly ctx: AgentContext;
  readonly run: RunContext;
  /**
   * Grava telemetria no nó `chat`: aparece no report e no grafo do Flow.
   * No-op quando não há observação ativa.
   */
  meta(dados: Record<string, unknown>): void;
  /** @internal Preenchido pelo `registrarChat` quando o nó é aberto. */
  node?: ExecutionNode;
}

export type ChatMiddleware = Middleware<ChatInvocation, ChatTurn>;

/**
 * Abre o nó `chat` do report e grava prompt, resposta e telemetria do turno.
 *
 * `attempts` só aparece quando houve retry — no caminho normal não polui.
 */
export const recordChat: ChatMiddleware = (inv, next) =>
  inv.run.recorder.around("chat", "chat", async (node) => {
    // A partir daqui o `inv.meta(...)` das camadas de dentro tem onde escrever.
    inv.node = node;

    const turno = await next();

    inv.run.recorder.capture(node, {
      prompt: JSON.stringify(inv.messages),
      response: turno.assistant.content,
      toolCall: turno.assistant.toolCalls?.[0]
        ? JSON.stringify(turno.assistant.toolCalls[0])
        : undefined,
    });
    inv.run.recorder.meta(node, {
      toolCallSource: turno.assistant.toolCalls?.[0]?.source,
      promptTokens: turno.usage?.promptTokens,
      completionTokens: turno.usage?.completionTokens,
      cachedTokens: turno.usage?.cachedTokens,
      costUsd: turno.usage?.costUsd,
      attempts: (turno.attempts ?? 1) > 1 ? turno.attempts : undefined,
    });

    return turno;
  });

/**
 * Contabiliza a chamada e os tokens no orçamento da run.
 *
 * A chamada é contada **na ida** e o consumo **na volta**. A ida importa porque
 * a tool roda dentro de `provider.chat`: se a chamada só fosse contada depois,
 * um sub-workflow disparado por ela veria o contador ainda zerado — e uma
 * recursão desceria para sempre sem nunca bater no teto.
 *
 * Um `throw` no meio deixa a chamada contada e o consumo não: erra para mais,
 * que é o lado certo de errar num orçamento.
 */
export const countChat: ChatMiddleware = async (inv, next) => {
  inv.run.budget.openChat();
  const turno = await next();
  inv.run.budget.closeChat(turno.usage);
  return turno;
};

/**
 * Monta a cadeia, encaixando os middlewares do usuário na posição certa.
 *
 * ```
 * registrarChat        ← roda SEMPRE: sem ele o `chat` some do report e do Flow
 *   [ do usuário ]     ← aqui
 *     contarChat       ← só conta o que foi de fato gasto
 *       [provider.chat]
 * ```
 *
 * Um cache que acerta precisa aparecer no grafo (por isso abaixo do registrar)
 * e **não** pode somar tokens já pagos no orçamento (por isso acima do contar).
 */
export function chatChain(usuario: ChatMiddleware[] = []): ChatMiddleware[] {
  return [recordChat, ...usuario, countChat];
}
