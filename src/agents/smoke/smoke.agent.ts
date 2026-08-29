import { Agent, DefaultAgentContract } from "@thenajs/core";
import { NvidiaProvider } from "../../providers/nvidia.provider.js";
import { ReadFileTool } from "../../tools/read-file.tool.js";
import { ShellTool } from "../../tools/shell.tool.js";
import { FindTool } from "../../tools/find.tool.js";
import { ExplorerTool } from "../../tools/explorer.tool.js";

@Agent({
  provider: NvidiaProvider,
  tools: [ShellTool, ReadFileTool, FindTool, ExplorerTool],
  prompt: "./smoke.agent.md",
  contract: DefaultAgentContract,
})
export class SmokeAgent {}
