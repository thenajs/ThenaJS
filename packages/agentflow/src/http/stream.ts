/**
 * Leitura de resposta em stream, line a line.
 *
 * Os dois formatos que os providers usam são baseados em line — NDJSON no
 * Ollama, SSE na OpenAI —, e o problema difícil é o mesmo: um chunk da rede não
 * respeita fronteira de line nem de caractere UTF-8. Uma line JSON pode
 * chegar partida em três leituras, e um emoji pode chegar com metade dos bytes
 * numa e metade na outra.
 *
 * `TextDecoder` com `{ stream: true }` resolve o segundo; o buffer de resto
 * resolve o primeiro.
 */
export async function* readLines(
  response: Response,
): AsyncGenerator<string, void, undefined> {
  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let resto = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      resto += decoder.decode(value, { stream: true });

      const lines = resto.split("\n");
      // A última pode estar incompleta — volta para o buffer.
      resto = lines.pop() ?? "";

      for (const line of lines) {
        const limpa = line.trim();
        if (limpa) yield limpa;
      }
    }

    // O que sobrou sem `\n` no fim ainda é uma line.
    const ultima = (resto + decoder.decode()).trim();
    if (ultima) yield ultima;
  } finally {
    // Solta a conexão mesmo se quem consome parar no half (`break`, erro,
    // cancelamento) — sem isto o socket fica pendurado.
    await reader.cancel().catch(() => {});
  }
}

/**
 * Payloads de um stream SSE: só as linhas `data:`, já sem o prefixo, e sem o
 * `[DONE]` que a OpenAI manda no fim.
 */
export async function* readSse(
  response: Response,
): AsyncGenerator<string, void, undefined> {
  for await (const line of readLines(response)) {
    if (!line.startsWith("data:")) continue;

    const payload = line.slice(5).trim();
    if (payload === "[DONE]") return;
    if (payload) yield payload;
  }
}
