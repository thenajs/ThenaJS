import { Workflow, loop, untilAnswered } from "@thenajs/core";
import { ExplorerAgent } from "../agents/explorer/explorer.agent.js";

/**
 * Loop ReAct de UM agente: repete enquanto o modelo chama tools e para no turno
 * em que ele responde sem tool. Repare que o `ExplorerAgent` não precisa de
 * nenhum hook — o `untilAnswered` lê `ctx.turn.calledTool` que o runtime grava.
 */
@Workflow({
  steps: [
    loop({ steps: [ExplorerAgent], until: untilAnswered, maxIterations: 8 }),
  ],
})
export class ReactWorkflow {}
