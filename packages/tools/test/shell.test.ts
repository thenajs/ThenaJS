import { describe, expect, it } from "vitest";
import { shellTool } from "../src/shell.tool.js";

/**
 * A tool que dá execução arbitrária ao modelo. Os testes cobrem as proteções,
 * não o `exec` — o que importa aqui é o que ela **recusa**.
 */

const texto = (r: unknown) =>
  typeof r === "string" ? r : (r as { content: string }).content;
const falhou = (r: unknown) =>
  typeof r === "string" ? false : Boolean((r as { isError?: boolean }).isError);

describe("shellTool", () => {
  it("executa e devolve a saída", async () => {
    const r = await shellTool().execute({ command: "echo ola" });
    expect(texto(r).trim()).toBe("ola");
  });

  it("erro do comando vira observação, não exceção", async () => {
    const r = await shellTool().execute({ command: "exit 1" });
    expect(falhou(r)).toBe(true);
  });

  it("respeita o cwd", async () => {
    const r = await shellTool({ cwd: "/tmp" }).execute({ command: "pwd" });
    expect(texto(r)).toContain("tmp");
  });

  it("corta o comando que passa do timeout", async () => {
    const r = await shellTool({ timeoutMs: 150 }).execute({ command: "sleep 5" });
    expect(falhou(r)).toBe(true);
    expect(texto(r)).toContain("excedeu");
  });

  it("trunca saída gigante em vez de entupir o contexto", async () => {
    const r = await shellTool({ maxChars: 50 }).execute({
      command: "head -c 5000 /dev/zero | tr '\\0' 'a'",
    });
    expect(texto(r).length).toBeLessThan(120);
    expect(texto(r)).toContain("[truncado]");
  });

  describe("allowlist", () => {
    const tool = shellTool({ allow: ["echo", "pwd"] });

    it("deixa passar o que está na lista", async () => {
      expect(texto(await tool.execute({ command: "echo ok" })).trim()).toBe("ok");
    });

    it("recusa o que não está, dizendo o que é permitido", async () => {
      const r = await tool.execute({ command: "rm -rf /" });
      expect(falhou(r)).toBe(true);
      expect(texto(r)).toContain("não permitido");
      expect(texto(r)).toContain("echo, pwd");
    });

    it.each([
      ["encadeamento", "echo ok; rm -rf /"],
      ["and lógico", "echo ok && rm -rf /"],
      ["pipe", "echo ok | sh"],
      ["substituição", "echo $(rm -rf /)"],
      ["redirecionamento", "echo ok > /etc/passwd"],
      ["crase", "echo `rm -rf /`"],
    ])("recusa %s, que anularia a lista", async (_rotulo, command) => {
      const r = await tool.execute({ command });
      expect(falhou(r)).toBe(true);
    });

    it("a descrição avisa ao modelo quais comandos existem", () => {
      expect(tool.description).toContain("echo, pwd");
    });
  });
});
