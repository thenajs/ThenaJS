import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
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
