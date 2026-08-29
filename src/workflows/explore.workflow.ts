import { Workflow, loop, untilAnswered } from "@thenajs/core";
import { ExploreAgent } from "../agents/explore/explore.agent.js";
import { ExplorerState } from "./explorer.state.js";

/**
 * O nível do meio: recebe uma área para mapear e a quebra em buscas, cada uma
 * delegada ao `find` — que por sua vez abre a própria run aninhada.
 *
 * `maxIterations: 6` porque cada volta aqui dispara uma execução inteira lá
 * embaixo. O teto que segura o gasto de verdade é o `budget` que a
 * `ExplorerTool` passa, encadeado no do fluxo principal.
 */
@Workflow({
  state: ExplorerState,
  steps: [
    loop({
      steps: [ExploreAgent],
      until: untilAnswered,
      maxIterations: 6,
    }),
  ],
})
export class ExploreWorkflow {}
