import { Thena } from "@thenajs/core";
import { ExplorerWorkflow } from "./workflows/explorer.workflow.js";
import { config } from "./config.js";

const app = Thena.create(ExplorerWorkflow, config);

// Para acompanhar a execução ao vivo, num grafo no navegador:
//
//   import { thenaFlow } from "@thenajs/flow";
//   await app.use(thenaFlow());
//
// O site fica em http://127.0.0.1:4100 e segura o processo aberto depois do
// `run` — encerre com Ctrl+C, ou com `await app.dispose()`.

// O `run` devolve a saída e **propaga** o erro — quem imprime é a aplicação,
// não o framework. Chamadas concorrentes são seguras: cada uma tem seu contexto.
const saida = await app.run({
  prompt:
    "Compare os arquivos src/config.ts e src/main.ts: o que cada um faz? " +
    "Leia os dois antes de responder.",

  // O `state` é de onde a execução parte. Aqui só o `memory` — conteúdo
  // durável, projetado numa mensagem `system`. Num segundo turno de conversa,
  // é aqui que também entraria o `history` do turno anterior.
  state: {
    memory: ["userId: 123", "sessionId: abc"],
  },
});

console.log(saida);
