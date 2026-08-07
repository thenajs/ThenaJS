import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Thena, loop } from "@thenajs/core";
import type { ExecutionNode } from "@thenajs/core";
import { FakeProvider, criarAgente, criarTool, criarWorkflow } from "./harness.js";

/** Caracterização do report: árvore de execução, arquivos e conteúdo. */

function pastaTemp(): string {
  return mkdtempSync(join(tmpdir(), "thena-report-"));
}

/** A árvore achatada em caminhos "kind > kind > kind", para asserção legível. */
function caminhos(node: ExecutionNode, prefixo = ""): string[] {
  const atual = prefixo ? `${prefixo} > ${node.kind}` : node.kind;
  return [atual, ...node.children.flatMap((f) => caminhos(f, atual))];
}

/** Cada run grava numa subpasta própria — aqui só há uma. */
function lerArvore(dir: string): ExecutionNode {
  const [run] = readdirSync(dir, { withFileTypes: true }).filter((e) =>
    e.isDirectory(),
  );
  return JSON.parse(readFileSync(join(dir, run.name, "report.json"), "utf-8"));
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("report", () => {
  it("grava a run numa subpasta própria, com um índice na raiz", async () => {
    const dir = pastaTemp();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const Fluxo = criarWorkflow([criarAgente({ provider: new FakeProvider() })]);
    const app = Thena.create(Fluxo, { report: { dir } });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    const entradas = readdirSync(dir, { withFileTypes: true });
    const pastas = entradas.filter((e) => e.isDirectory());
    expect(pastas).toHaveLength(1);
    expect(readdirSync(join(dir, pastas[0].name)).sort()).toEqual([
      "index.html",
      "report.json",
    ]);
    // O index.html da raiz é o índice das runs.
    expect(entradas.some((e) => e.isFile() && e.name === "index.html")).toBe(true);
  });

  it("duas runs do mesmo app geram duas subpastas e ambas entram no índice", async () => {
    const dir = pastaTemp();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const Fluxo = criarWorkflow([criarAgente({ provider: new FakeProvider() })]);
    const app = Thena.create(Fluxo, { report: { dir } });
    await app.run({ input: { message: "1" } });
    await app.run({ input: { message: "2" } });
    await app.dispose();

    const pastas = readdirSync(dir, { withFileTypes: true }).filter((e) =>
      e.isDirectory(),
    );
    expect(pastas).toHaveLength(2);

    const indice = readFileSync(join(dir, "index.html"), "utf-8");
    for (const pasta of pastas) {
      expect(indice).toContain(`./${pasta.name}/index.html`);
    }
  });

  it("o índice sai de um ledger append-only, não das árvores em disco", async () => {
    const dir = pastaTemp();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const Fluxo = criarWorkflow([criarAgente({ provider: new FakeProvider() })]);
    const app = Thena.create(Fluxo, { report: { dir } });
    await app.run({ input: { message: "1" } });
    await app.run({ input: { message: "2" } });
    await app.dispose();

    const linhas = readFileSync(join(dir, "runs.jsonl"), "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    expect(linhas).toHaveLength(2);
    // Só os escalares. Se a árvore voltar para cá, a linha cresce e o índice
    // volta a custar o histórico inteiro.
    expect(Object.keys(linhas[0]).sort()).toEqual([
      "durationMs",
      "html",
      "nome",
      "runId",
      "startedAt",
      "status",
    ]);
  });

  it("uma árvore ilegível no histórico não é lida — nem atrapalha", async () => {
    const dir = pastaTemp();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const Fluxo = criarWorkflow([criarAgente({ provider: new FakeProvider() })]);
    const app = Thena.create(Fluxo, { report: { dir } });

    // Primeira run: cria o ledger.
    await app.run({ input: { message: "1" } });
    await app.dispose();

    // Uma subpasta de lixo. O índice antigo dava `JSON.parse` nela a cada run;
    // o ledger nem a enxerga. É a trave da regressão de performance — sem
    // cronômetro, como o resto de `performance.test.ts`.
    mkdirSync(join(dir, "lixo"), { recursive: true });
    writeFileSync(join(dir, "lixo", "report.json"), "{ não é json");

    const app2 = Thena.create(Fluxo, { report: { dir } });
    await app2.run({ input: { message: "2" } });
    await app2.dispose();

    const indice = readFileSync(join(dir, "index.html"), "utf-8");
    expect(indice).toContain("2 runs");
    expect(indice).not.toContain("lixo");
  });

  it("semeia o índice a partir de uma pasta anterior ao ledger", async () => {
    const dir = pastaTemp();
    vi.spyOn(console, "log").mockImplementation(() => {});

    // Uma pasta de report do formato antigo: subpastas, sem runs.jsonl.
    mkdirSync(join(dir, "run-antiga"), { recursive: true });
    writeFileSync(
      join(dir, "run-antiga", "report.json"),
      JSON.stringify({
        id: "run-antiga",
        kind: "workflow",
        name: "Fluxo De Antes",
        startedAt: 1,
        status: "ok",
        durationMs: 10,
        data: {},
        children: [],
      }),
    );

    const Fluxo = criarWorkflow([criarAgente({ provider: new FakeProvider() })]);
    const app = Thena.create(Fluxo, { report: { dir } });
    await app.run({ input: { message: "nova" } });
    await app.dispose();

    const indice = readFileSync(join(dir, "index.html"), "utf-8");
    expect(indice).toContain("Fluxo De Antes");
    expect(indice).toContain("2 runs");
  });

  it("uma run em format: json entra no índice, linkando o report.json", async () => {
    const dir = pastaTemp();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const Fluxo = criarWorkflow([criarAgente({ provider: new FakeProvider() })]);
    const app = Thena.create(Fluxo, { report: { dir, format: "json" } });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    const [pasta] = readdirSync(dir, { withFileTypes: true }).filter((e) =>
      e.isDirectory(),
    );
    const indice = readFileSync(join(dir, "index.html"), "utf-8");
    // Sem HTML por run, o link tem que apontar para o JSON — antes apontava
    // para um `index.html` que não existia.
    expect(indice).toContain(`./${pasta.name}/report.json`);
  });

  it("duas runs concorrentes entram as duas no índice", async () => {
    const dir = pastaTemp();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const Fluxo = criarWorkflow([
      criarAgente({ provider: new FakeProvider([{ content: "ok" }], { delayMs: 5 }) }),
    ]);
    const app = Thena.create(Fluxo, { report: { dir } });

    // O índice era um read-modify-write sem coordenação: as duas liam a pasta e
    // escreviam `index.html`, e a última a escrever apagava a outra.
    await Promise.all([
      app.run({ input: { message: "a" } }).result,
      app.run({ input: { message: "b" } }).result,
    ]);
    await app.dispose();

    const pastas = readdirSync(dir, { withFileTypes: true }).filter((e) =>
      e.isDirectory(),
    );
    expect(pastas).toHaveLength(2);

    const indice = readFileSync(join(dir, "index.html"), "utf-8");
    for (const pasta of pastas) {
      expect(indice).toContain(`./${pasta.name}/index.html`);
    }
  });

  it("a árvore aninha workflow > agent > chat, e a tool sob o chat", async () => {
    const dir = pastaTemp();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const Ferramenta = criarTool(
      {
        name: "eco",
        description: "devolve o que recebe",
        schema: z.object({ x: z.string() }),
      },
      ({ x }: { x: string }) => x,
    );
    const provider = new FakeProvider([
      { tool: { name: "eco", arguments: { x: "oi" } } },
    ]);
    const Fluxo = criarWorkflow([criarAgente({ provider, tools: [Ferramenta] })]);

    const app = Thena.create(Fluxo, { report: { dir } });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    const raiz = lerArvore(dir);
    expect(raiz.kind).toBe("workflow");
    // A tool é executada de dentro do `provider.chat`, então o nó `tool`
    // pendura no `chat` — não no `agent`.
    expect(caminhos(raiz)).toEqual([
      "workflow",
      "workflow > agent",
      "workflow > agent > chat",
      "workflow > agent > chat > tool",
    ]);
  });

  it("o nó do loop registra iterations e exhausted", async () => {
    const dir = pastaTemp();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const Fluxo = criarWorkflow([
      loop({
        steps: [criarAgente({ provider: new FakeProvider() })],
        until: () => false,
        maxIterations: 3,
      }),
    ]);

    const app = Thena.create(Fluxo, { report: { dir } });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    const no = lerArvore(dir).children[0];
    expect(no.kind).toBe("loop");
    expect(no.data.iterations).toBe(3);
    expect(no.data.exhausted).toBe(true);
    expect(no.data.maxIterations).toBe(3);
  });

  it("o nó raiz registra o consumo da run", async () => {
    const dir = pastaTemp();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const provider = new FakeProvider([
      { content: "a", usage: { promptTokens: 10, completionTokens: 5 } },
    ]);
    const Fluxo = criarWorkflow([criarAgente({ provider })]);

    const app = Thena.create(Fluxo, { report: { dir } });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    const raiz = lerArvore(dir);
    expect(raiz.data.chatCalls).toBe(1);
    expect(raiz.data.tokens).toBe(15);
    expect(raiz.data.exceeded).toBe(false);
  });

  it("uma tool que falha marca o nó como erro sem derrubar o report", async () => {
    const dir = pastaTemp();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const Ferramenta = criarTool(
      { name: "falha", description: "falha", schema: z.object({ x: z.string() }) },
      () => ({ content: "deu ruim", isError: true }),
    );
    const provider = new FakeProvider([
      { tool: { name: "falha", arguments: { x: "1" } } },
    ]);
    const Fluxo = criarWorkflow([criarAgente({ provider, tools: [Ferramenta] })]);

    const app = Thena.create(Fluxo, { report: { dir } });
    await app.run({ input: { message: "vai" } });
    await app.dispose();

    const tool = lerArvore(dir).children[0].children[0].children[0];
    expect(tool.kind).toBe("tool");
    expect(tool.status).toBe("error");
    expect(tool.error).toBe("deu ruim");
  });
});
