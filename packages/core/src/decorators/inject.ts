import type { VectorStoreCtor } from "@thenajs/agentflow";
import { resolverContexto } from "../vista-da-run.js";
import type { Context, DadosDaRun } from "../types.js";

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
export type PontoDeInjecao =
  | { tipo: "input" }
  | { tipo: "context" }
  | { tipo: "state" }
  | { tipo: "memory"; store?: VectorStoreCtor };

/** classe -> método -> índice do parâmetro -> o que ele pede. */
const registro = new WeakMap<Function, Map<string, (PontoDeInjecao | undefined)[]>>();

const CONSTRUTOR = "constructor";

function marcar(ponto: PontoDeInjecao): ParameterDecorator {
  return (target, chave, indice) => {
    // Em construtor, `target` é a própria classe e `chave` é undefined.
    // Em método, `target` é o prototype e `chave` é o nome do método.
    const classe = (chave === undefined ? target : target.constructor) as Function;
    const metodo = chave === undefined ? CONSTRUTOR : String(chave);

    const porMetodo = registro.get(classe) ?? new Map();
    registro.set(classe, porMetodo);

    const pontos = porMetodo.get(metodo) ?? [];
    pontos[indice] = ponto;
    porMetodo.set(metodo, pontos);
  };
}

/**
 * Os argumentos validados pelo schema da tool.
 *
 * ```ts
 * async execute(@input() args: { caminho: string }) { … }
 * ```
 */
export const input = (): ParameterDecorator => marcar({ tipo: "input" });

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
export const context = <D extends DadosDaRun = DadosDaRun>(): ParameterDecorator &
  Context<D> => {
  const decorator = marcar({ tipo: "context" });

  return new Proxy(decorator, {
    // Aqui `@context()` é aplicado — no load do módulo, fora de qualquer run.
    // Nada do contexto é resolvido neste caminho.
    apply: (alvo, esteArg, args) =>
      Reflect.apply(alvo as (...a: unknown[]) => unknown, esteArg, args),

    get: (alvo, prop, receiver) => {
      // Props da própria função (`name`, `length`) e símbolos de inspeção não
      // podem resolver o contexto: `console.log(context())` sondaria dezenas
      // deles e explodiria fora de uma execução.
      if (typeof prop === "symbol" || prop in alvo) {
        return Reflect.get(alvo, prop, receiver);
      }
      return (resolverContexto() as Record<string, unknown>)[prop];
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
export const state = (): ParameterDecorator => marcar({ tipo: "state" });

/**
 * Uma memória vetorial. Sem argumento, a primeira registrada; com a classe do
 * store, a que corresponde a ela — o que dispensa depender da ordem do array.
 *
 * ```ts
 * constructor(@memory(QdrantOpenAI) private readonly vetor: VectorMemory) {}
 * ```
 */
export const memory = (store?: VectorStoreCtor): ParameterDecorator =>
  marcar({ tipo: "memory", store });

/** Os pontos declarados num método (ou no construtor). `undefined` = nenhum. */
export function pontosDe(
  classe: Function,
  metodo: string = CONSTRUTOR,
): (PontoDeInjecao | undefined)[] | undefined {
  return registro.get(classe)?.get(metodo);
}

export { CONSTRUTOR };
