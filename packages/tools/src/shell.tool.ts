import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Tool } from "@mimir-js/core";
import { z } from "zod";

const run = promisify(exec);

@Tool({
  name: "shell",
  description: "Executa um comando shell e retorna a saída.",
  schema: z.object({ command: z.string() }),
})
export class ShellTool {
  async execute({ command }: { command: string }) {
    const { stdout, stderr } = await run(command);
    return stdout || stderr;
  }
}
