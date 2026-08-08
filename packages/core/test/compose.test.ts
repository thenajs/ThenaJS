import { describe, expect, it } from "vitest";
import { compose } from "../src/middleware/compose.js";
import type { Middleware } from "../src/middleware/compose.js";

/**
 * A primitiva das cadeias. Testada direto porque na Fase 3 ela vira API
 * pública — um middleware escrito por quem usa o framework passa por aqui.
 */

interface Inv {
  steps: string[];
}
type Mw = Middleware<Inv, string>;

const mark =
  (name: string): Mw =>
  async (inv, next) => {
    inv.steps.push(`${name}:entra`);
    const saida = await next();
    inv.steps.push(`${name}:sai`);
    return saida;
  };

describe("compose", () => {
  it("executa em cebola: entra na ordem, sai na inversa", async () => {
    const inv: Inv = { steps: [] };
    const chain = compose<Inv, string>([mark("a"), mark("b"), mark("c")]);

    const saida = await chain(inv, async () => {
      inv.steps.push("centro");
      return "resultado";
    });

    expect(saida).toBe("resultado");
    expect(inv.steps).toEqual([
      "a:entra",
      "b:entra",
      "c:entra",
      "centro",
      "c:sai",
      "b:sai",
      "a:sai",
    ]);
  });

  it("sem middlewares, chama o centro direto", async () => {
    const chain = compose<Inv, string>([]);
    await expect(chain({ steps: [] }, async () => "só o centro")).resolves.toBe(
      "só o centro",
    );
  });

  it("um middleware pode curto-circuitar sem chamar next", async () => {
    let centroRodou = false;
    const cache: Mw = async () => "do cache";

    const chain = compose<Inv, string>([mark("fora"), cache, mark("dentro")]);
    const inv: Inv = { steps: [] };

    const saida = await chain(inv, async () => {
      centroRodou = true;
      return "do centro";
    });

    expect(saida).toBe("do cache");
    expect(centroRodou).toBe(false);
    // O de fora fecha normalmente; o de dentro nunca abriu.
    expect(inv.steps).toEqual(["fora:entra", "fora:sai"]);
  });

  it("um middleware pode transformar o resultado na volta", async () => {
    const maiusculo: Mw = async (_inv, next) => (await next()).toUpperCase();
    const chain = compose<Inv, string>([maiusculo]);

    await expect(chain({ steps: [] }, async () => "oi")).resolves.toBe("OI");
  });

  it("chamar next() duas vezes falha alto, em vez de executar em duplicidade", async () => {
    let vezes = 0;
    const duplicado: Mw = async (_inv, next) => {
      await next();
      return next(); // erro: a cadeia inteira rodaria de novo
    };

    const chain = compose<Inv, string>([duplicado]);

    await expect(
      chain({ steps: [] }, async () => {
        vezes++;
        return "x";
      }),
    ).rejects.toThrow(/next\(\) foi chamado mais de uma vez/);

    // O centro rodou uma vez só — a segunda chamada foi barrada antes.
    expect(vezes).toBe(1);
  });

  it("um erro no centro sobe pela cadeia", async () => {
    const inv: Inv = { steps: [] };
    const chain = compose<Inv, string>([mark("a")]);

    await expect(
      chain(inv, async () => {
        throw new Error("explodiu");
      }),
    ).rejects.toThrow("explodiu");

    // O `a:sai` não aconteceu: a exceção pulou o resto do middleware.
    expect(inv.steps).toEqual(["a:entra"]);
  });

  it("um middleware pode capturar o erro e devolver um valor", async () => {
    const resgate: Mw = async (_inv, next) => {
      try {
        return await next();
      } catch {
        return "recuperado";
      }
    };

    const chain = compose<Inv, string>([resgate]);

    await expect(
      chain({ steps: [] }, async () => {
        throw new Error("explodiu");
      }),
    ).resolves.toBe("recuperado");
  });

  it("a mesma cadeia composta serve para várias invocações", async () => {
    const chain = compose<Inv, string>([mark("a")]);

    const um: Inv = { steps: [] };
    const dois: Inv = { steps: [] };
    await chain(um, async () => "1");
    await chain(dois, async () => "2");

    // O contador de `next()` é por invocação, não do closure da cadeia.
    expect(um.steps).toEqual(["a:entra", "a:sai"]);
    expect(dois.steps).toEqual(["a:entra", "a:sai"]);
  });
});
