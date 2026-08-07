import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { bootstrapWorkflow, redactSecrets } from "@thenajs/core";
import type { ExecutionNode } from "@thenajs/core";
import { FakeProvider, criarAgente, criarTool, criarWorkflow } from "./harness.js";

/**
 * O report grava a conversa inteira em disco. Mensagem de erro é o lugar
 * clássico de vazar credencial — um driver de banco traz a connection string
 * com senha. Por isso o mascaramento vem ligado.
 */

const schema = z.object({ x: z.string() });

function lerArvore(dir: string): ExecutionNode {
  const [run] = readdirSync(dir, { withFileTypes: true }).filter((e) =>
    e.isDirectory(),
  );
  return JSON.parse(readFileSync(join(dir, run.name, "report.json"), "utf-8"));
}

afterEach(() => vi.restoreAllMocks());

describe("redactSecrets", () => {
  it.each([
    ["Bearer", "Authorization: Bearer abc123DEF456ghi789", "Bearer [REDACTED]"],
    ["Basic", "Authorization: Basic YWRtaW46c2VjcmV0Cg==", "Basic [REDACTED]"],
    ["chave OpenAI", "usei sk-proj-abcdefghij1234567890", "sk-[REDACTED]"],
    ["token GitHub", "ghp_abcdefghijklmnop1234", "ghp_[REDACTED]"],
    ["token Slack", "xoxb-1234567890-abcdef", "xoxb-[REDACTED]"],
    ["chave AWS", "AKIAIOSFODNN7EXAMPLE", "[REDACTED]"],
  ])("mascara %s", (_rotulo, entrada, esperado) => {
    expect(redactSecrets(entrada)).toContain(esperado);
  });

  it("mascara a senha de uma connection string, preservando host e usuário", () => {
    const saida = redactSecrets("postgres://admin:s3nh4Secreta@10.0.0.5:5432/app");
    expect(saida).toBe("postgres://admin:[REDACTED]@10.0.0.5:5432/app");
    expect(saida).not.toContain("s3nh4Secreta");
  });

  it("mascara JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redactSecrets(`token=${jwt}`)).not.toContain("eyJhbGci");
  });

  it.each(["api_key", "apiKey", "secret", "password", "senha", "token"])(
    "mascara o campo nomeado `%s`",
    (campo) => {
      const saida = redactSecrets(`{"${campo}": "valorSecreto123"}`);
      expect(saida).not.toContain("valorSecreto123");
      expect(saida).toContain("[REDACTED]");
    },
  );

  it("não estraga texto legítimo", () => {
    const texto = "Li o arquivo src/main.ts e encontrei 3 funções exportadas.";
    expect(redactSecrets(texto)).toBe(texto);
  });

  it("é idempotente — rodar duas vezes dá o mesmo resultado", () => {
    const uma = redactSecrets("Bearer abc123DEF456ghi789");
    expect(redactSecrets(uma)).toBe(uma);
  });
});

describe("no report", () => {
  it("mascara a mensagem de erro de uma tool", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "thena-redact-"));

    const tool = criarTool({ name: "db", description: "consulta", schema }, () => {
      throw new Error(
        "conexão falhou: postgres://admin:s3nh4Secreta@10.0.0.5:5432/app",
      );
    });
    const provider = new FakeProvider([
      { tool: { name: "db", arguments: { x: "1" } } },
    ]);
    const Fluxo = criarWorkflow([criarAgente({ provider, tools: [tool] })]);

    const app = await bootstrapWorkflow(Fluxo, { report: { dir } });
    await app.run({ input: { message: "consulte" } });
    await app.dispose();

    const json = readFileSync(
      join(
        dir,
        readdirSync(dir).find((e) => !e.endsWith(".html"))!,
        "report.json",
      ),
      "utf-8",
    );
    expect(json).not.toContain("s3nh4Secreta");
    expect(json).toContain("[REDACTED]");
  });

  it("mascara o prompt enviado ao modelo", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "thena-redact-prompt-"));

    const app = await bootstrapWorkflow(
      criarWorkflow([criarAgente({ provider: new FakeProvider() })]),
      { report: { dir } },
    );
    await app.run({ input: { message: "meu token é ghp_abcdefghijklmnop1234" } });
    await app.dispose();

    const chat = lerArvore(dir).children[0].children[0];
    expect(String(chat.data.prompt)).not.toContain("ghp_abcdefghijklmnop1234");
    expect(String(chat.data.prompt)).toContain("[REDACTED]");
  });

  it("`redact: false` desliga — o segredo vai para o disco", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "thena-redact-off-"));

    const app = await bootstrapWorkflow(
      criarWorkflow([criarAgente({ provider: new FakeProvider() })]),
      { report: { dir }, redact: false },
    );
    await app.run({ input: { message: "token ghp_abcdefghijklmnop1234" } });
    await app.dispose();

    expect(String(lerArvore(dir).children[0].children[0].data.prompt)).toContain(
      "ghp_abcdefghijklmnop1234",
    );
  });

  it("uma função própria substitui o default, e pode compor com ele", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "thena-redact-fn-"));

    const app = await bootstrapWorkflow(
      criarWorkflow([criarAgente({ provider: new FakeProvider() })]),
      {
        report: { dir },
        redact: (_campo, valor) =>
          redactSecrets(valor).replace(/CPF \d{11}/g, "CPF [REDACTED]"),
      },
    );
    await app.run({
      input: { message: "CPF 12345678901 e token ghp_abcdefghijklmnop1234" },
    });
    await app.dispose();

    const prompt = String(lerArvore(dir).children[0].children[0].data.prompt);
    expect(prompt).not.toContain("12345678901");
    expect(prompt).not.toContain("ghp_abcdefghijklmnop1234");
  });

  it("`content: false` mantém a árvore e descarta o texto", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), "thena-sem-content-"));

    const app = await bootstrapWorkflow(
      criarWorkflow([criarAgente({ provider: new FakeProvider([{ content: "oi" }]) })]),
      { report: { dir, content: false } },
    );
    await app.run({ input: { message: "segredo" } });
    await app.dispose();

    const raiz = lerArvore(dir);
    const chat = raiz.children[0].children[0];
    // A estrutura e a telemetria continuam; só o conteúdo some.
    expect(chat.kind).toBe("chat");
    expect(chat.durationMs).toBeGreaterThanOrEqual(0);
    expect(chat.data.prompt).toBeUndefined();
    expect(chat.data.response).toBeUndefined();
    expect(raiz.data.chatCalls).toBe(1);
  });
});
