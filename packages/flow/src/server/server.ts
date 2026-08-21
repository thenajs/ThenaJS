import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecutionEvent } from "@thenajs/core";
import type { FlowOptions } from "../types.js";
import { RunHistory } from "./memory.js";

/** Onde o Vite deixa a interface, ao lado do JS compilado do servidor. */
const UI_DIR = fileURLToPath(new URL("../ui/", import.meta.url));

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

/**
 * O site do Flow: serve a interface e transmite os eventos por SSE.
 *
 * SSE e não WebSocket porque o fluxo é de mão única — servidor para navegador.
 * Sai de graça em cima do `node:http`, reconecta sozinho no browser e não
 * acrescenta uma dependência de runtime ao pacote.
 */
export class FlowServer {
  private server?: Server;
  private clients = new Set<ServerResponse>();
  private history: RunHistory;
  private heartbeat?: NodeJS.Timeout;

  readonly port: number;
  readonly host: string;

  constructor(private opts: FlowOptions = {}) {
    this.port = opts.port ?? 4100;
    this.host = opts.host ?? "127.0.0.1";
    this.history = new RunHistory(opts.maxRuns ?? 20);
  }

  get url(): string {
    return `http://${this.host}:${this.port}`;
  }

  async start(): Promise<void> {
    const server = createServer((req, res) => {
      this.route(req, res).catch((err) => {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end(String((err as Error)?.message ?? err));
      });
    });

    await new Promise<void>((resolve, reject) => {
      const falhou = (err: NodeJS.ErrnoException) => {
        server.removeListener("listening", subiu);
        reject(
          err.code === "EADDRINUSE"
            ? new Error(
                `a porta ${this.port} já está em uso. Passe outra em ` +
                  `thenaFlow({ port: … }).`,
                { cause: err },
              )
            : err,
        );
      };
      const subiu = () => {
        server.removeListener("error", falhou);
        resolve();
      };
      server.once("error", falhou);
      server.once("listening", subiu);
      server.listen(this.port, this.host);
    });

    this.server = server;

    // Comentário periódico: mantém a conexão viva através de proxies que cortam
    // streams ociosos.
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) client.write(": heartbeat\n\n");
    }, 15_000);
    this.heartbeat.unref();

    if (this.opts.log !== false) {
      console.log(`[thena-flow] Live run at ${this.url}`);
    }
  }

  /** Recebe um evento do recorder e o repassa a quem estiver olhando. */
  publish(evento: ExecutionEvent): void {
    const { evento: stamped, run } = this.history.record(evento);
    if (run) this.send("run", run);
    this.send("event", stamped);
  }

  async stop(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const client of this.clients) client.end();
    this.clients.clear();

    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", this.url).pathname;

    if (path === "/api/events") return this.openStream(res);

    if (path.startsWith("/api/runs/")) {
      const events = this.history.eventsOf(path.slice("/api/runs/".length));
      return this.json(
        res,
        events ? { events } : { error: "run not found" },
        events ? 200 : 404,
      );
    }

    return this.serveFile(path, res);
  }

  /** Conexão SSE: manda o estado atual e depois vai emendando os eventos. */
  private openStream(res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Sem isto, um proxy com buffer segura o stream inteiro até o fim da run.
      "x-accel-buffering": "no",
    });
    res.write(`event: snapshot\ndata: ${JSON.stringify(this.history.snapshot())}\n\n`);

    this.clients.add(res);
    res.on("close", () => this.clients.delete(res));
  }

  private send(kind: string, payload: unknown): void {
    if (!this.clients.size) return;
    const frame = `event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.clients) {
      // Best-effort: um cliente que caiu no meio da escrita não pode derrubar a
      // execução que está sendo observada.
      try {
        client.write(frame);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  private json(res: ServerResponse, body: unknown, status = 200): void {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  }

  private async serveFile(path: string, res: ServerResponse): Promise<void> {
    const relative = normalize(path === "/" ? "index.html" : path.slice(1));

    // Nunca sair do diretório da interface, mesmo com `..` na URL.
    if (relative.startsWith("..") || relative.startsWith(sep)) {
      res.writeHead(403).end();
      return;
    }

    const file = join(UI_DIR, relative);
    try {
      const content = await readFile(file);
      res.writeHead(200, {
        "content-type": MIME_TYPES[extname(file)] ?? "application/octet-stream",
      });
      res.end(content);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("not found");
    }
  }
}
