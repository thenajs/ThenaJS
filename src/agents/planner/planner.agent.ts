import { Agent } from "@mimir/core";
import { LocalOllamaProvider } from "../../providers/ollama.provider.js";

@Agent({
  provider: LocalOllamaProvider,
  tools: [],
  prompt: "./planner.agent.md",
})
export class PlannerAgent {}
