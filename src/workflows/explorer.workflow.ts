import { Workflow, loop } from "@thenajs/core";
import { ExplorerAgent } from "../agents/explorer/explorer.agent.js";
import { PlannerAgent } from "../agents/planner/planner.agent.js";
import { ReviewerAgent } from "../agents/reviewer/reviewer.agent.js";
import { ExplorerState } from "./explorer.state.js";

/**
 * Planeja, explora e revisa — repetindo até o revisor aprovar.
 *
 * O `state` é o que amarra tudo: o `ReviewerAgent` grava a decisão nele e o
 * `until` a lê. Sem isso o loop não teria como saber que terminou, e rodaria
 * até `maxIterations` toda vez.
 *
 * Explorer e reviewer rodam em **sequência**, não em paralelo: o revisor precisa
 * ver o que o explorador achou para poder julgar.
 */
@Workflow({
  state: ExplorerState,
  steps: [
    PlannerAgent,
    loop({
      steps: [ExplorerAgent, ReviewerAgent],
      // `true` significa PARAR. O 2º parâmetro é a instância de ExplorerState.
      until: (_ctx, s: ExplorerState) => s.aprovado,
      maxIterations: 5,
      onExhausted: (_ctx, voltas) =>
        console.warn(`[app] o revisor não aprovou em ${voltas} rodadas`),
    }),
  ],
})
export class ExplorerWorkflow {}
