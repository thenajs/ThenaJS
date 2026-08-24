import { Tool, WorkflowRuntime, context, input } from "@thenajs/core";
import type { AgentContext } from "@thenajs/core";
import { z } from "zod";

import { DeployWorkflow } from "../workflows/deploy.workflow.js";

@Tool({
  name: "deploy",
  description: "Executa o processo de deploy de um repositório.",
  schema: z.object({
    repository: z.string().describe("o repositório a implantar"),
  }),
})
export class DeployTool {
  // O construtor recebe o runtime, que dispara outro workflow.
  constructor(private readonly runtime: WorkflowRuntime) {}

  /**
   * O sub-workflow roda **isolado**: estado próprio, histórico próprio. Isso é
   * bom (o ruído dele não polui o agente pai) e tem um custo — ele começa sem
   * saber o que foi pedido.
   *
   * O `@context()` resolve isso: dá acesso à conversa do pai, para repassar só o
   * que interessa. É o caso de uso central do decorator.
   */
  async execute(
    @input() { repository }: { repository: string },
    @context() ctx: AgentContext,
  ) {
    const pedidoOriginal = ctx.state.history.find((m) => m.role === "user")?.content;

    return this.runtime.run(DeployWorkflow, {
      prompt: `Faça o deploy de ${repository}`,
      // Texto legível em vez de JSON: isto vira mensagem `system` no
      // sub-workflow, e o modelo lê melhor uma frase do que um objeto
      // serializado.
      state: { memory: [`Pedido original do usuário: ${pedidoOriginal}`] },
    });
  }
}
