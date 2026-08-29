import { Workflow, loop, untilAnswered } from "@thenajs/core";
import { SmokeAgent } from "../agents/smoke/smoke.agent.js";
import { ExplorerState } from "./explorer.state.js";

/**
 * O caminho mínimo que ainda é representativo: um agente, uma tool, num loop
 * ReAct. Sem o loop o workflow terminaria no turno da tool e a resposta final
 * nunca viria — e é justamente a segunda volta que prova que o modelo leu a
 * observação e a usou.
 *
 * O `state` é o da `ReadFileTool`, reaproveitado: ela grava ali o que leu, e
 * isso é uma asserção sobre **efeito**, não sobre o texto da resposta.
 */
@Workflow({
  state: ExplorerState,
  steps: [
    loop({
      steps: [SmokeAgent],
      until: untilAnswered,
      // Teto baixo: se não convergiu em 4 voltas, algo está errado — e cada
      // volta custa dinheiro de verdade.
      maxIterations: 4,
    }),
  ],
})
export class SmokeWorkflow {}
