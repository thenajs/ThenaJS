import { AsyncLocalStorage } from "node:async_hooks";
import { resolveRedact } from "./redact.js";
import type { RedactConfig } from "./redact.js";

export type ExecutionKind =
  "workflow" | "loop" | "parallel" | "agent" | "chat" | "tool";

/**
 * Id dos nós. Um contador em vez de `randomUUID()`: é id local da árvore de
 * uma execução, não precisa ser único no universo nem imprevisível — e
 * `randomUUID` é `crypto` de verdade, cobrado por nó.
 *
 * O `runId`, esse sim, continua sendo um UUID.
 */
let proximoNo = 0;

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
  /**
   * A qual execução o evento pertence. Sem isto, um consumidor que recebe
   * eventos de runs concorrentes não tem como separá-los — era assim que o
   * Flow embaralhava duas execuções numa só.
   */
  runId: string;
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
 *
 * **Um por execução**, criado pelo `RunContext`. Já foi um singleton de módulo,
 * e era por isso que duas runs concorrentes misturavam suas árvores.
 */
export class ReportRecorder {
  private als = new AsyncLocalStorage<Frame>();
  private onComplete?: OnComplete;
  /**
   * Vários ouvintes: o `log` do config é um, e cada plugin registrado por
   * `app.use()` é outro. Um plugin nunca toma o lugar do seu logger.
   */
  private listeners: OnEvent[] = [];
  private captureContent: boolean;
  private maxLen: number;
  /** Mascara segredo antes de gravar. Ligado por padrão. */
  private readonly redact: (field: string, value: string) => string;

  /** Carimbado em todo evento, para o consumidor separar runs concorrentes. */
  readonly runId: string;

  constructor(
    opts: {
      runId?: string;
      onComplete?: OnComplete;
      onEvent?: OnEvent | OnEvent[];
      captureContent?: boolean;
      maxContentLength?: number;
      redact?: RedactConfig;
    } = {},
  ) {
    this.runId = opts.runId ?? "";
    this.onComplete = opts.onComplete;
    if (opts.onEvent) {
      this.listeners.push(
        ...(Array.isArray(opts.onEvent) ? opts.onEvent : [opts.onEvent]),
      );
    }
    this.captureContent = opts.captureContent ?? true;
    this.maxLen = opts.maxContentLength ?? 20000;
    this.redact = resolveRedact(opts.redact);
  }

  get active(): boolean {
    return this.onComplete != null || this.listeners.length > 0;
  }

  /** Acrescenta um ouvinte do stream ao vivo. Devolve como removê-lo. */
  ouvir(ouvinte: OnEvent): () => void {
    this.listeners.push(ouvinte);
    return () => {
      const i = this.listeners.indexOf(ouvinte);
      if (i >= 0) this.listeners.splice(i, 1);
    };
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
      id: `n${++proximoNo}`,
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
      // Mensagem de erro é o lugar clássico de vazar credencial — um erro de
      // driver de banco traz a connection string inteira.
      node.error = this.redact("error", (err as Error)?.message ?? String(err));
      throw err;
    } finally {
      node.endedAt = Date.now();
      node.durationMs = node.endedAt - node.startedAt;
      this.emit("end", node, depth, parent?.node.id);
      if (!parent) this.onComplete?.(node);
    }
  }

  /**
   * Grava metadados estruturados no nó (iterações, exaustão, usage, flags).
   * Diferente de `capture`: não é conteúdo, então não trunca nem depende de
   * `captureContent` — é o que torna a telemetria mensurável sem regex.
   */
  meta(node: ExecutionNode, data: Record<string, unknown>): void {
    if (!this.active) return;
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      node.data[key] = value;
    }
  }

  /**
   * O mesmo que `meta`, mas no nó que está aberto **agora** — o passo em que
   * quem chamou está executando.
   *
   * É o que permite uma tool escrever telemetria sem receber o nó por
   * parâmetro: o `around` já mantém o frame na ALS, então "o nó atual" é uma
   * pergunta que o recorder sabe responder sozinho. No-op fora de qualquer
   * passo, ou sem observação ativa.
   */
  currentMeta(data: Record<string, unknown>): void {
    const node = this.als.getStore()?.node;
    if (node) this.meta(node, data);
  }

  /**
   * Marca o nó como erro **sem lançar** — para falhas observadas, em que a
   * execução segue (ex.: tool que devolveu `isError: true`).
   */
  markError(node: ExecutionNode, message: string): void {
    if (!this.active) return;
    node.status = "error";
    node.error = this.redact("error", message);
  }

  /** Grava conteúdo (prompt/resposta/tool I/O) no nó — truncado. */
  capture(node: ExecutionNode, content: Record<string, string | undefined>): void {
    if (!this.active || !this.captureContent) return;
    for (const [key, value] of Object.entries(content)) {
      if (value == null) continue;
      const limpo = this.redact(key, value);
      node.data[key] =
        limpo.length > this.maxLen ? limpo.slice(0, this.maxLen) + "…" : limpo;
    }
  }

  private emit(
    phase: "start" | "end",
    node: ExecutionNode,
    depth: number,
    parentId?: string,
  ): void {
    if (!this.listeners.length) return;

    const evento: ExecutionEvent = {
      phase,
      kind: node.kind,
      name: node.name,
      runId: this.runId,
      depth,
      id: node.id,
      parentId,
      durationMs: phase === "end" ? node.durationMs : undefined,
      status: phase === "end" ? node.status : undefined,
      error: phase === "end" ? node.error : undefined,
      data: phase === "end" ? node.data : undefined,
    };

    // Best-effort e isolado: um ouvinte que lança não afeta a execução nem os
    // outros ouvintes.
    for (const ouvinte of this.listeners) {
      try {
        ouvinte(evento);
      } catch {
        /* ignorado de propósito */
      }
    }
  }
}
