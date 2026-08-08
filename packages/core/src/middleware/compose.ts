/**
 * Cadeia de middlewares no formato cebola (o mesmo do koa): cada camada recebe
 * a invocação e um `next()`, e decide o que fazer antes e depois dele.
 *
 * ```
 * registrar → hooks → contar → políticaDeErro → [a chamada de verdade]
 * ```
 *
 * O ganho sobre a sequência costurada à mão é que cada preocupação vira uma
 * camada isolada, testável e **removível** — e uma nova (cache, cancelamento,
 * autorização, streaming) entra sem tocar nas outras.
 */
export type Middleware<Inv, Out> = (inv: Inv, next: () => Promise<Out>) => Promise<Out>;

/**
 * Compõe os middlewares numa única função. O primeiro do array é o mais
 * externo; `core` é o que roda no centro, quando todos chamaram `next()`.
 */
export function compose<I, O>(
  middlewares: Middleware<I, O>[],
): (inv: I, core: () => Promise<O>) => Promise<O> {
  return (inv, core) => {
    let ultimo = -1;

    const despachar = (n: number): Promise<O> => {
      // Um middleware que chama `next()` duas vezes executaria o resto da
      // cadeia em duplicidade — inclusive a chamada ao modelo. Falhar alto é
      // melhor do que cobrar duas vezes em silêncio.
      if (n <= ultimo) {
        return Promise.reject(
          new Error("[thena] next() foi chamado mais de uma vez no mesmo middleware."),
        );
      }
      ultimo = n;

      const middleware = middlewares[n];
      return middleware ? middleware(inv, () => despachar(n + 1)) : core();
    };

    return despachar(0);
  };
}
