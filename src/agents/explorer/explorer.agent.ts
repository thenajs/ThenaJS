import { Agent } from "@mimir/core";
import { ShellTool } from "@mimir/tools";
import { LocalOllamaProvider } from "../../providers/ollama.provider.js";
import { ReadFileTool } from "../../tools/read-file.tool.js";

@Agent({
  provider: LocalOllamaProvider,
  tools: [ShellTool, ReadFileTool],
  prompt: "./explorer.agent.md"
})
export class ExplorerAgent {}
