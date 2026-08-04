import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecutionEvent } from "@thenajs/core";
import type { FlowOptions } from "../tipos.js";
import { MemoriaDeRuns } from "./memoria.js";

/** Onde o Vite deixa a interface, ao lado do JS compilado do servidor. */
const UI_DIR = fileURLToPath(new URL("../ui/", import.meta.url));

const TIPOS: Record<string, string> = {
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
export class ServidorFlow {
  private servidor?: Server;
  private clientes = new Set<ServerResponse>();
  private memoria: MemoriaDeRuns;
  private pulso?: NodeJS.Timeout;

  readonly port: number;
  readonly host: string;

  constructor(private opts: FlowOptions = {}) {
    this.port = opts.port ?? 4100;
    this.host = opts.host ?? "127.0.0.1";
    this.memoria = new MemoriaDeRuns(opts.maxRuns ?? 20);
  }

  get url(): string {
    return `http://${this.host}:${this.port}`;
  }

  async iniciar(): Promise<void> {
    const servidor = createServer((req, res) => {
      this.rotear(req, res).catch((err) => {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end(String((err as Error)?.message ?? err));
      });
    });

    await new Promise<void>((resolve, reject) => {
      const falhou = (err: NodeJS.ErrnoException) => {
        servidor.removeListener("listening", subiu);
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
        servidor.removeListener("error", falhou);
        resolve();
      };
      servidor.once("error", falhou);
      servidor.once("listening", subiu);
      servidor.listen(this.port, this.host);
    });

    this.servidor = servidor;

    // Comentário periódico: mantém a conexão viva através de proxies que cortam
    // streams ociosos.
    this.pulso = setInterval(() => {
      for (const cliente of this.clientes) cliente.write(": pulso\n\n");
    }, 15_000);
    this.pulso.unref();

    if (this.opts.log !== false) {
      console.log(`[thena-flow] Execução ao vivo em ${this.url}`);
    }
  }

  /** Recebe um evento do recorder e o repassa a quem estiver olhando. */
  publicar(evento: ExecutionEvent): void {
    const { evento: carimbado, run } = this.memoria.registrar(evento);
    if (run) this.enviar("run", run);
    this.enviar("evento", carimbado);
  }

  async parar(): Promise<void> {
    if (this.pulso) clearInterval(this.pulso);
    for (const cliente of this.clientes) cliente.end();
    this.clientes.clear();

    const servidor = this.servidor;
    if (!servidor) return;
    this.servidor = undefined;
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  }

  private async rotear(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const caminho = new URL(req.url ?? "/", this.url).pathname;

    if (caminho === "/api/eventos") return this.abrirStream(res);

    if (caminho.startsWith("/api/runs/")) {
      const eventos = this.memoria.eventosDe(caminho.slice("/api/runs/".length));
      return this.json(res, eventos ? { eventos } : { erro: "run não encontrada" }, eventos ? 200 : 404);
    }

    return this.servirArquivo(caminho, res);
  }

  /** Conexão SSE: manda o estado atual e depois vai emendando os eventos. */
  private abrirStream(res: ServerResponse): void {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Sem isto, um proxy com buffer segura o stream inteiro até o fim da run.
      "x-accel-buffering": "no",
    });
    res.write(`event: snapshot\ndata: ${JSON.stringify(this.memoria.snapshot())}\n\n`);

    this.clientes.add(res);
    res.on("close", () => this.clientes.delete(res));
  }

  private enviar(tipo: string, payload: unknown): void {
    if (!this.clientes.size) return;
    const quadro = `event: ${tipo}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const cliente of this.clientes) {
      // Best-effort: um cliente que caiu no meio da escrita não pode derrubar a
      // execução que está sendo observada.
      try {
        cliente.write(quadro);
      } catch {
        this.clientes.delete(cliente);
      }
    }
  }

  private json(res: ServerResponse, corpo: unknown, status = 200): void {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(corpo));
  }

  private async servirArquivo(caminho: string, res: ServerResponse): Promise<void> {
    const relativo = normalize(caminho === "/" ? "index.html" : caminho.slice(1));

    // Nunca sair do diretório da interface, mesmo com `..` na URL.
    if (relativo.startsWith("..") || relativo.startsWith(sep)) {
      res.writeHead(403).end();
      return;
    }

    const arquivo = join(UI_DIR, relativo);
    try {
      const conteudo = await readFile(arquivo);
      res.writeHead(200, {
        "content-type": TIPOS[extname(arquivo)] ?? "application/octet-stream",
      });
      res.end(conteudo);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("não encontrado");
    }
  }
}
