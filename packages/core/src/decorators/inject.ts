import type { VectorStoreCtor } from "@thenajs/agentflow";
import { resolveContext } from "../run-view.js";
import type { Context, RunData } from "../types.js";

/**
 * Injeção por decorator de parâmetro.
 *
 * Diferente de `reflect-metadata`, que lê os **tipos** dos parâmetros, aqui
 * cada parâmetro diz explicitamente o que quer. Isso importa porque o esbuild
 * (que o `tsx` usa em dev) não emite `design:paramtypes` — mas emite as chamadas
 * dos decorators, então este caminho funciona tanto compilado quanto em dev.
 *
 * O ganho sobre a injeção posicional é a ordem deixar de ser contrato: dois
 * parâmetros do mesmo tipo (duas `VectorMemory`, por exemplo) passam a ser
 * distinguíveis sem depender de índice.
 */

/** O que um parâmetro decorado pede. */
export type InjectionPoint =
  | { kind: "input" }
  | { kind: "context" }
  | { kind: "state" }
  | { kind: "memory"; store?: VectorStoreCtor };

/** classe -> método -> índice do parâmetro -> o que ele pede. */
const entry = new WeakMap<Function, Map<string, (InjectionPoint | undefined)[]>>();

const CONSTRUCTOR = "constructor";

function mark(ponto: InjectionPoint): ParameterDecorator {
  return (target, chave, indice) => {
    // Em construtor, `target` é a própria classe e `chave` é undefined.
    // Em método, `target` é o prototype e `chave` é o nome do método.
    const classe = (chave === undefined ? target : target.constructor) as Function;
    const metodo = chave === undefined ? CONSTRUCTOR : String(chave);

    const porMetodo = entry.get(classe) ?? new Map();
    entry.set(classe, porMetodo);

    const points = porMetodo.get(metodo) ?? [];
    points[indice] = ponto;
    porMetodo.set(metodo, points);
  };
}

/**
 * Os argumentos validados pelo schema da tool.
 *
 * ```ts
 * async execute(@input() args: { caminho: string }) { … }
 * ```
 */
export const input = (): ParameterDecorator => mark({ kind: "input" });

/**
 * O contexto da execução — **duas portas para o mesmo objeto**.
 *
 * Como decorator, injeta o contexto no parâmetro:
 *
 * ```ts
 * async execute(@input() args: Args, @context() ctx: Context) {
 *   await fetch(args.url, { signal: ctx.signal });
 * }
 * ```
 *
 * Como função, devolve o contexto de onde você estiver:
 *
 * ```ts
 * provider: () => new OpenAIProvider({ apiKey: minhaChave(context().data) }),
 * ```
 *
 * As duas devolvem a mesma coisa. A diferença é **quando**: dentro de um passo
 * vem o ctx do passo, com `state` e `turn`; fora dele — numa factory de
 * provider, que roda na compilação — vem o da execução, e tocar em `state`
 * lança com a explicação.
 *
 * O `Proxy` existe por causa disto: `@context()` precisa devolver algo
 * *chamável* (o decorator), e `context()` precisa devolver algo *legível* (o
 * contexto). Um objeto que é as duas coisas é o preço de ter um nome só.
 */
export const context = <D extends RunData = RunData>(): ParameterDecorator &
  Context<D> => {
  const decorator = mark({ kind: "context" });

  return new Proxy(decorator, {
    // Aqui `@context()` é aplicado — no load do módulo, fora de qualquer run.
    // Nada do contexto é resolvido neste caminho.
    apply: (target, esteArg, args) =>
      Reflect.apply(target as (...a: unknown[]) => unknown, esteArg, args),

    get: (target, prop, receiver) => {
      // Props da própria função (`name`, `length`) e símbolos de inspeção não
      // podem resolver o contexto: `console.log(context())` sondaria dezenas
      // deles e explodiria fora de uma execução.
      if (typeof prop === "symbol" || prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      return (resolveContext() as Record<string, unknown>)[prop];
    },
  }) as ParameterDecorator & Context<D>;
};

/**
 * O estado do workflow, declarado em `@Workflow({ state })`.
 *
 * ```ts
 * constructor(@state() private readonly s: RevisaoState) {}
 * ```
 */
export const state = (): ParameterDecorator => mark({ kind: "state" });

/**
 * Uma memória vetorial. Sem argumento, a primeira registrada; com a classe do
 * store, a que corresponde a ela — o que dispensa depender da ordem do array.
 *
 * ```ts
 * constructor(@memory(QdrantOpenAI) private readonly vetor: VectorMemory) {}
 * ```
 */
export const memory = (store?: VectorStoreCtor): ParameterDecorator =>
  mark({ kind: "memory", store });

/** Os pontos declarados num método (ou no construtor). `undefined` = nenhum. */
export function pointsOf(
  classe: Function,
  metodo: string = CONSTRUCTOR,
): (InjectionPoint | undefined)[] | undefined {
  return entry.get(classe)?.get(metodo);
}

export { CONSTRUCTOR };
