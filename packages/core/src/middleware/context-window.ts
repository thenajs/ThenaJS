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
   * (assistant + tool), então `maxTurns: 12` guarda ~6 idas e voltas.
   *
   * É um **teto, não uma cota**: se o corte cair no meio de um par, chega uma
   * mensagem a menos. Mandar meio par é `400` no provider.
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
  notice?: string | false;
  /**
   * @deprecated Use `notice`.
   *
   * O nome veio de um rename automatizado que atravessou arquivos:
   * `warnIndexFailure` é o tratador de falha ao gravar o índice do report
   * (`observability/report.ts`), e não tem relação com a nota do corte de
   * histórico. Continua funcionando — `notice`, quando informado, vence.
   */
  warnIndexFailure?: string | false;
}

const DEFAULT_NOTICE = "[…previous history omitted to fit the window…]";

/**
 * Middleware que aplica a janela. Preserva **sempre** as mensagens `system`
 * iniciais: elas são o prompt do agente e a projeção do estado, e cortá-las
 * quebraria o agente em vez de economizar.
 *
 * Preservar o começo também é o que mantém o prefixo estável para o cache de
 * prompt do provider — cortar do topo zeraria o desconto a cada turno.
 */
export function contextWindow(options: ContextWindowOptions = {}): ChatMiddleware {
  const { maxTurns, maxChars, maxCharsPerTool } = options;

  // `notice` vence o nome antigo; `?? ` e não `||` para `false` (cortar em
  // silêncio) não ser confundido com "não informado" e cair no default.
  const notice = options.notice ?? options.warnIndexFailure ?? DEFAULT_NOTICE;

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
          ? { ...m, content: `${m.content.slice(0, maxCharsPerTool)}\n… [truncated]` }
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

    // Os dois cortes acima olham para o índice, não para o par. Um turno com
    // tool ocupa duas mensagens — `assistant` com `toolCalls` e o `tool` que
    // responde a ela — e cortar entre as duas deixa o `tool` órfão. A OpenAI
    // recusa isso com `400`, que o `retry.ts` **não** retenta por ser erro de
    // contrato. Ou seja: sem este recuo, o middleware que existe para evitar um
    // 400 de janela estourada passa a produzir um 400 de mensagem inválida.
    //
    // Recuar até a fronteira, em vez de tentar remendar o par: reconstruir o
    // `assistant` que falta significaria inventar uma `toolCall` que o modelo
    // não emitiu. Custa algumas mensagens a menos que o `maxTurns` pedido — e
    // é por isso que o teto é um teto, não uma cota.
    //
    // Só a borda inicial quebra: `slice(-maxTurns)` e `shift()` cortam pela
    // frente, então o fim do histórico chega sempre íntegro.
    let orphansDropped = 0;
    while (conversation.length && conversation[0].role === "tool") {
      conversation.shift();
      orphansDropped++;
    }

    if (trimmed && notice !== false) {
      conversation = [{ role: "system", content: notice }, ...conversation];
    }

    inv.messages = [...system, ...conversation];
    inv.meta({
      windowTrimmed: trimmed,
      // Separado do `windowTrimmed` de propósito: cortar por teto e cortar para
      // salvar um par são causas diferentes, e sem distingui-las quem lê o
      // report não sabe se a janela está apertada demais (R-15).
      windowOrphansDropped: orphansDropped,
      messagesSent: inv.messages.length,
      messagesOriginal: original.length,
    });

    return next();
  };
}

function size(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + m.content.length, 0);
}
