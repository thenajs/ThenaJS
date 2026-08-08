import { Agent } from "@thenajs/core";
import { ShellTool } from "@thenajs/tools";
import { LocalOllamaProvider } from "../../providers/ollama.provider.js";
import { ReadFileTool } from "../../tools/read-file.tool.js";

@Agent({
  provider: LocalOllamaProvider,
  tools: [ShellTool, ReadFileTool],
  prompt: "./explorer.agent.md",
})
export class ExplorerAgent {}
