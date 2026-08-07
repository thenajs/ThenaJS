import type { ExecutionEvent } from "./observability/recorder.js";

/**
 * A execução devolvida por `app.run(...)`.
 *
 * A regra: **com `await`, você pede o resultado; sem `await`, você pede a
 * execução.** O handle é *thenable*, então as duas coisas convivem sem que
 * `run` precise virar dois métodos.
 *
 * ```ts
 * const texto = await app.run({ input });   // resultado
 * const exec = app.run({ input });          // execução
 * ```
 *
 * Existe porque uma `Promise` não expressa três usos reais: cancelar, observar
 * o que está acontecendo, e **guardar** a execução para reencontrá-la depois —
 * o padrão de responder um `runId` num POST e acompanhar por SSE.
 */
export interface RunHandle<T> extends PromiseLike<T> {
  /**
   * Disponível **de forma síncrona**, antes mesmo do primeiro turno. É o que
   * permite responder `{ runId }` num POST e o cliente acompanhar depois.
   */
  readonly runId: string;

  /** A saída final. Promise comum — compõe com `Promise.all`, `.then`, tudo. */
  readonly result: Promise<T>;

  /** O signal efetivo: o seu, combinado com o `abort()` deste handle. */
  readonly signal: AbortSignal;

  /**
   * Cancela a execução. A `reason` chega inteira no `catch` — use um erro seu
   * quando quiser distinguir o motivo.
   */
  abort(reason?: unknown): void;

  /**
   * Observa a execução. **Quem assina depois do início recebe o que já
   * passou** antes dos eventos novos — sem isso, um SSE que conecta três
   * segundos após o POST veria a execução começando do meio.
   *
   * Devolve como cancelar a assinatura.
   */
  onEvent(cb: (e: ExecutionEvent) => void): () => void;

  /** O mesmo stream como `AsyncIterable` — dá backpressure num socket lento. */
  readonly eventStream: AsyncIterable<ExecutionEvent>;

  /**
   * Cada pedaço de texto que o modelo produz, à medida que produz.
   *
   * Canal separado do `onEvent` de propósito: token não é um passo da execução
   * — não tem início, fim nem status. Quem assina atrasado recebe o texto que
   * já saiu, então o `for await` de um cliente que conecta tarde não começa do
   * meio da frase.
   *
   * **Só emite se o provider suportar.** Um provider que ignore o `onToken`
   * continua funcionando; o texto simplesmente chega inteiro no `result`.
   */
  onToken(cb: (token: string) => void): () => void;

  /** O mesmo, como `AsyncIterable`. */
  readonly textStream: AsyncIterable<string>;

  // `catch` e `finally` além do `then` do PromiseLike: sem eles,
  // `app.run(...).catch(...)` — que é como se trata erro sem `try` — deixaria
  // de compilar, e o handle só pareceria uma Promise.
  //
  // Os três devolvem `Promise` comum: encadear **descarta** o handle, e é o
  // comportamento certo. Quem precisa de `abort()` guarda a variável.
  catch<R = never>(
    aoFalhar?: ((motivo: unknown) => R | PromiseLike<R>) | null,
  ): Promise<T | R>;
  finally(aoFinal?: (() => void) | null): Promise<T>;
}

/**
 * Quantos eventos guardar para quem assina atrasado.
 *
 * Com `report` ligado cada evento carrega prompt e resposta (até 20 KB por
 * nó), e o padrão do POST+SSE mantém N handles vivos ao mesmo tempo. O teto
 * troca o começo de uma execução muito longa por um limite de memória
 * previsível.
 */
export const MAX_EVENTOS_NO_BUFFER = 500;

/**
 * Um canal que guarda, reproduz para quem chega atrasado, e distribui.
 *
 * Genérico porque a execução tem dois: os passos (`ExecutionEvent`) e o texto
 * (`string`). Eles não se misturam — token não tem início, fim nem status.
 */
export class Canal<T> {
  private readonly passados: T[] = [];
  private readonly ouvintes = new Set<(item: T) => void>();
  private encerrado = false;

  constructor(private readonly max = MAX_EVENTOS_NO_BUFFER) {}

  publicar(item: T): void {
    this.passados.push(item);
    if (this.passados.length > this.max) this.passados.shift();

    for (const cb of this.ouvintes) {
      // Isolado: um assinante que lança não afeta a execução nem os outros.
      try {
        cb(item);
      } catch {
        /* ignorado de propósito */
      }
    }
  }

  assinar(cb: (item: T) => void): () => void {
    // O histórico primeiro, e só então os novos.
    for (const item of this.passados) {
      try {
        cb(item);
      } catch {
        /* ignorado de propósito */
      }
    }
    // Quem assina depois do fim recebe o histórico e o encerramento na hora.
    if (this.encerrado) {
      (cb as { __fim?: () => void }).__fim?.();
      return () => {};
    }
    this.ouvintes.add(cb);
    return () => this.ouvintes.delete(cb);
  }

  /** Fecha os iteradores abertos, para o `for await` de quem observa terminar. */
  encerrar(): void {
    this.encerrado = true;
    for (const cb of [...this.ouvintes]) {
      (cb as { __fim?: () => void }).__fim?.();
    }
  }

  async *iterar(): AsyncIterableIterator<T> {
    const pendentes: T[] = [];
    let acordar: (() => void) | undefined;
    let terminou = false;

    const cb = (item: T) => {
      pendentes.push(item);
      acordar?.();
    };
    (cb as { __fim?: () => void }).__fim = () => {
      terminou = true;
      acordar?.();
    };

    const cancelar = this.assinar(cb);
    try {
      while (true) {
        while (pendentes.length) yield pendentes.shift()!;
        if (terminou) return;
        await new Promise<void>((r) => (acordar = r));
        acordar = undefined;
      }
    } finally {
      cancelar();
    }
  }
}

/** @deprecated Use `Canal<ExecutionEvent>`. Mantido para não quebrar imports. */
export class FilaDeEventos extends Canal<ExecutionEvent> {}

/** Monta o handle a partir das peças que o `bootstrap` já tem. */
export function criarRunHandle<T>(peças: {
  runId: string;
  result: Promise<T>;
  signal: AbortSignal;
  abort: (reason?: unknown) => void;
  eventos: Canal<ExecutionEvent>;
  tokens: Canal<string>;
  /** A execução está sendo observada? Ver `run({ observe })`. */
  observando: boolean;
}): RunHandle<T> {
  const { runId, result, signal, abort, eventos, tokens, observando } = peças;

  // Sem isto, o padrão do POST+SSE derruba o processo: ninguém deu `await`
  // ainda quando a execução falha, e o Node dispara `unhandledRejection`. O
  // erro continua disponível em `.result` — só deixa de ser "não tratado".
  result.catch(() => {});

  /**
   * Uma execução não observada não emite nada, e um canal silencioso é
   * indistinguível de um bug. Avisa uma vez, dizendo o que fazer — o preço de
   * ter tornado a observação opcional é não deixar ninguém descobrir isso
   * olhando um `for await` que nunca rende.
   */
  let avisou = false;
  const avisarSeMudo = (metodo: string) => {
    if (observando || avisou) return;
    avisou = true;
    console.warn(
      `[thena] ${metodo} não vai receber nada: esta execução não está sendo ` +
        `observada. Use \`run({ observe: true })\`, ou ligue \`report\`, \`log\` ` +
        `ou um plugin com \`onEvent\`.`,
    );
  };

  return {
    runId,
    result,
    signal,
    abort,
    onEvent: (cb) => {
      avisarSeMudo("onEvent()");
      return eventos.assinar(cb);
    },
    get eventStream() {
      avisarSeMudo("eventStream");
      return eventos.iterar();
    },
    onToken: (cb) => {
      avisarSeMudo("onToken()");
      return tokens.assinar(cb);
    },
    get textStream() {
      avisarSeMudo("textStream");
      return tokens.iterar();
    },
    then: (ok, err) => result.then(ok, err),
    catch: (aoFalhar) => result.catch(aoFalhar),
    finally: (aoFinal) => result.finally(aoFinal),
  };
}
