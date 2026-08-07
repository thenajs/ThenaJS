import type { VectorStoreCtor } from "@thenajs/agentflow";

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
 * O contexto da execução.
 *
 * Só faz sentido em **métodos** chamados durante a execução (o `execute` de uma
 * tool). No construtor de um agente o contexto ainda não existe — usar lá é erro
 * e o runtime avisa.
 */
export const context = (): ParameterDecorator => marcar({ tipo: "context" });

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
