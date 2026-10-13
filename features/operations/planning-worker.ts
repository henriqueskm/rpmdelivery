import { planRoutes } from "../route-planning/plan";
import { reviewGroups } from "../route-planning/evaluation";
import type { PlannedGroup, PlanningInput } from "../route-planning/types";

// No fetch, provider/token, React, storage or operational mutation inside this worker.
self.onmessage = (event: MessageEvent<{input:PlanningInput;groups?:PlannedGroup[]}>) => {
  try {
    const {input,groups}=event.data;
    self.postMessage({result:groups?reviewGroups(input,groups):planRoutes(input)});
  } catch(error) { self.postMessage({error:error instanceof Error && ["coordinates","matrix","invalid","limit","budget","unavailable"].includes(error.message)?error.message:"unavailable"}); }
};
