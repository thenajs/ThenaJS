/**
 * Parâmetros de amostragem num shape neutro, traduzido por cada provider para as
 * chaves nativas dele. Todos opcionais: o que não for informado não é enviado,
 * então o provider mantém o default do próprio modelo/servidor.
 *
 * Nem todo provider suporta tudo — `topK`, `numCtx` e `repeatPenalty` não têm
 * equivalente na OpenAI e são descartados lá. Para chaves específicas de um
 * provider, use o escape hatch `raw` das credentials.
 */
export type SamplingParams = {
  /** Aleatoriedade. `0` é o ponto de partida usual para tool calling determinístico. */
  temperature?: number;
  /** Nucleus sampling. */
  topP?: number;
  /** Corte de top-k. Ollama apenas. */
  topK?: number;
  /** Semente do gerador — junto de `temperature: 0`, o par que dá repetibilidade. */
  seed?: number;
  /** Teto de tokens gerados (`num_predict` no Ollama, `max_tokens` na OpenAI). */
  maxTokens?: number;
  /** Tamanho da janela de contexto. Ollama apenas. */
  numCtx?: number;
  /** Sequências que interrompem a geração. */
  stop?: string[];
  /** Penalidade de repetição. Ollama apenas. */
  repeatPenalty?: number;
};

/** Remove as chaves `undefined` para não enviar nada que o usuário não pediu. */
export function pruneUndefined(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }

  return out;
}
