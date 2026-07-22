import { Tool, WorkflowRuntime } from "@mimir-js/core";
import { z } from "zod";

import { DeployWorkflow } from "../workflows/deploy.workflow.js";

@Tool({
  name: "deploy",
  description: "Executa o workflow de deploy.",
  schema: z.object({
    repository: z.string(),
  }),
})
export class DeployTool {
  constructor(private readonly runtime: WorkflowRuntime) {}

  async execute(input: { repository: string }) {
    return this.runtime.run(DeployWorkflow, {
      input,
    });
  }
}
