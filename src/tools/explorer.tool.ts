import { Tool, WorkflowRuntime, input } from "@thenajs/core";
import { z } from "zod";
import { ExploreWorkflow } from "../workflows/explore.workflow.js";

/**
 * Mapeia uma área do projeto, delegando a um sub-agente que por sua vez delega
 * cada busca ao `find`. Três níveis:
 *
 *     fluxo principal → explorer → explore agent → find → finder → arquivos
 *
 * Cada nível comprime. O finder transforma arquivos em um parágrafo; o explore
 * transforma vários parágrafos num mapa. O que chega aqui não tem código
 * dentro — e é por isso que o fluxo principal pode fazer isso várias vezes sem
 * o histórico dele crescer.
 *
 * Use quando a pergunta é ampla ("como funciona X", "o que depende de Y"). Para
 * uma busca só, `find` direto é mais barato: esta tool cobra uma camada inteira
 * de orquestração, e não há o que orquestrar com uma pergunta.
 */
const MAX_CHARS = 3000;

@Tool({
  name: "explorer",
  description:
    "Map an area of the project and get back how its pieces connect. " +
    "Use it for broad questions that need several searches — how a subsystem " +
    "works, what depends on something, what a change would affect. " +
    "For a single lookup, use `find` instead; this one costs more.",
  schema: z.object({
    area: z
      .string()
      .min(3)
      .describe("the area or question to map, in one sentence of plain language"),
  }),
})
export class ExplorerTool {
  constructor(private readonly runtime: WorkflowRuntime) {}

  async execute(@input() { area }: { area: string }) {
    try {
      const map = await this.runtime.run<string>(ExploreWorkflow, {
        prompt: area,
        // Teto do galho inteiro — inclui tudo que os `find` gastarem lá dentro,
        // porque o tracker é encadeado (R-10). Sem isto, uma exploração que não
        // converge consome o orçamento do fluxo principal, e o custo de três
        // níveis multiplica rápido.
        budget: { maxChatCalls: 28, maxCostUsd: 0.15, mode: "stop" },
      });

      const text = map.trim();
      if (!text) {
        return { content: `Exploring "${area}" returned nothing.`, isError: true };
      }

      return text.length <= MAX_CHARS
        ? text
        : `${text.slice(0, MAX_CHARS)}\n… [truncated]`;
    } catch (err) {
      return {
        content: `Exploring "${area}" failed: ${(err as Error).message}`,
        isError: true,
      };
    }
  }
}
