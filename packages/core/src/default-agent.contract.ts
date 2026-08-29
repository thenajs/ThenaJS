import type { Message } from "@thenajs/agentflow";
import type { AgentContract, AgentContractContext } from "./types.js";

/**
 * Contrato explícito equivalente à projeção histórica do ThenaJS.
 *
 * Existe para migração e para agentes que querem a convenção pronta sem
 * esconder a decisão: prompt + memory/tasks no system, seguidos do history.
 */
export class DefaultAgentContract implements AgentContract<Message[]> {
  build(ctx: AgentContractContext): Message[] {
    const state = [
      ctx.memory.join("\n"),
      ctx.tasks.length
        ? "Tasks:\n" + ctx.tasks.map((task) => `- ${task}`).join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    return [
      { role: "system", content: ctx.prompt },
      ...(state ? [{ role: "system" as const, content: state }] : []),
      ...ctx.history,
    ];
  }
}
