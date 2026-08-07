import { toToolOutput } from "@thenajs/agentflow";
import type { ToolType } from "@thenajs/agentflow";
import { PLANO } from "../di/tool.js";
import type { PlanoDeInjecao } from "../di/tool.js";
import { resolverPonto } from "../di/params.js";
import type { Disponivel } from "../di/params.js";
import { compose } from "../middleware/compose.js";
import { cadeiaDeTool } from "../middleware/tool.js";
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
  disponivel: Disponivel,
): ToolType {
  // Quando o `execute` tem parâmetros decorados, a chamada é montada aqui —
  // é o primeiro ponto do caminho que conhece o ctx.
  const plano = (tool as any)[PLANO] as PlanoDeInjecao | undefined;
  const executar = plano
    ? (args: unknown) => {
        const argumentos = plano.pontos.map((ponto, i) =>
          ponto
            ? resolverPonto(
                ponto,
                { ...disponivel, ctx, args },
                `${plano.nome}.execute`,
                i,
              )
            : undefined,
        );
        return Promise.resolve(plano.instance.execute(...argumentos));
      }
    : (args: unknown) => tool.execute(args);

  return {
    ...tool,
    execute: (args: unknown) => {
      const execucao = currentRun();

      const invocacao: ToolInvocation = {
        name: tool.name,
        args,
        agent: instance,
        ctx,
        run: execucao,
        // O nó só existe depois que o `registrarTool` abre — até lá, no-op.
        meta: (dados) => {
          if (invocacao.node) execucao.recorder.meta(invocacao.node, dados);
        },
      };

      const cadeia = compose(cadeiaDeTool(execucao.middleware.tool));

      // `inv.args` é lido aqui dentro, e não capturado antes: um `beforeTool`
      // pode tê-los trocado no caminho.
      return cadeia(invocacao, async () =>
        toToolOutput(await executar(invocacao.args)),
      );
    },
  };
}
