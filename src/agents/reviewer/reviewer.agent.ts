import { Agent } from "@thenajs/core";
import { LocalOllamaProvider } from "../../providers/ollama.provider.js";

@Agent({
  provider: LocalOllamaProvider,
  tools: [],
  prompt: "./reviewer.agent.md",
})
export class ReviewerAgent {}
