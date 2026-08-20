import { Agent } from "@thenajs/core";
import { LocalOllamaProvider } from "../../providers/ollama.provider.js";
import { ReadFileTool } from "../../tools/read-file.tool.js";

@Agent({
  provider: LocalOllamaProvider,
  tools: [ReadFileTool],
  prompt: "./explorer.agent.md",
})
export class ExplorerAgent {}
