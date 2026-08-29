import { Agent, DefaultAgentContract } from "@thenajs/core";
import { LocalOllamaProvider } from "../../providers/ollama.provider.js";

@Agent({
  provider: LocalOllamaProvider,
  tools: [],
  prompt: "./planner.agent.md",
  contract: DefaultAgentContract,
})
export class PlannerAgent {}
