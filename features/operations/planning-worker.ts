import { planRoutes } from "../route-planning/plan";
import { reviewGroups } from "../route-planning/evaluation";
import type { PlannedGroup, PlanningInput, PendingOrder } from "../route-planning/types";

// No fetch, provider/token, React, storage or operational mutation inside this worker.
self.onmessage = (event: MessageEvent<{input:PlanningInput;groups?:PlannedGroup[];previousPending?:PendingOrder[]}>) => {
  try {
    const {input,groups,previousPending}=event.data;
    self.postMessage({result:groups?reviewGroups(input,groups,previousPending):planRoutes(input)});
  } catch(error) { self.postMessage({error:error instanceof Error && ["coordinates","matrix","invalid","limit","budget","unavailable"].includes(error.message)?error.message:"unavailable"}); }
};
