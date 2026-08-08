import { Tool, input, state } from "@thenajs/core";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ExplorerState } from "../workflows/explorer.state.js";

/** Teto de caracteres devolvidos ao modelo, para não entupir o contexto. */
const MAX_CHARS = 4000;

@Tool({
  name: "read_file",
  description: "Lê o conteúdo de um arquivo do projeto.",
  schema: z.object({
    path: z.string().describe("caminho relativo, ex.: src/main.ts"),
  }),
})
export class ReadFileTool {
  /**
   * Os parâmetros dizem o que querem, então a ordem não importa:
   * - `@input()` — os argumentos já validados pelo schema acima;
   * - `@state()` — o estado do workflow, o mesmo objeto que os agentes veem.
   *
   * Sem decorator nenhum, o `execute` recebe só os argumentos — que continua
   * sendo o caso comum, e o mais simples.
   */
  async execute(
    @input() { path }: { path: string },
    @state() workflowState: ExplorerState,
  ) {
    try {
      const conteudo = await readFile(path, "utf8");

      // O revisor lê isto para saber o que já foi investigado.
      workflowState.arquivosLidos.push(path);

      return conteudo.length <= MAX_CHARS
        ? conteudo
        : `${conteudo.slice(0, MAX_CHARS)}\n… [truncado]`;
    } catch (err) {
      // Erro vira observação: o modelo lê e tenta outro caminho, em vez de
      // derrubar a execução inteira.
      return {
        content: `Não consegui ler "${path}": ${(err as Error).message}`,
        isError: true,
      };
    }
  }
}
