import { StateManager } from "../state/index.js";

export interface PipelineContext<Output = any> {
    state: StateManager;
    output?: Output;
    logs: string[];
}

export type Step<C> = (ctx: C) => Promise<C> | C;

export interface ParallelOptions<C> {
    steps: Step<C>[];
}

export interface LoopOptions<C> {
    steps: Step<C>[];
    until: (ctx: C) => boolean | Promise<boolean>;
    maxIterations?: number;
}


