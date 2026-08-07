import { describe, expect, it, vi } from "vitest";
import {
  backoffDelay,
  isRetryableByDefault,
  parseRetryAfter,
  resolveRetry,
  sleep,
} from "../src/providers/retry.js";
import type { RetryAttempt } from "../src/providers/retry.js";

/**
 * Política de retry das chamadas HTTP. Vem ligada por padrão, então um erro
 * aqui gasta dinheiro (retentando o que não devia) ou derruba runs (não
 * retentando o que devia).
 */

const tentativa = (over: Partial<RetryAttempt> = {}): RetryAttempt => ({
  attempt: 1,
  maxAttempts: 3,
  delayMs: 0,
  ...over,
});

describe("resolveRetry", () => {
  it("sem argumento, usa os defaults", () => {
    expect(resolveRetry()).toMatchObject({
      maxAttempts: 3,
      initialDelayMs: 500,
      maxDelayMs: 8000,
      factor: 2,
      respectRetryAfter: true,
    });
  });

  it("`timeoutMs` NÃO tem default", () => {
    // De propósito: é o único parâmetro capaz de quebrar um setup que
    // funcionava, abortando um modelo local lento.
    expect(resolveRetry().timeoutMs).toBeUndefined();
  });

  it("`true` equivale a ausente", () => {
    expect(resolveRetry(true)).toEqual(resolveRetry());
  });

  it("`false` reduz a uma tentativa — sem retry", () => {
    expect(resolveRetry(false).maxAttempts).toBe(1);
  });

  it("mescla o que foi informado sobre os defaults", () => {
    const p = resolveRetry({ maxAttempts: 5, timeoutMs: 1000 });
    expect(p.maxAttempts).toBe(5);
    expect(p.timeoutMs).toBe(1000);
    expect(p.initialDelayMs).toBe(500); // preservado
  });

  it("`maxAttempts: 0` não vira nem ilimitado nem nenhuma tentativa", () => {
    expect(resolveRetry({ maxAttempts: 0 }).maxAttempts).toBe(1);
  });

  it("chave `undefined` não sobrescreve o default", () => {
    expect(resolveRetry({ initialDelayMs: undefined }).initialDelayMs).toBe(500);
  });
});

describe("isRetryableByDefault", () => {
  it.each([408, 425, 429, 500, 502, 503, 504])("retenta %i", (status) => {
    expect(isRetryableByDefault(tentativa({ status }))).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422])("NÃO retenta %i", (status) => {
    // Erro de contrato não melhora repetindo — só gasta tempo e dinheiro.
    expect(isRetryableByDefault(tentativa({ status }))).toBe(false);
  });

  it("sem status, um erro de rede é transitório", () => {
    expect(isRetryableByDefault(tentativa({ error: new Error("ECONNRESET") }))).toBe(
      true,
    );
  });

  it("sem status e sem erro, não retenta", () => {
    expect(isRetryableByDefault(tentativa())).toBe(false);
  });
});

describe("backoffDelay", () => {
  const politica = resolveRetry();

  it("cresce exponencialmente — o teto dobra a cada tentativa", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(backoffDelay(1, politica)).toBe(500);
    expect(backoffDelay(2, politica)).toBe(1000);
    expect(backoffDelay(3, politica)).toBe(2000);
    vi.restoreAllMocks();
  });

  it("respeita o teto de espera", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(backoffDelay(10, politica)).toBe(politica.maxDelayMs);
    vi.restoreAllMocks();
  });

  it("aplica *full jitter*: o valor fica entre 0 e o teto", () => {
    // Espalha as tentativas de clientes concorrentes em vez de sincronizá-las.
    for (const r of [0, 0.25, 0.5, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      const d = backoffDelay(3, politica);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(2000);
    }
    vi.restoreAllMocks();
  });

  it("`Retry-After` do servidor vence o cálculo", () => {
    expect(backoffDelay(1, politica, 7000)).toBe(7000);
  });

  it("com `respectRetryAfter: false`, o cálculo vence", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const p = resolveRetry({ respectRetryAfter: false });
    expect(backoffDelay(1, p, 7000)).toBe(500);
    vi.restoreAllMocks();
  });
});

describe("parseRetryAfter", () => {
  it("segundos viram milissegundos", () => {
    expect(parseRetryAfter("3")).toBe(3000);
  });

  it("zero é válido", () => {
    expect(parseRetryAfter("0")).toBe(0);
  });

  it("data HTTP vira a espera até ela", () => {
    const daquiA10s = new Date(Date.now() + 10_000).toUTCString();
    const ms = parseRetryAfter(daquiA10s);
    expect(ms).toBeGreaterThan(8_000);
    expect(ms).toBeLessThanOrEqual(11_000);
  });

  it("data no passado não vira espera negativa", () => {
    expect(parseRetryAfter(new Date(Date.now() - 60_000).toUTCString())).toBe(0);
  });

  it.each([
    ["ausente", null],
    ["vazio", ""],
    ["ilegível", "amanhã"],
  ])("%s devolve undefined", (_rotulo, header) => {
    expect(parseRetryAfter(header)).toBeUndefined();
  });
});

describe("sleep", () => {
  it("espera o tempo pedido", async () => {
    const inicio = Date.now();
    await sleep(30);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(25);
  });
});
