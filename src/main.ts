import { bootstrapWorkflow } from "@thenajs/core";
import { ExplorerWorkflow } from "./workflows/explorer.workflow.js";
import { config } from "./config.js";

const app = await bootstrapWorkflow(ExplorerWorkflow, config);

await app.run({
  input: {
    message: "Olá",
  },
  memory: {
    userId: "123",
    sessionId: "abc",
  },
});
