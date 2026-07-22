import { Workflow, parallel, loop } from "@mimir-js/core";
import { ExplorerAgent } from "../agents/explorer/explorer.agent.js";
import { PlannerAgent } from "../agents/planner/planner.agent.js";
import { ReviewerAgent } from "../agents/reviewer/reviewer.agent.js";

@Workflow({
  steps: [
    PlannerAgent,
    loop({
      maxIterations: 5,
      until: (ctx) => ctx.reviewApproved,
      steps: [
        parallel([
          ExplorerAgent,
          ReviewerAgent,
        ]),
      ],
    }),
  ],
})
export class ExplorerWorkflow {}
