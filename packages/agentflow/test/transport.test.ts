import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpTransport } from "@thenajs/agentflow";
import type { RetryPolicy, RetryAttempt } from "@thenajs/agentflow";

/**
 * O laço de retry — o caminho por onde passa **todo** tráfego de rede do
 * framework, já que `Providers` e `VectorStore` estendem esta classe.
 *
 * `retry.test.ts` cobre as funções de política (`resolveRetry`, `backoffDelay`,
 * `parseRetryAfter`, `isRetryableByDefault`). Elas são puras, e estavam bem
 * cobertas — mas quem as **usa** é o `request()`, e nenhum teste fazia uma
 * requisição falhar. Na prática o `catch` do `fetch` nunca executava: o cálculo
 * do atraso, a decisão sobre abort e a montagem do erro de transporte estavam
 * todos sem rede de proteção. Peças testadas na bancada, carro nunca dirigido.
 *
 * O `fetch` global vira um roteiro. O que precisa ser fixado aqui é a decisão —
 * o que retenta, o que não, quanto espera, o que sobe como veio — e nada disso
 * exige um servidor de verdade.
 */

/** Um passo do roteiro: uma resposta, uma falha de rede, ou pendurar. */
type Passo =
  { status: number; retryAfter?: string } | { erro: Error } | { pendura: true };

/** Instala o `fetch` roteirizado. Esgotado o roteiro, repete o último passo. */
function interceptar(passos: Passo[]): { init: RequestInit }[] {
  const chamadas: { init: RequestInit }[] = [];
  const fila = [...passos];
  const ultimo = passos.at(-1) ?? { status: 200 };

  vi.stubGlobal("fetch", async (_url: string, init: any = {}) => {
    chamadas.push({ init });
    const passo = fila.shift() ?? ultimo;

    if ("pendura" in passo) {
      // Como um `fetch` de verdade: só termina se alguém abortar.
      return new Promise((_resolve, reject) => {
        const s = init.signal as AbortSignal | undefined;
        if (s?.aborted) return reject(s.reason);
        s?.addEventListener("abort", () => reject(s.reason), { once: true });
      });
    }

    if ("erro" in passo) throw passo.erro;

    return {
      ok: passo.status < 400,
      status: passo.status,
      headers: {
        get: (nome: string) =>
          nome.toLowerCase() === "retry-after" ? (passo.retryAfter ?? null) : null,
      },
    };
  });

  return chamadas;
}

/** Expõe o `request()`, que é `protected` — é ele o objeto do teste. */
class Transporte extends HttpTransport {
  constructor(retry?: RetryPolicy | boolean) {
    super();
    this.configureTransport({ retry });
  }
  chamar(init: RequestInit = {}) {
    return this.request("http://exemplo/teste", init);
  }
}

/** Sem espera entre tentativas, quando o teste não é sobre a espera. */
const SEM_ESPERA: RetryPolicy = { initialDelayMs: 0, maxDelayMs: 0 };

/** Captura o erro cru: um abort rejeita com `DOMException`, não com `Error`. */
async function capturar(p: Promise<unknown>): Promise<any> {
  try {
    await p;
    throw new Error("esperava uma rejeição, mas resolveu");
  } catch (e) {
    return e;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("o que retenta e o que não", () => {
  it("429 retenta, e o sucesso seguinte reporta o total de tentativas", async () => {
    const chamadas = interceptar([{ status: 429 }, { status: 200 }]);

    const { response, attempts } = await new Transporte(SEM_ESPERA).chamar();

    expect(response.status).toBe(200);
    // `attempts` é o que alimenta o nó `chat` do report: sem ele, um provider
    // que só respondeu na terceira ida é indistinguível de um que acertou de
    // primeira.
    expect(attempts).toBe(2);
    expect(chamadas).toHaveLength(2);
  });

  it("erro de rede retenta", async () => {
    interceptar([{ erro: new Error("ECONNRESET") }, { status: 200 }]);
    const { attempts } = await new Transporte(SEM_ESPERA).chamar();
    expect(attempts).toBe(2);
  });

  it("400 não retenta — reexecutar só gastaria tempo e dinheiro", async () => {
    const chamadas = interceptar([{ status: 400 }, { status: 200 }]);

    const { response, attempts } = await new Transporte(SEM_ESPERA).chamar();

    // A resposta com erro **volta** para quem chamou, em vez de lançar: é ele
    // quem monta a mensagem, que inclui o corpo.
    expect(response.status).toBe(400);
    expect(attempts).toBe(1);
    expect(chamadas).toHaveLength(1);
  });

  it("`isRetryable` do usuário substitui a decisão padrão", async () => {
    const chamadas = interceptar([{ status: 400 }, { status: 200 }]);

    const { attempts } = await new Transporte({
      ...SEM_ESPERA,
      isRetryable: (info: RetryAttempt) => info.status === 400,
    }).chamar();

    expect(attempts).toBe(2);
    expect(chamadas).toHaveLength(2);
  });
});

describe("quando as tentativas acabam", () => {
  it("sem resposta, lança dizendo quantas tentativas foram gastas", async () => {
    interceptar([{ erro: new Error("ECONNREFUSED") }]);

    const erro = await capturar(new Transporte(SEM_ESPERA).chamar());

    expect(erro.message).toBe("HTTP request failed (after 3 attempts): ECONNREFUSED");
    // A causa original viaja junto: sem ela, o `ECONNREFUSED` do driver some e
    // sobra uma mensagem genérica sobre HTTP.
    expect((erro as Error).cause).toBeInstanceOf(Error);
    expect(((erro as Error).cause as Error).message).toBe("ECONNREFUSED");
  });

  it("com uma tentativa só, o erro não fala em tentativas", async () => {
    interceptar([{ erro: new Error("ECONNREFUSED") }]);

    // `retry: false` reduz a uma tentativa — o comportamento anterior ao retry.
    const erro = await capturar(new Transporte(false).chamar());

    expect(erro.message).toBe("HTTP request failed: ECONNREFUSED");
  });

  it("esgotado com resposta, devolve a resposta em vez de lançar", async () => {
    interceptar([{ status: 503 }]);

    const { response, attempts } = await new Transporte(SEM_ESPERA).chamar();

    expect(response.status).toBe(503);
    expect(attempts).toBe(3);
  });
});

describe("cancelamento sobe como veio", () => {
  it("um abort não vira erro de transporte nem é retentado", async () => {
    const chamadas = interceptar([{ pendura: true }]);
    const controller = new AbortController();
    const transporte = new Transporte(SEM_ESPERA);

    const pendente = transporte.chamar({ signal: controller.signal });
    controller.abort();

    const erro = await capturar(pendente);

    // Preserva a distinção entre `AbortError`, `TimeoutError` e uma razão
    // própria. Embrulhar em "HTTP request failed" apagaria os três.
    expect(erro.name).toBe("AbortError");
    expect(String(erro.message)).not.toContain("HTTP request failed");
    expect(chamadas).toHaveLength(1);
  });

  it("a razão de um `abort(razão)` chega inteira", async () => {
    interceptar([{ pendura: true }]);
    const controller = new AbortController();
    const minha = new Error("mudei de ideia");

    const pendente = new Transporte(SEM_ESPERA).chamar({
      signal: controller.signal,
    });
    controller.abort(minha);

    expect(await capturar(pendente)).toBe(minha);
  });

  it("um timeout sobe como `TimeoutError`, e não é retentado", async () => {
    const chamadas = interceptar([{ pendura: true }]);

    const erro = await capturar(
      new Transporte({ ...SEM_ESPERA, timeoutMs: 20 }).chamar(),
    );

    expect(erro.name).toBe("TimeoutError");
    // Retentar contraria quem estabeleceu o teto — e cada tentativa esperaria
    // o teto de novo.
    expect(chamadas).toHaveLength(1);
  });
});

/**
 * O caso que já foi bug: `signal: init.signal ?? AbortSignal.timeout(...)`
 * descartava o teto em silêncio sempre que alguém passava um signal. Quem
 * cancelava por conta própria perdia o timeout sem nenhum aviso.
 */
describe("o teto de tempo e o signal de quem chamou valem os dois", () => {
  it("com um signal externo, o `timeoutMs` continua valendo", async () => {
    interceptar([{ pendura: true }]);
    // Nunca abortado: se o timeout tivesse sido descartado, isto penduraria.
    const nuncaAborta = new AbortController();

    const erro = await capturar(
      new Transporte({ ...SEM_ESPERA, timeoutMs: 20 }).chamar({
        signal: nuncaAborta.signal,
      }),
    );

    expect(erro.name).toBe("TimeoutError");
  });

  it("com `timeoutMs`, o signal de quem chamou continua valendo", async () => {
    interceptar([{ pendura: true }]);
    const controller = new AbortController();

    // Teto largo: quem tem de vencer é o abort.
    const pendente = new Transporte({ ...SEM_ESPERA, timeoutMs: 10_000 }).chamar({
      signal: controller.signal,
    });
    controller.abort();

    expect((await capturar(pendente)).name).toBe("AbortError");
  });
});

describe("a espera entre tentativas", () => {
  /** O `delayMs` decidido, sem depender de cronômetro. */
  function espiar(policy: RetryPolicy): { atrasos: number[]; policy: RetryPolicy } {
    const atrasos: number[] = [];
    return { atrasos, policy: { ...policy, onRetry: (i) => atrasos.push(i.delayMs) } };
  }

  it("`Retry-After` em segundos vence o backoff calculado", async () => {
    interceptar([{ status: 429, retryAfter: "0" }, { status: 200 }]);
    // Backoff determinístico e grande: se o header não vencesse, seria 9000.
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const { atrasos, policy } = espiar({ initialDelayMs: 10_000, maxDelayMs: 10_000 });

    await new Transporte(policy).chamar();

    expect(atrasos).toEqual([0]);
  });

  it("`onRetry` recebe a tentativa que falhou, com status e teto", async () => {
    interceptar([{ status: 503 }, { status: 200 }]);
    const vistos: RetryAttempt[] = [];

    await new Transporte({
      ...SEM_ESPERA,
      onRetry: (info) => vistos.push({ ...info }),
    }).chamar();

    expect(vistos).toHaveLength(1);
    expect(vistos[0].attempt).toBe(1);
    expect(vistos[0].maxAttempts).toBe(3);
    expect(vistos[0].status).toBe(503);
  });

  it("abortar no meio do backoff não espera o atraso inteiro", async () => {
    interceptar([{ status: 429 }, { status: 200 }]);
    vi.spyOn(Math, "random").mockReturnValue(1);
    const controller = new AbortController();

    const comecou = Date.now();
    const pendente = new Transporte({
      initialDelayMs: 5_000,
      maxDelayMs: 5_000,
    }).chamar({ signal: controller.signal });

    // Já respondeu 429 e entrou no `sleep`; o abort tem de cortá-lo.
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();
    await capturar(pendente);

    // Sem o signal no `sleep`, isto levaria os 5 segundos.
    expect(Date.now() - comecou).toBeLessThan(1_000);
  });
});
