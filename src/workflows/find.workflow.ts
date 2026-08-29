import { Workflow, loop, untilAnswered } from "@thenajs/core";
import { FinderAgent } from "../agents/finder/finder.agent.js";
import { ExplorerState } from "./explorer.state.js";

/**
 * O workflow do sub-agente de busca. Roda **aninhado**, disparado pela
 * `FindTool`.
 *
 * O ponto é o contexto: o finder abre dez arquivos e acumula dez observações no
 * histórico **dele**. Como uma run aninhada monta o próprio `StateManager` e o
 * `WorkflowRuntime` não devolve o estado, esse histórico morre aqui — quem
 * chamou recebe só o texto final. É a diferença entre o pai pagar dez arquivos
 * em todo turno seguinte e pagar um parágrafo.
 *
 * `maxIterations` maior que o do fluxo principal de propósito: buscar é
 * iterativo (grep, olhar, refinar). O teto de gasto de verdade é o `budget`
 * que a tool passa — encadeado no do pai, então isto não é rota de fuga.
 */
@Workflow({
  state: ExplorerState,
  steps: [
    loop({
      steps: [FinderAgent],
      until: untilAnswered,
      maxIterations: 8,
    }),
  ],
})
export class FindWorkflow {}
