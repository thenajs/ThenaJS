import { Tool, WorkflowRuntime, input } from "@thenajs/core";
import { z } from "zod";
import { FindWorkflow } from "../workflows/find.workflow.js";

/**
 * Delega uma busca a um sub-agente, e devolve **só a conclusão**.
 *
 * O ganho é contexto, não capacidade. Quando o agente principal procura algo
 * ele mesmo, cada arquivo aberto vira uma observação no histórico dele — e o
 * histórico inteiro é reenviado a **cada** turno seguinte, para sempre. Dez
 * arquivos lidos no turno 3 continuam sendo pagos no turno 20.
 *
 * Aqui, o sub-agente abre os dez arquivos no histórico dele, que é descartado
 * quando a run aninhada termina. O que atravessa é o texto de resposta.
 *
 * A execução aninhada herda `runId`, recorder, `signal` e — sem `budget`
 * próprio — o teto do pai (R-10). O teto abaixo é encadeado: conta nos dois, e
 * corta quem estourar primeiro. Sem ele, uma busca que não converge gastaria
 * todo o orçamento da execução principal.
 */
const MAX_CHARS = 2000;

@Tool({
  name: "find",
  description:
    "Delegate a search to a sub-agent and get back a short report. " +
    "Use it when you need to locate something in the project — where a symbol " +
    "is defined, which files mention a term, what changed in an area. " +
    "Ask in one sentence, as you would ask a colleague; the sub-agent decides " +
    "how to search and answers with what it found.",
  schema: z.object({
    query: z
      .string()
      .min(3)
      .describe("what to look for, in one sentence of plain language"),
  }),
})
export class FindTool {
  constructor(private readonly runtime: WorkflowRuntime) {}

  async execute(@input() { query }: { query: string }) {
    try {
      const report = await this.runtime.run<string>(FindWorkflow, {
        prompt: query,
        // Teto próprio, encadeado no do pai: uma busca que não converge não
        // pode consumir o orçamento de quem a pediu.
        budget: { maxChatCalls: 10, mode: "stop" },
      });

      const text = report.trim();
      if (!text) {
        return {
          content: `The search for "${query}" returned nothing.`,
          isError: true,
        };
      }

      // Teto de saída: o sub-agente devolvendo um arquivo inteiro anularia o
      // ponto da tool, que é justamente não trazer o arquivo para cá.
      return text.length <= MAX_CHARS
        ? text
        : `${text.slice(0, MAX_CHARS)}\n… [truncated]`;
    } catch (err) {
      // Observação, não exceção: quem chamou decide se tenta outra busca.
      return {
        content: `The search for "${query}" failed: ${(err as Error).message}`,
        isError: true,
      };
    }
  }
}
