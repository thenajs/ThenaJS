import { Tool, input, toToolOutput, tools } from "@thenajs/core";
import type { ToolOutput, ToolType } from "@thenajs/core";
import { z } from "zod";

/**
 * Executa várias tools do próprio agente numa única chamada ao modelo.
 *
 * O ganho é **round-trip**: ler três arquivos custa uma ida ao modelo em vez de
 * três.
 *
 * Ela não recebe tool nenhuma — o `@tools()` entrega as irmãs **já embrulhadas**
 * na cadeia de middleware. É isso que faz cada chamada interna continuar abrindo
 * o próprio nó no report e passando pelos hooks, pela autorização, pelo
 * orçamento e pela política de erro.
 */
@Tool({
  name: "parallel",
  description:
    "Run several of the other available tools at once and return every result. " +
    "Use it when you need two or more calls that do not depend on each other. " +
    "If one call needs another's result, make them in separate turns.",
  schema: z.object({
    calls: z
      .array(
        z.object({
          tool: z.string().describe("the name of one of the other available tools"),
          args: z
            .record(z.string(), z.unknown())
            .describe("that tool's arguments, in the shape it declares"),
        }),
      )
      .min(2, "use this tool only for two or more calls")
      .max(8),
  }),
})
export class ParallelTool {
  async execute(
    @input() { calls }: { calls: { tool: string; args: Record<string, unknown> }[] },
    @tools() siblings: ToolType[],
  ): Promise<ToolOutput> {
    // Sem a si mesma: `parallel` dentro de `parallel` só aninharia lote em lote.
    const available = siblings.filter((t) => t.name !== "parallel");

    const results = await Promise.all(
      calls.map(async (call): Promise<ToolOutput> => {
        const target = available.find((t) => t.name === call.tool);

        if (!target) {
          const names = available.map((t) => t.name).join(", ");
          return {
            content: `unknown tool. Available: ${names}`,
            isError: true,
          };
        }

        try {
          // O schema da irmã é obrigatório aqui: no caminho normal quem valida
          // os argumentos é o provider, e o `buildToolStep` embrulha o `execute`
          // sem validar. Sem este `parse`, a tool receberia lixo tipado errado.
          const args = target.schema.parse(call.args);
          return toToolOutput(await target.execute(args));
        } catch (err) {
          // Falha de uma chamada não pode derrubar o lote: as irmãs já custaram
          // trabalho, e o modelo consegue corrigir só a que errou.
          return { content: (err as Error).message, isError: true };
        }
      }),
    );

    return {
      content: results
        .map((r, i) => {
          const status = r.isError ? "error" : "ok";
          return `[${i + 1}] ${calls[i].tool} → ${status}\n${r.content}`;
        })
        .join("\n\n"),

      // Erro só quando **tudo** falhou: um lote parcialmente bom não é um turno
      // perdido, e marcá-lo como erro faria o `maxFails` do loop contar uma
      // falha que não houve.
      isError: results.every((r) => r.isError),
    };
  }
}
