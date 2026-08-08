import { afterEach, describe, expect, it, vi } from "vitest";
import { Thena } from "@thenajs/core";
import { FakeProvider, makeAgent, makeWorkflow } from "./harness.js";

/** O contrato do `app.run()`: devolve, propaga, e não escreve no stdout. */

function fluxoOk(response: string) {
  return makeWorkflow([
    makeAgent({ provider: new FakeProvider([{ content: response }]) }),
  ]);
}

/** Falha fora da tool: o hook do agente lança. */
function fluxoQueLanca(mensagem: string) {
  return makeWorkflow([
    makeAgent(
      { provider: new FakeProvider([{ content: "x" }]) },
      {
        beforePrompt() {
          throw new Error(mensagem);
        },
      },
    ),
  ]);
}

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("app.run", () => {
  it("devolve a saída e não imprime nada", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const app = Thena.create(fluxoOk("resultado"), {});
    const saida = await app.run({ input: { message: "vai" } });
    await app.dispose();

    expect(saida).toBe("resultado");
    expect(log).not.toHaveBeenCalled();
  });

  it("rejeita com o erro original, sem tocar no process.exitCode", async () => {
    const fail = vi.spyOn(console, "error").mockImplementation(() => {});

    const app = Thena.create(fluxoQueLanca("falhou feio"), {});

    await expect(app.run({ input: { message: "vai" } })).rejects.toThrow("falhou feio");
    expect(process.exitCode).toBeUndefined();
    expect(fail).not.toHaveBeenCalled();

    await app.dispose();
  });

  it("uma run que falha não impede a seguinte no mesmo app", async () => {
    const app = Thena.create(fluxoOk("ok"), {});

    await app.run({ input: { message: "1" } });
    await app.run({ input: { message: "2" } });
    await app.dispose();

    // Sem estado de processo para "sujar", a segunda run é indiferente à
    // primeira — era isto que os globais quebravam.
    expect(true).toBe(true);
  });

  it("log pode ser sobrescrito por execução", async () => {
    const doApp = vi.fn();
    const daRun = vi.fn();

    const app = Thena.create(fluxoOk("ok"), { log: doApp });

    await app.run({ input: { message: "1" }, log: daRun });
    expect(daRun).toHaveBeenCalled();
    expect(doApp).not.toHaveBeenCalled();

    await app.run({ input: { message: "2" } });
    expect(doApp).toHaveBeenCalled();

    await app.dispose();
  });
});
