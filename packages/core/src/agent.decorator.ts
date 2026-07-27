import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCallerFile } from "./resolve-caller.js";
import { setAgentMetadata } from "./metadata.js";
import type { AgentConfig } from "./types.js";

/**
 * Resolve o caminho do markdown a partir do `prompt` (obrigatório) da config:
 * - `URL`          -> `import.meta.url` / caminho de módulo (sem stack trace);
 * - string absoluta-> usada direto (sem stack trace);
 * - string relativa-> relativa à pasta do arquivo do agente.
 */
function resolveMarkdownPath(source: AgentConfig["prompt"]): string {
  if (source === undefined || source === null) {
    throw new Error("[@Agent] O campo 'prompt' é obrigatório.");
  }
  if (source instanceof URL) {
    return fileURLToPath(source);
  }
  if (isAbsolute(source)) {
    return source;
  }
  return resolve(dirname(resolveCallerFile()), source);
}

/**
 * Decorator de agente.
 *
 * Registra a classe como um agente e carrega o prompt em markdown a partir do
 * caminho informado em `config.prompt` (obrigatório).
 */
export function Agent(config: AgentConfig): ClassDecorator {
  // Resolvido aqui (fábrica), pois este ponto é chamado de forma síncrona
  // a partir do módulo `.agent.ts` durante o carregamento.
  const mdPath = resolveMarkdownPath(config.prompt);

  let prompt: string;
  try {
    prompt = readFileSync(mdPath, "utf-8");
  } catch {
    throw new Error(`[@Agent] Prompt markdown não encontrado: ${mdPath}`);
  }

  return (target) => {
    setAgentMetadata(target, {
      provider: config.provider,
      tools: config.tools ?? [],
      prompt,
      sampling: config.sampling,
    });
  };
}
