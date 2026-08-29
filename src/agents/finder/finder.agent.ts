import { Agent, DefaultAgentContract } from "@thenajs/core";
import { NvidiaProvider } from "../../providers/nvidia.provider.js";
import { ReadFileTool } from "../../tools/read-file.tool.js";
import { ShellTool } from "../../tools/shell.tool.js";
import { listDir } from "../../tools/fs.tools.js";
import { ParallelTool } from "@thenajs/tools";

@Agent({
  provider: NvidiaProvider,
  tools: [ShellTool, ReadFileTool, listDir, ParallelTool],
  prompt: "./finder.agent.md",
  contract: DefaultAgentContract,
})
export class FinderAgent {}
