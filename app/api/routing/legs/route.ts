import { handleRouteLegs } from "@/lib/routing/legs-handler";

export function POST(request: Request) {
  return handleRouteLegs(request);
}
