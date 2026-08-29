import { OpenAIProvider } from "@thenajs/core";

/**
 * Provider do smoke test, apontado para a API da NVIDIA — compatível com o
 * formato da OpenAI, então basta trocar o `host`.
 *
 * A chave vem do ambiente e **nunca** do código: este arquivo é versionado, e
 * um segredo aqui vaza no primeiro `git push`. Falhar na construção, com o nome
 * da variável na mensagem, é melhor do que um `401` no meio da execução.
 */
export class NvidiaProvider extends OpenAIProvider {
  constructor() {
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      throw new Error(
        "[smoke] NVIDIA_API_KEY não definida. " +
          "Exporte a chave antes de rodar: NVIDIA_API_KEY=… npm run smoke",
      );
    }

    super({
      apiKey,
      host: "https://integrate.api.nvidia.com/v1",
      // Modelo fixado de propósito: um que muda por baixo transforma o smoke
      // test num oráculo instável, que falha sem ninguém ter mexido em nada.
      model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      // Determinismo é o que separa "o teste pegou uma regressão" de "o modelo
      // acordou criativo hoje".
      sampling: { temperature: 0 },
      // O smoke roda em CI: travar é falha, não espera indefinida.
      retry: { timeoutMs: 60_000 },
    });
  }
}
