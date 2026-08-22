import { Agent } from "@thenajs/core";
import { LocalOllamaProvider } from "../../providers/ollama.provider.js";
import { ReadFileTool } from "../../tools/read-file.tool.js";
import { listDir } from "../../tools/fs.tools.js";
import { ParallelTool } from "@thenajs/tools";

/**
 * As tools registradas são três:
 *
 * - `read_file` (classe) — o caminho direto, com `@state()`, que alimenta o
 *   `arquivosLidos` que o revisor lê;
 * - `list_dir` — para descobrir o que existe antes de ler;
 * - `parallel` — o lote, que despacha as **duas de cima**, sem receber nenhuma:
 *   o `@tools()` entrega as irmãs já embrulhadas.
 *
 * O `parallel` é **opt-in**: bastaria não registrá-lo para o agente voltar ao
 * comportamento de uma tool por turno — que é o que se faria com um modelo
 * fraco demais para montar o lote.
 */
@Agent({
  provider: LocalOllamaProvider,
  tools: [ReadFileTool, listDir, ParallelTool],
  prompt: "./explorer.agent.md",
})
export class ExplorerAgent {}
