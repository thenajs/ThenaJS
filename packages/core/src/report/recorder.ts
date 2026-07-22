import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type ExecutionKind =
  | "workflow"
  | "loop"
  | "parallel"
  | "agent"
  | "chat"
  | "tool";

/** Um nó da árvore de execução capturada para o report. */
export interface ExecutionNode {
  id: string;
  kind: ExecutionKind;
  name: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: "ok" | "error";
  error?: string;
  data: Record<string, unknown>;
  children: ExecutionNode[];
}

type OnComplete = (root: ExecutionNode) => void;

/**
 * Recorder interno e leve, usado só para gerar o report da execução. Constrói
 * a árvore via AsyncLocalStorage (parentesco correto mesmo em `parallel`). Fica
 * no-op quando não há report configurado (overhead ~zero).
 */
export class ReportRecorder {
  private als = new AsyncLocalStorage<ExecutionNode>();
  private onComplete?: OnComplete;
  private maxLen: number;

  constructor(opts: { onComplete?: OnComplete; maxContentLength?: number } = {}) {
    this.onComplete = opts.onComplete;
    this.maxLen = opts.maxContentLength ?? 20000;
  }

  get active(): boolean {
    return this.onComplete != null;
  }

  async around<T>(
    kind: ExecutionKind,
    name: string,
    fn: (node: ExecutionNode) => Promise<T>,
    data: Record<string, unknown> = {},
  ): Promise<T> {
    if (!this.active) {
      // Sem report: não captura nada, só executa.
      return fn({
        id: "",
        kind,
        name,
        startedAt: 0,
        status: "ok",
        data,
        children: [],
      });
    }
    const parent = this.als.getStore();
    const node: ExecutionNode = {
      id: randomUUID(),
      kind,
      name,
      startedAt: Date.now(),
      status: "ok",
      data,
      children: [],
    };
    if (parent) parent.children.push(node);
    try {
      return await this.als.run(node, () => fn(node));
    } catch (err) {
      node.status = "error";
      node.error = (err as Error)?.message ?? String(err);
      throw err;
    } finally {
      node.endedAt = Date.now();
      node.durationMs = node.endedAt - node.startedAt;
      if (!parent) this.onComplete?.(node);
    }
  }

  /** Grava conteúdo (prompt/resposta/tool I/O) no nó — truncado. */
  capture(node: ExecutionNode, content: Record<string, string | undefined>): void {
    if (!this.active) return;
    for (const [key, value] of Object.entries(content)) {
      if (value == null) continue;
      node.data[key] =
        value.length > this.maxLen ? value.slice(0, this.maxLen) + "…" : value;
    }
  }
}

// Recorder ativo do processo (no-op por padrão).
const NOOP = new ReportRecorder();
let current: ReportRecorder = NOOP;

export function setRecorder(rec: ReportRecorder): void {
  current = rec;
}
export function resetRecorder(): void {
  current = NOOP;
}
export function recorder(): ReportRecorder {
  return current;
}
