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

/** Evento emitido ao vivo no início/fim de cada passo (para logging). */
export interface ExecutionEvent {
  phase: "start" | "end";
  kind: ExecutionKind;
  name: string;
  /** Profundidade na árvore (0 = raiz), útil para indentação. */
  depth: number;
  id: string;
  parentId?: string;
  /** Presente no `end`. */
  durationMs?: number;
  /** Presente no `end`. */
  status?: "ok" | "error";
  /** Mensagem de erro, se houve — presente no `end`. */
  error?: string;
  /** Payload de domínio do nó (prompt/resposta/tool I/O) — presente no `end`. */
  data?: Record<string, unknown>;
}

type OnComplete = (root: ExecutionNode) => void;
type OnEvent = (event: ExecutionEvent) => void;

interface Frame {
  node: ExecutionNode;
  depth: number;
}

/**
 * Recorder interno e leve. Constrói a árvore da execução via AsyncLocalStorage
 * (parentesco correto mesmo em `parallel`) e, opcionalmente, emite eventos ao
 * vivo (`onEvent`) e/ou a árvore final (`onComplete`). No-op quando nenhum dos
 * dois está configurado (overhead ~zero).
 */
export class ReportRecorder {
  private als = new AsyncLocalStorage<Frame>();
  private onComplete?: OnComplete;
  private onEvent?: OnEvent;
  private captureContent: boolean;
  private maxLen: number;

  constructor(
    opts: {
      onComplete?: OnComplete;
      onEvent?: OnEvent;
      captureContent?: boolean;
      maxContentLength?: number;
    } = {},
  ) {
    this.onComplete = opts.onComplete;
    this.onEvent = opts.onEvent;
    this.captureContent = opts.captureContent ?? true;
    this.maxLen = opts.maxContentLength ?? 20000;
  }

  get active(): boolean {
    return this.onComplete != null || this.onEvent != null;
  }

  async around<T>(
    kind: ExecutionKind,
    name: string,
    fn: (node: ExecutionNode) => Promise<T>,
    data: Record<string, unknown> = {},
  ): Promise<T> {
    if (!this.active) {
      // Sem observação: não captura nada, só executa.
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
    const depth = parent ? parent.depth + 1 : 0;
    const node: ExecutionNode = {
      id: randomUUID(),
      kind,
      name,
      startedAt: Date.now(),
      status: "ok",
      data,
      children: [],
    };
    if (parent) parent.node.children.push(node);
    this.emit("start", node, depth, parent?.node.id);

    try {
      return await this.als.run({ node, depth }, () => fn(node));
    } catch (err) {
      node.status = "error";
      node.error = (err as Error)?.message ?? String(err);
      throw err;
    } finally {
      node.endedAt = Date.now();
      node.durationMs = node.endedAt - node.startedAt;
      this.emit("end", node, depth, parent?.node.id);
      if (!parent) this.onComplete?.(node);
    }
  }

  /** Grava conteúdo (prompt/resposta/tool I/O) no nó — truncado. */
  capture(node: ExecutionNode, content: Record<string, string | undefined>): void {
    if (!this.active || !this.captureContent) return;
    for (const [key, value] of Object.entries(content)) {
      if (value == null) continue;
      node.data[key] =
        value.length > this.maxLen ? value.slice(0, this.maxLen) + "…" : value;
    }
  }

  private emit(
    phase: "start" | "end",
    node: ExecutionNode,
    depth: number,
    parentId?: string,
  ): void {
    if (!this.onEvent) return;
    try {
      this.onEvent({
        phase,
        kind: node.kind,
        name: node.name,
        depth,
        id: node.id,
        parentId,
        durationMs: phase === "end" ? node.durationMs : undefined,
        status: phase === "end" ? node.status : undefined,
        error: phase === "end" ? node.error : undefined,
        data: phase === "end" ? node.data : undefined,
      });
    } catch {
      // best-effort: falha no logger nunca afeta a execução
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
