import type { ExecutionEvent } from "./recorder.js";

function ms(n?: number): string {
  const v = n ?? 0;
  return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${v.toFixed(0)}ms`;
}

/** Rótulo do passo: evita "loop loop" quando name === kind. */
function label(e: ExecutionEvent): string {
  return e.name && e.name !== e.kind ? `${e.kind} ${e.name}` : e.kind;
}

function short(v: unknown, max = 120): string {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/**
 * Logger de console ao vivo (árvore indentada). Com `verbose`, inclui o
 * conteúdo (resposta do chat, I/O das tools) ao final de cada passo.
 */
export function consoleLogger(verbose = false): (event: ExecutionEvent) => void {
  return (e) => {
    const indent = "  ".repeat(e.depth);
    if (e.phase === "start") {
      console.log(`[mimir] ${indent}▸ ${label(e)}`);
      return;
    }
    const mark = e.status === "error" ? "✗" : "✓";
    console.log(`[mimir] ${indent}◂ ${label(e)}  ${ms(e.durationMs)} ${mark}`);

    if (!verbose || !e.data) return;
    const d = e.data;
    if (e.kind === "chat") {
      if (d.toolCall != null) console.log(`[mimir] ${indent}  ↳ decisão: ${short(d.toolCall)}`);
      if (d.response != null && String(d.response).length)
        console.log(`[mimir] ${indent}  ↳ resposta: ${short(d.response)}`);
    }
    if (e.kind === "tool") {
      if (d.input != null) console.log(`[mimir] ${indent}  ↳ input: ${short(d.input)}`);
      if (d.output != null) console.log(`[mimir] ${indent}  ↳ output: ${short(d.output)}`);
    }
    if (e.status === "error" && e.error) {
      console.log(`[mimir] ${indent}  ↳ erro: ${short(e.error)}`);
    }
  };
}
