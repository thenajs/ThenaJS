import { Tool, context, input } from "@thenajs/core";
import type { Context } from "@thenajs/core";
import { z } from "zod";
import type { DadosDaConta } from "../execucao";

@Tool({
  name: "quem_sou",
  description: "Diz de qual conta é a execução atual.",
  schema: z.object({}),
})
export class QuemSouTool {
  execute(@input() _args: unknown, @context() ctx: Context<DadosDaConta>) {
    // O `ctx` aqui é o **mesmo objeto** que a factory do provider lê com
    // `context()`. Duas portas, um objeto: decorator dentro da tool, função
    // em qualquer outro lugar da execução.
    console.log(
      `[tool]     runId=${ctx.runId.slice(0, 8)} tenantId=${ctx.data.tenantId}`,
    );

    return `Esta execução é da conta ${ctx.data.tenantId}.`;
  }
}
