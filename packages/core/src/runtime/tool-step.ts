import { toToolOutput } from "@thenajs/agentflow";
import type { ToolType } from "@thenajs/agentflow";
import { PLAN } from "../di/tool.js";
import type { InjectionPlan } from "../di/tool.js";
import { resolvePoint } from "../di/params.js";
import type { Injectable } from "../di/params.js";
import { compose } from "../middleware/compose.js";
import { toolChain } from "../middleware/tool.js";
import type { ToolInvocation } from "../middleware/tool.js";
import { currentRun } from "../run-context.js";
import type { AgentContext } from "../types.js";

/**
 * Monta o `ToolType` que o provider vai executar, passando a chamada pela
 * cadeia de middlewares (report, hooks do agente, orçamento, política de erro).
 *
 * O centro da cadeia é só a chamada do `execute` — tudo em volta é camada.
 */
export function buildToolStep(
  tool: ToolType,
  instance: any,
  ctx: AgentContext,
  available: Injectable,
): ToolType {
  // Quando o `execute` tem parâmetros decorados, a chamada é montada aqui —
  // é o primeiro ponto do caminho que conhece o ctx.
  const plano = (tool as any)[PLAN] as InjectionPlan | undefined;
  const executar = plano
    ? (args: unknown) => {
        const ctorArgs = plano.points.map((ponto, i) =>
          ponto
            ? resolvePoint(
                ponto,
                { ...available, ctx, args },
                `${plano.name}.execute`,
                i,
              )
            : undefined,
        );
        return Promise.resolve(plano.instance.execute(...ctorArgs));
      }
    : (args: unknown) => tool.execute(args);

  // A cadeia é montada uma vez por tool, e não a cada execução: os
  // middlewares vêm do `RunContext`, que não muda dentro de uma run.
  const chain = compose(toolChain(currentRun().middleware.tool));

  return {
    ...tool,
    execute: (args: unknown) => {
      const runCtx = currentRun();

      const invocation: ToolInvocation = {
        name: tool.name,
        args,
        agent: instance,
        ctx,
        run: runCtx,
        // O nó só existe depois que o `registrarTool` abre — até lá, no-op.
        meta: (data) => {
          if (invocation.node) runCtx.recorder.meta(invocation.node, data);
        },
      };

      // `inv.args` é lido aqui dentro, e não capturado antes: um `beforeTool`
      // pode tê-los trocado no caminho.
      return chain(invocation, async () =>
        toToolOutput(await executar(invocation.args)),
      );
    },
  };
}
