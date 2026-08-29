import { Agent, DefaultAgentContract } from "@thenajs/core";
import { NvidiaProvider } from "../../providers/nvidia.provider.js";
import { FindTool } from "../../tools/find.tool.js";

/**
 * Só uma tool, e é de propósito: este agente **não lê arquivos**, delega. É o
 * que mantém o contexto dele composto de relatórios curtos em vez de código,
 * mesmo depois de quatro buscas.
 */
@Agent({
  provider: NvidiaProvider,
  tools: [FindTool],
  prompt: "./explore.agent.md",
  contract: DefaultAgentContract,
})
export class ExploreAgent {}
