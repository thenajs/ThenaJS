/**
 * Política de retry e timeout das chamadas HTTP dos providers.
 *
 * Vem **ligada por padrão**: um 429 ou um 503 momentâneo não deve derrubar uma
 * run inteira. O que não tem default é o `timeoutMs` — é o único parâmetro
 * capaz de quebrar um setup que já funcionava (abortar um modelo local lento
 * que hoje responde em 200s), então fica opt-in.
 */

export interface RetryPolicy {
  /** Tentativas no total, incluindo a primeira. Default: 3. */
  maxAttempts?: number;
  /**
   * Teto de cada tentativa, via `AbortSignal.timeout`. **Sem default**: um
   * teto arbitrário abortaria modelo local lento que hoje funciona. Ligue
   * quando quiser que travamento vire falha recuperável em vez de fatal.
   */
  timeoutMs?: number;
  /** Espera inicial do backoff exponencial. Default: 500. */
  initialDelayMs?: number;
  /** Teto da espera entre tentativas. Default: 8000. */
  maxDelayMs?: number;
  /** Multiplicador do backoff. Default: 2. */
  factor?: number;
  /** Honrar o header `Retry-After` quando o servidor o envia. Default: true. */
  respectRetryAfter?: boolean;
  /** Substitui a decisão padrão do que é retentável. */
  isRetryable?: (info: RetryAttempt) => boolean;
  /** Observabilidade: chamado antes de esperar para a próxima tentativa. */
  onRetry?: (info: RetryAttempt) => void;
}

/** O que aconteceu na tentativa que acabou de falhar. */
export interface RetryAttempt {
  /** 1-based: a tentativa que falhou. */
  attempt: number;
  maxAttempts: number;
  /** Status HTTP, quando houve resposta. */
  status?: number;
  /** Erro de rede ou abort por timeout, quando não houve resposta. */
  error?: Error;
  /** Espera até a próxima tentativa, em ms. */
  delayMs: number;
}

/** A política já normalizada — o que o `request()` consome. */
export type ResolvedRetry = Required<
  Pick<
    RetryPolicy,
    "maxAttempts" | "initialDelayMs" | "maxDelayMs" | "factor" | "respectRetryAfter"
  >
> &
  Pick<RetryPolicy, "timeoutMs" | "isRetryable" | "onRetry">;

const DEFAULTS: ResolvedRetry = {
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 8_000,
  factor: 2,
  respectRetryAfter: true,
};

/**
 * Status que valem uma nova tentativa. Erros de contrato (400, 401, 403, 404…)
 * ficam de fora de propósito: reexecutar só gasta tempo e dinheiro.
 */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Normaliza o que veio das credentials. `false` reduz a uma tentativa — o
 * comportamento anterior ao retry; `true` ou ausente usa os defaults.
 */
export function resolveRetry(input?: RetryPolicy | boolean): ResolvedRetry {
  if (input === false) {
    return { ...DEFAULTS, maxAttempts: 1 };
  }
  if (input === true || input === undefined) {
    return { ...DEFAULTS };
  }
  return {
    ...DEFAULTS,
    ...prune(input),
    // `maxAttempts: 0` não deve virar "ilimitado" nem "nenhuma tentativa".
    maxAttempts: Math.max(1, input.maxAttempts ?? DEFAULTS.maxAttempts),
  };
}

/** Decisão padrão: transitório se tentar de novo pode dar outro resultado. */
export function isRetryableByDefault(info: RetryAttempt): boolean {
  if (info.status !== undefined) return RETRYABLE_STATUS.has(info.status);
  // Sem status houve erro de rede ou abort por timeout — ambos transitórios.
  return info.error !== undefined;
}

/**
 * Backoff exponencial com *full jitter*: espalha as tentativas de clientes
 * concorrentes em vez de sincronizá-las num pico.
 *
 * Um `Retry-After` do servidor vence o cálculo — ele sabe melhor que nós.
 */
export function backoffDelay(
  attempt: number,
  policy: ResolvedRetry,
  retryAfterMs?: number,
): number {
  if (policy.respectRetryAfter && retryAfterMs !== undefined) {
    return retryAfterMs;
  }
  const teto = Math.min(
    policy.initialDelayMs * policy.factor ** (attempt - 1),
    policy.maxDelayMs,
  );
  return Math.round(Math.random() * teto);
}

/**
 * Lê o header `Retry-After`, que vem em segundos ou como data HTTP.
 * Devolve `undefined` quando ausente ou ilegível.
 */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;

  const segundos = Number(header);
  if (Number.isFinite(segundos)) return Math.max(0, segundos * 1000);

  const data = Date.parse(header);
  if (Number.isNaN(data)) return undefined;

  return Math.max(0, data - Date.now());
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function prune(policy: RetryPolicy): Partial<RetryPolicy> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(policy)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<RetryPolicy>;
}
