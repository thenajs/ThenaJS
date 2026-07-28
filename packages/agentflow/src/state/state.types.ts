export type Role = "system" | "user" | "assistant" | "tool";

/**
 * A chamada de tool no formato do provider — o que `chatInternal` devolve em
 * `RawAssistant.toolCalls` e o que aparece em `ctx.turn`/report.
 *
 * Não confundir com o `ToolCall` dos hooks (`@thenajs/core`), que é
 * `{ name, args }`: este usa `arguments`, e traz `id` e `source`.
 */
export interface ProviderToolCall {
  /** id nativo (OpenAI) ou sintético; Ollama tolera ausência. */
  id?: string;
  name: string;
  arguments: unknown;
  /**
   * De onde a chamada veio: `"native"` quando o provider a devolveu pronta,
   * `"rescued"` quando foi extraída do texto da resposta. Medir isso mostra o
   * quanto um modelo depende do fallback.
   */
  source?: "native" | "rescued";
}

/**
 * @deprecated Renomeado para `ProviderToolCall` — o nome colidia com o
 * `ToolCall` dos hooks, que tem formato diferente. Este alias continua
 * funcionando e será removido numa versão futura.
 */
export type ToolCall = ProviderToolCall;

/** Um turno da conversa, no formato que o modelo entende. */
export interface Message {
  role: Role;
  content: string;
  /** Presente em mensagens 'assistant' que chamam uma tool (no máximo 1 por turno). */
  toolCalls?: ProviderToolCall[];
  /** Presente em mensagens 'tool': qual tool gerou o resultado. */
  toolName?: string;
  /** Presente em mensagens 'tool': amarra o resultado ao tool_call (OpenAI exige). */
  toolCallId?: string;
  /** Presente em mensagens 'tool': a observação é uma falha. */
  isError?: boolean;
}

export type State = {
  /** A conversa: turnos user/assistant/tool. É aqui que ação↔observação vivem. */
  history: Message[];
  /** Itens acompanhados → projetados como nota no system. */
  tasks: string[];
  /** Conteúdo durável → projetado como mensagem system. */
  memory: string[];
};
