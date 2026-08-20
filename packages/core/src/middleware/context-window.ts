import type { Message } from "@thenajs/agentflow";
import type { ChatMiddleware } from "./chat.js";

/**
 * Corta o histórico antes de enviá-lo ao modelo.
 *
 * O `history` cresce sem teto, e **cada turno reenvia tudo** — o custo é
 * quadrático no número de voltas: dez turnos não custam 10× o primeiro, custam
 * mais de 30×. E quando a janela do modelo estoura, a falha chega como um `400`
 * que não é retentável, na sétima volta, depois de você já ter pago as seis
 * anteriores.
 *
 * ```ts
 * await app.use({ name: "janela", chat: janelaDeContexto({ maxTurnos: 12 }) });
 * ```
 *
 * ## Por que não vem ligado
 *
 * Diferente do `maxIterations` e do `maxFails`, que só impedem desperdício,
 * **cortar histórico muda o comportamento do agente**: ele pode perder o que
 * precisava lembrar, e de forma silenciosa. Um default aqui trocaria uma falha
 * ruidosa e cara por uma degradação muda — pior de diagnosticar.
 *
 * O caminho recomendado é medir primeiro (o nó `chat` do report traz
 * `promptTokens`) e ligar quando o número justificar.
 */
export interface ContextWindowOptions {
  /**
   * Quantas mensagens do fim do histórico manter. Um turno com tool ocupa duas
   * (assistant + tool), então `maxTurnos: 12` guarda ~6 idas e voltas.
   */
  maxTurns?: number;
  /** Teto de caracteres do histórico. Corta do começo até caber. */
  maxChars?: number;
  /**
   * Teto por observação de tool, em caracteres. Saída de tool costuma ser o
   * que mais infla o histórico, e é o que envelhece mais rápido — o modelo
   * raramente precisa do conteúdo inteiro de um arquivo dez turnos depois.
   */
  maxCharsPerTool?: number;
  /**
   * O que dizer no lugar do que foi cortado. Uma nota explícita é melhor que
   * um salto silencioso: sem ela o modelo vê a conversation começar no meio e pode
   * repetir trabalho que já fez.
   *
   * `false` corta sem avisar.
   */
  warnIndexFailure?: string | false;
}

const DEFAULT_NOTICE = "[…histórico anterior omitido para caber na janela…]";

/**
 * Middleware que aplica a janela. Preserva **sempre** as mensagens `system`
 * iniciais: elas são o prompt do agente e a projeção do estado, e cortá-las
 * quebraria o agente em vez de economizar.
 *
 * Preservar o começo também é o que mantém o prefixo estável para o cache de
 * prompt do provider — cortar do topo zeraria o desconto a cada turno.
 */
export function contextWindow(options: ContextWindowOptions = {}): ChatMiddleware {
  const {
    maxTurns,
    maxChars,
    maxCharsPerTool,
    warnIndexFailure = DEFAULT_NOTICE,
  } = options;

  return async (inv, next) => {
    const original = inv.messages;

    // O bloco `system` do topo é intocável.
    let head = 0;
    while (head < original.length && original[head].role === "system") head++;

    const system = original.slice(0, head);
    let conversation = original.slice(head);

    if (maxCharsPerTool !== undefined) {
      conversation = conversation.map((m) =>
        m.role === "tool" && m.content.length > maxCharsPerTool
          ? { ...m, content: `${m.content.slice(0, maxCharsPerTool)}\n… [truncado]` }
          : m,
      );
    }

    let trimmed = false;

    if (maxTurns !== undefined && conversation.length > maxTurns) {
      conversation = conversation.slice(-maxTurns);
      trimmed = true;
    }

    if (maxChars !== undefined) {
      while (conversation.length > 1 && size(conversation) > maxChars) {
        conversation.shift();
        trimmed = true;
      }
    }

    if (trimmed && warnIndexFailure !== false) {
      conversation = [{ role: "system", content: warnIndexFailure }, ...conversation];
    }

    inv.messages = [...system, ...conversation];
    inv.meta({
      windowTrimmed: trimmed,
      messagesSent: inv.messages.length,
      messagesOriginal: original.length,
    });

    return next();
  };
}

function size(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + m.content.length, 0);
}
