import { fileURLToPath } from "node:url";

/**
 * Arquivos internos do framework que aparecem no stack antes do agente.
 *
 * ⚠️ Estes **nomes de arquivo são contrato**. Renomear `agent.decorator.ts`
 * para algo como `agent.ts` faz esta regex parar de casar, e o
 * `resolveCallerFile` passa a devolver o arquivo do próprio framework — todo
 * `@Agent({ prompt: "./x.agent.md" })` com caminho relativo quebra.
 *
 * O filtro é por **nome de arquivo**, e não por diretório, de propósito: source
 * maps reescrevem os caminhos de `dist/` de volta para `src/` no stack, então
 * qualquer checagem baseada em pasta seria frágil. Pelo mesmo motivo, não dá
 * para comparar com `import.meta.url` — ele aponta para o `dist/` real.
 */
const INTERNAL = /(?:^|[\\/])(agent\.decorator|resolve-caller)\.[cm]?[jt]s$/;

/** Extrai um caminho de arquivo (`file://...` ou absoluto) de uma linha de stack. */
function extractPath(frame: string): string | null {
  const match = frame.match(/\(?((?:file:\/\/|\/)[^)]+?):\d+:\d+\)?\s*$/);
  if (!match) return null;
  const raw = match[1];
  return raw.startsWith("file://") ? fileURLToPath(raw) : raw;
}

/**
 * Descobre o arquivo `.agent.ts` que chamou o decorator, inspecionando o
 * stack trace. Pula os frames internos do framework e os do Node, retornando
 * o primeiro arquivo do usuário. É assim que o Thena encontra o `.agent.md`
 * irmão sem que o caminho seja informado.
 *
 * Filtra por nome de arquivo (não por diretório) para ser imune a source maps,
 * que reescrevem os caminhos de `dist/` de volta para `src/` no stack.
 */
export function resolveCallerFile(): string {
  const stack = new Error().stack ?? "";
  const frames = stack.split("\n").slice(1);

  for (const frame of frames) {
    const filePath = extractPath(frame);
    if (!filePath) continue;
    if (INTERNAL.test(filePath)) continue;
    if (filePath.includes("node:")) continue;
    return filePath;
  }

  throw new Error(
    "[@Agent] Não foi possível descobrir o arquivo do agente pelo stack trace.",
  );
}
