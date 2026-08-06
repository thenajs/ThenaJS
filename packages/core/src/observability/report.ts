import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecutionNode } from "./recorder.js";
import type { ReportOptions } from "../config.js";

/** O resumo de uma run, lido de volta do disco para montar o índice. */
interface ResumoDeRun {
  runId: string;
  nome: string;
  status: string;
  durationMs: number;
  startedAt: number;
}

/**
 * Escreve o report (HTML e/ou JSON) e devolve o caminho principal.
 *
 * Cada execução ganha a própria subpasta (`<dir>/<runId>/`). Antes o caminho
 * era fixo, e duas runs concorrentes sobrescreviam o report uma da outra.
 * O `<dir>/index.html` passa a ser um índice das runs.
 */
export function writeReport(
  root: ExecutionNode,
  opts: ReportOptions & { runId?: string } = {},
): string {
  const base = opts.dir ?? "report";
  const format = opts.format ?? "both";
  const runId = opts.runId ?? root.id ?? "run";
  const dir = join(base, runId);
  mkdirSync(dir, { recursive: true });

  let main = "";
  if (format === "json" || format === "both") {
    const jsonPath = join(dir, "report.json");
    writeFileSync(jsonPath, JSON.stringify(root, null, 2));
    main = jsonPath;
  }
  if (format === "html" || format === "both") {
    const htmlPath = join(dir, "index.html");
    writeFileSync(htmlPath, renderHtml(root));
    main = htmlPath;
    escreverIndice(base);
  }
  return main;
}

/**
 * Regenera o índice das runs a partir do que está no disco — sem estado
 * acumulado em memória, então funciona também entre processos diferentes.
 */
function escreverIndice(base: string): void {
  const runs: ResumoDeRun[] = [];

  for (const entrada of readdirSync(base, { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue;
    try {
      const node: ExecutionNode = JSON.parse(
        readFileSync(join(base, entrada.name, "report.json"), "utf-8"),
      );
      runs.push({
        runId: entrada.name,
        nome: node.name,
        status: node.status,
        durationMs: node.durationMs ?? 0,
        startedAt: node.startedAt,
      });
    } catch {
      // Subpasta sem report.json legível (run em andamento, formato "html",
      // lixo antigo). Fica de fora do índice em vez de derrubar a escrita.
    }
  }

  runs.sort((a, b) => b.startedAt - a.startedAt);
  writeFileSync(join(base, "index.html"), renderIndice(runs));
}

// ---------- helpers ----------

function esc(s: unknown): string {
  return String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

function pretty(v: unknown): string {
  try {
    return JSON.stringify(JSON.parse(String(v)), null, 2);
  } catch {
    return String(v ?? "");
  }
}

function ms(n?: number): string {
  const v = n ?? 0;
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(0)} ms`;
}

function count(root: ExecutionNode, kind: string): number {
  let n = 0;
  const walk = (x: ExecutionNode) => {
    if (x.kind === kind) n++;
    x.children.forEach(walk);
  };
  root.children.forEach(walk);
  return n;
}

function errors(root: ExecutionNode): number {
  let n = 0;
  const walk = (x: ExecutionNode) => {
    if (x.status === "error") n++;
    x.children.forEach(walk);
  };
  walk(root);
  return n;
}

// ---------- content ----------

function block(label: string, value: string): string {
  return `<div class="block"><div class="block-label">${esc(label)}</div><pre>${esc(value)}</pre></div>`;
}

function messages(promptJson: string): string {
  let arr: { role: string; content: string }[];
  try {
    arr = JSON.parse(promptJson);
    if (!Array.isArray(arr)) throw new Error();
  } catch {
    return block("Enviado ao modelo", pretty(promptJson));
  }
  const rows = arr
    .map((m) => {
      const isMemory = m.role === "system" && (m.content ?? "").trim().startsWith("{");
      const role = isMemory ? "memória" : m.role;
      return `<div class="msg"><span class="role role-${esc(m.role)}">${esc(role)}</span><pre>${esc(m.content)}</pre></div>`;
    })
    .join("");
  return `<div class="block"><div class="block-label">Enviado ao modelo (${arr.length} msgs)</div>${rows}</div>`;
}

function content(node: ExecutionNode): string {
  const d = node.data;
  const parts: string[] = [];
  if (d.prompt != null) parts.push(messages(String(d.prompt)));
  if (d.response != null && String(d.response).length)
    parts.push(block("Resposta", String(d.response)));
  if (d.toolCall != null) parts.push(block("Decisão (tool call)", pretty(d.toolCall)));
  if (d.input != null) parts.push(block("Tool · input", pretty(d.input)));
  if (d.output != null) parts.push(block("Tool · output", String(d.output)));
  const facts = signals(node);
  if (facts.length) parts.push(block("Sinais", facts.join("\n")));
  if (node.error) parts.push(block("Erro", node.error));
  return parts.join("");
}

/**
 * Metadados medíveis do nó (exaustão, origem da tool call, tokens, orçamento).
 * Ficam sempre visíveis — a intenção é não precisar de regex sobre o texto para
 * medir uma execução.
 */
function signals(node: ExecutionNode): string[] {
  const d = node.data;
  const out: string[] = [];

  if (d.exhausted === true)
    out.push(`loop exausto — parou em ${d.iterations} de ${d.maxIterations} iterações`);
  if (d.toolCallSource != null) out.push(`tool call: ${d.toolCallSource}`);
  if (d.attempts != null) out.push(`${d.attempts} tentativas HTTP (houve retry)`);
  if (d.isError === true) out.push("tool sinalizou erro (isError)");
  if (d.promptTokens != null || d.completionTokens != null)
    out.push(`tokens: ${d.promptTokens ?? "?"} prompt + ${d.completionTokens ?? "?"} completion`);
  if (d.costUsd != null) out.push(`custo: US$ ${Number(d.costUsd).toFixed(6)}`);
  if (node.kind === "workflow" && d.chatCalls != null)
    out.push(
      `orçamento: ${d.chatCalls} chats · ${d.toolCalls} tools · ${d.tokens} tokens` +
        (d.exceeded === true ? " · ESTOURADO" : ""),
    );

  return out;
}

// ---------- tree ----------

function label(node: ExecutionNode): string {
  if (node.kind === "loop") {
    // `children.length` é iterações × passos; o número real vem do nó.
    const n = Number(node.data.iterations ?? node.children.length);
    const exhausted = node.data.exhausted === true ? " · exausto" : "";
    return `loop · ${n} iteraç${n === 1 ? "ão" : "ões"}${exhausted}`;
  }
  if (node.kind === "parallel") return "paralelo";
  if (node.kind === "chat") return "chat";
  return node.name;
}

function renderNode(node: ExecutionNode): string {
  const body = content(node);
  const children = node.children.map(renderNode).join("");
  const err = node.status === "error" ? '<span class="err">erro</span>' : "";
  const open = node.kind === "workflow" || node.kind === "loop" || node.kind === "parallel";
  return `<details class="node k-${node.kind}"${open ? " open" : ""}>
    <summary><span class="badge b-${node.kind}">${esc(node.kind)}</span> <span class="name">${esc(label(node))}</span> <span class="dur">${ms(node.durationMs)}</span> ${err}</summary>
    <div class="body">${body}${children}</div>
  </details>`;
}

function renderHtml(root: ExecutionNode): string {
  const stat = (l: string, v: string | number) =>
    `<div class="stat"><div class="stat-v">${esc(v)}</div><div class="stat-l">${esc(l)}</div></div>`;
  const stats = [
    stat("Status", root.status === "error" ? "erro" : "ok"),
    stat("Duração", ms(root.durationMs)),
    stat("Agentes", count(root, "agent")),
    stat("Tool calls", count(root, "tool")),
    stat("Erros", errors(root)),
  ].join("");
  const tree = root.children.map(renderNode).join("");
  const when = new Date(root.startedAt).toLocaleString();

  return `<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ThenaJS Report — ${esc(root.name)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f6f7f9; color: #1a1c1e; }
  @media (prefers-color-scheme: dark) { body { background: #14161a; color: #e6e8eb; } }
  .wrap { max-width: 980px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  .sub { color: #6b7280; margin-bottom: 20px; }
  .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 24px; }
  .stat { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; }
  @media (prefers-color-scheme: dark) { .stat { background: #1c1f24; border-color: #2a2e35; } }
  .stat-v { font-size: 20px; font-weight: 600; }
  .stat-l { font-size: 12px; color: #6b7280; }
  details.node { border-left: 2px solid #e5e7eb; margin: 4px 0 4px 4px; padding-left: 10px; }
  @media (prefers-color-scheme: dark) { details.node { border-color: #2a2e35; } }
  summary { cursor: pointer; padding: 4px 0; list-style: none; display: flex; align-items: center; gap: 8px; }
  summary::-webkit-details-marker { display: none; }
  .badge { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 20px; text-transform: uppercase; letter-spacing: .3px; }
  .b-workflow { background: #e5e7eb; color: #374151; }
  .b-agent { background: #e0e7ff; color: #3730a3; }
  .b-chat { background: #dcfce7; color: #166534; }
  .b-tool { background: #ffedd5; color: #9a3412; }
  .b-loop { background: #fef3c7; color: #92400e; }
  .b-parallel { background: #ede9fe; color: #5b21b6; }
  .name { font-weight: 600; }
  .dur { color: #6b7280; font-size: 12px; }
  .err { background: #fee2e2; color: #991b1b; font-size: 11px; padding: 1px 6px; border-radius: 20px; }
  .body { padding: 2px 0 6px 8px; }
  .block { margin: 8px 0; }
  .block-label { font-size: 11px; font-weight: 600; color: #6b7280; margin-bottom: 3px; text-transform: uppercase; letter-spacing: .3px; }
  pre { margin: 0; padding: 8px 10px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: auto; max-height: 320px; white-space: pre-wrap; word-break: break-word; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  @media (prefers-color-scheme: dark) { pre { background: #1c1f24; border-color: #2a2e35; } }
  .msg { margin: 4px 0; }
  .role { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #6b7280; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>${esc(root.name)}</h1>
    <div class="sub">ThenaJS · report de execução · ${esc(when)}</div>
    <div class="stats">${stats}</div>
    ${tree}
  </div>
</body>
</html>`;
}

/** Índice das runs — o `index.html` da raiz da pasta de report. */
function renderIndice(runs: ResumoDeRun[]): string {
  const linhas = runs
    .map(
      (r) => `<a class="run" href="./${esc(r.runId)}/index.html">
      <span class="name">${esc(r.nome)}</span>
      <span class="dur">${ms(r.durationMs)}</span>
      ${r.status === "error" ? '<span class="err">erro</span>' : ""}
      <span class="when">${esc(new Date(r.startedAt).toLocaleString())}</span>
    </a>`,
    )
    .join("");

  return `<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ThenaJS Reports</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f6f7f9; color: #1a1c1e; }
  @media (prefers-color-scheme: dark) { body { background: #14161a; color: #e6e8eb; } }
  .wrap { max-width: 980px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  .sub { color: #6b7280; margin-bottom: 20px; }
  .run { display: flex; align-items: center; gap: 12px; padding: 12px; margin-bottom: 8px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; text-decoration: none; color: inherit; }
  @media (prefers-color-scheme: dark) { .run { background: #1c1f24; border-color: #2a2e35; } }
  .name { font-weight: 600; }
  .dur, .when { color: #6b7280; font-size: 12px; }
  .when { margin-left: auto; }
  .err { background: #fee2e2; color: #991b1b; font-size: 11px; padding: 1px 6px; border-radius: 20px; }
  .vazio { color: #6b7280; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Execuções</h1>
    <div class="sub">ThenaJS · ${runs.length} run${runs.length === 1 ? "" : "s"}</div>
    ${linhas || '<div class="vazio">Nenhuma execução registrada.</div>'}
  </div>
</body>
</html>`;
}
