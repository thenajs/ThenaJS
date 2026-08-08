import type { ThenaPlugin } from "@thenajs/core";
import { FlowServer } from "./server/servidor.js";
import type { FlowOptions } from "./tipos.js";

/**
 * Sobe o site do Flow e transmite a execução para ele ao vivo.
 *
 * ```ts
 * const app = Thena.create(MeuWorkflow, { log: true });
 * await app.use(thenaFlow({ port: 4100 }));
 * await app.run({ input: { message: "olá" } });
 * ```
 *
 * O servidor segura o processo aberto depois do `run`, para dar tempo de olhar
 * o resultado. Feche com `Ctrl+C` ou `await app.dispose()`.
 */
export function thenaFlow(options: FlowOptions = {}): ThenaPlugin {
  const server = new FlowServer(options);

  return {
    name: "thena-flow",

    async setup() {
      await server.start();
    },

    onEvent(evento) {
      server.publish(evento);
    },

    async dispose() {
      await server.stop();
    },
  };
}
