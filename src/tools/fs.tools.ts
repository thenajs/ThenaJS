import { readdir } from "node:fs/promises";
import { z } from "zod";
import type { ToolType } from "@thenajs/core";

/**
 * Tool em **formato de objeto** — o outro jeito de declarar uma tool, ao lado da
 * classe `@Tool`. O framework aceita os dois, e a `ParallelTool` despacha os
 * dois igualmente: ela recebe as irmãs já resolvidas por `@tools()`.
 */

export const listDir: ToolType = {
  name: "list_dir",
  description: "Lista os arquivos e pastas de um diretório do projeto.",
  schema: z.object({
    path: z.string().describe("caminho relativo, ex.: src/tools"),
  }),
  async execute({ path }: { path: string }) {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
        .join("\n");
    } catch (err) {
      return {
        content: `Não consegui listar "${path}": ${(err as Error).message}`,
        isError: true,
      };
    }
  },
};
