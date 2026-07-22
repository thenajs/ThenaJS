export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  /** id nativo (OpenAI) ou sintético; Ollama tolera ausência. */
  id?: string;
  name: string;
  arguments: unknown;
}

/** Um turno da conversa, no formato que o modelo entende. */
export interface Message {
  role: Role;
  content: string;
  /** Presente em mensagens 'assistant' que chamam uma tool (no máximo 1 por turno). */
  toolCalls?: ToolCall[];
  /** Presente em mensagens 'tool': qual tool gerou o resultado. */
  toolName?: string;
  /** Presente em mensagens 'tool': amarra o resultado ao tool_call (OpenAI exige). */
  toolCallId?: string;
}

export type State = {
  /** A conversa: turnos user/assistant/tool. É aqui que ação↔observação vivem. */
  history: Message[];
  /** Itens acompanhados → projetados como nota no system. */
  tasks: string[];
  /** Conteúdo durável → projetado como mensagem system. */
  memory: string[];
};
