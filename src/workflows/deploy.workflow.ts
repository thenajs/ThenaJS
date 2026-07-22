import { Workflow } from "@mimir-js/core";
import { PlannerAgent } from "../agents/planner/planner.agent.js";
import { ReviewerAgent } from "../agents/reviewer/reviewer.agent.js";

@Workflow({
  steps: [
    PlannerAgent,
    ReviewerAgent,
  ],
})
export class DeployWorkflow {}
