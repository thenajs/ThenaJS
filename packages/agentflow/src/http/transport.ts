import {
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
    const política = this.retry;
    let ultimoErro: Error | undefined;

    for (let attempt = 1; attempt <= política.maxAttempts; attempt++) {
      let response: Response | undefined;
      let error: Error | undefined;

      try {
        response = await fetch(url, {
          ...init,
          signal:
            init.signal ??
            (política.timeoutMs !== undefined
              ? AbortSignal.timeout(política.timeoutMs)
              : undefined),
        });

        if (response.ok) {
          return { response, attempts: attempt };
        }
      } catch (err) {
        error = err as Error;
      }

      const info: RetryAttempt = {
        attempt,
        maxAttempts: política.maxAttempts,
        status: response?.status,
        error,
        delayMs: 0,
      };

      const podeTentar =
        attempt < política.maxAttempts &&
        (política.isRetryable ?? isRetryableByDefault)(info);

      if (!podeTentar) {
        // Devolve a resposta com erro para quem chamou montar a mensagem
        // dele (que inclui o corpo); só relança quando nem resposta houve.
        if (response) return { response, attempts: attempt };
        throw this.erroDeTransporte(error, attempt);
      }

      info.delayMs = backoffDelay(
        attempt,
        política,
        parseRetryAfter(response?.headers.get("retry-after") ?? null),
      );
      política.onRetry?.(info);
      ultimoErro = error;

      await sleep(info.delayMs);
    }

    // Inalcançável: o laço sempre retorna ou lança antes.
    throw this.erroDeTransporte(ultimoErro, política.maxAttempts);
  }

  private erroDeTransporte(error: Error | undefined, attempts: number): Error {
    const sufixo = attempts > 1 ? ` (após ${attempts} tentativas)` : "";
    const detalhe = error?.message ?? String(error);
    return new Error(`Falha na chamada HTTP${sufixo}: ${detalhe}`, {
      cause: error,
    });
  }
}
