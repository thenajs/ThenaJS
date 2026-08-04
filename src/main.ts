import { bootstrapWorkflow } from "@thenajs/core";
import { ExplorerWorkflow } from "./workflows/explorer.workflow.js";
import { config } from "./config.js";

const app = await bootstrapWorkflow(ExplorerWorkflow, config);

// Para acompanhar a execução ao vivo, num grafo no navegador:
//
//   import { thenaFlow } from "@thenajs/flow";
//   await app.use(thenaFlow());
//
// O site fica em http://127.0.0.1:4100 e segura o processo aberto depois do
// `run` — encerre com Ctrl+C, ou com `await app.dispose()`.

await app.run({
  input: {
    message: "Olá",
  },
  memory: {
    userId: "123",
    sessionId: "abc",
  },
});
