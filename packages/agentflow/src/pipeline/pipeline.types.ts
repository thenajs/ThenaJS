import { StateManager } from "../state/index.js";

/**
 * Como o loop mais recente terminou. Em loops aninhados o último a terminar
 * vence — para o dado aninhado e confiável, leia a árvore do report.
 */
export interface LoopInfo {
    /** Quantas vezes o corpo do loop executou. */
    iterations: number;
    /** `true` se parou por `maxIterations`, não por `until`. */
    exhausted: boolean;
    /** O teto configurado, se houve. */
    maxIterations?: number;
}

export interface PipelineContext<Output = any> {
    state: StateManager;
    output?: Output;
    logs: string[];
    /** Resumo do loop mais recente, gravado pelo `Pipeline.loop`. */
    loop?: LoopInfo;
}

export type Step<C> = (ctx: C) => Promise<C> | C;

export interface ParallelOptions<C> {
    steps: Step<C>[];
}

export interface LoopOptions<C> {
    steps: Step<C>[];
    until: (ctx: C) => boolean | Promise<boolean>;
    maxIterations?: number;
    /** Chamado quando o loop parou por `maxIterations` em vez de por `until`. */
    onExhausted?: (ctx: C, iterations: number) => unknown | Promise<unknown>;
}


