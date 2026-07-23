import { Tool } from "@thenajs/core";
import { readFile } from "node:fs/promises";
import { z } from "zod";

@Tool({
  name: "read_file",
  description: "Lê o conteúdo de um arquivo.",
  schema: z.object({
    path: z.string(),
  }),
})
export class ReadFileTool {
  async execute({ path }: { path: string }) {
    return readFile(path, "utf8");
  }
}
