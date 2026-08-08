import {
  isAbortError,
  ResolvedRetry,
  RetryAttempt,
  RetryPolicy,
  backoffDelay,
  isRetryableByDefault,
  parseRetryAfter,
  resolveRetry,
  sleep,
} from "../providers/retry.js";

/** Campos de transporte HTTP, comuns a provider e a banco vetorial. */
export interface TransportCredentials {
  /**
   * Retry automático das chamadas HTTP. Vem **ligado** com os defaults
   * (3 tentativas, backoff exponencial, sem timeout); `false` desliga.
   */
  retry?: RetryPolicy | boolean;
}

/**
 * Transporte HTTP com retry e timeout — a base de tudo que fala com um serviço
 * externo no ThenaJS. `Providers` e `VectorStore` estendem esta classe, então
 * uma implementação própria de qualquer um dos dois herda a política sem código.
 */
export class HttpTransport {
  /** Política de retry já normalizada, usada pelo `request()`. */
  protected retry: ResolvedRetry = resolveRetry();

  /**
   * Absorve os campos de transporte das credentials. Chame no construtor da
   * sua subclasse — é o que evita esquecer a política de retry em silêncio.
   */
  protected configureTransport(credentials: TransportCredentials = {}): void {
    this.retry = resolveRetry(credentials.retry);
  }

  /**
   * `fetch` com timeout e retry, conforme a política configurada. Use no lugar
   * do `fetch` cru — é o que faz a sua implementação herdar tudo sem código.
   *
   * Devolve também quantas tentativas foram gastas, para o report. O contador
   * **não** fica na instância de propósito: a mesma instância é compartilhada
   * pelos agentes de um `parallel`, e estado mutável em `this` daria corrida.
   */
  protected async request(
    url: string,
    init: RequestInit = {},
  ): Promise<{ response: Response; attempts: number }> {
    const policy = this.retry;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      let response: Response | undefined;
      let error: Error | undefined;

      try {
        response = await fetch(url, {
          ...init,
          // Os dois valem, e o que disparar primeiro vence. Com `??`, um
          // signal vindo de fora descartava o timeout em silêncio.
          signal: combineSignals(init.signal, policy.timeoutMs),
        });

        if (response.ok) {
          return { response, attempts: attempt };
        }
      } catch (err) {
        error = err as Error;

        // Cancelamento sobe **como veio**, sem virar "Falha na chamada HTTP":
        // é o que preserva a distinção entre `TimeoutError` (estourou o teto)
        // e `AbortError` (alguém pediu para parar), e entre os dois e uma
        // razão própria passada em `controller.abort(razão)`.
        if (isAbortError(error)) throw error;
      }

      const info: RetryAttempt = {
        attempt,
        maxAttempts: policy.maxAttempts,
        status: response?.status,
        error,
        delayMs: 0,
      };

      const podeTentar =
        attempt < policy.maxAttempts &&
        (policy.isRetryable ?? isRetryableByDefault)(info);

      if (!podeTentar) {
        // Devolve a resposta com erro para quem chamou montar a mensagem
        // dele (que inclui o corpo); só relança quando nem resposta houve.
        if (response) return { response, attempts: attempt };
        throw this.transportError(error, attempt);
      }

      info.delayMs = backoffDelay(
        attempt,
        policy,
        parseRetryAfter(response?.headers.get("retry-after") ?? null),
      );
      policy.onRetry?.(info);
      lastError = error;

      // Abortável: sem isto, um cancelamento no meio do backoff esperaria os
      // 8 segundos antes de perceber.
      await sleep(info.delayMs, init.signal ?? undefined);
    }

    // Inalcançável: o laço sempre retorna ou lança antes.
    throw this.transportError(lastError, policy.maxAttempts);
  }

  private transportError(error: Error | undefined, attempts: number): Error {
    const suffix = attempts > 1 ? ` (after ${attempts} attempts)` : "";
    const detail = error?.message ?? String(error);
    return new Error(`HTTP request failed${suffix}: ${detail}`, {
      cause: error,
    });
  }
}

/** Combina o signal de quem chamou com o timeout da política. */
function combineSignals(
  externo: AbortSignal | null | undefined,
  timeoutMs: number | undefined,
): AbortSignal | undefined {
  const sinais: AbortSignal[] = [];
  if (externo) sinais.push(externo);
  if (timeoutMs !== undefined) sinais.push(AbortSignal.timeout(timeoutMs));

  if (sinais.length === 0) return undefined;
  return sinais.length === 1 ? sinais[0] : AbortSignal.any(sinais);
}
