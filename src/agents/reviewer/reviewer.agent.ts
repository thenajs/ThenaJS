import { Agent, state } from "@thenajs/core";
import { LocalOllamaProvider } from "../../providers/ollama.provider.js";
import { ExplorerState } from "../../workflows/explorer.state.js";

/**
 * Julga o que o explorador encontrou e grava a decisão no estado do workflow.
 *
 * É a ponte entre o agente e o `until` do loop: sem alguém gravar `aprovado`, a
 * condição de parada nunca ficaria verdadeira e o loop rodaria até o teto.
 */
@Agent({
  provider: LocalOllamaProvider,
  tools: [],
  prompt: "./reviewer.agent.md",
})
export class ReviewerAgent {
  // `@state()` entrega a mesma instância que o `until` do loop vai ler.
  constructor(@state() private readonly estado: ExplorerState) {}

  async afterResponse(resposta: string) {
    this.estado.rodadas++;

    // O prompt pede para a resposta terminar com APROVADO ou AJUSTAR.
    this.estado.aprovado = /\bAPROVADO\b/i.test(resposta);

    if (!this.estado.aprovado) {
      this.estado.apontamentos.push(resposta.trim());
    }
  }
}
