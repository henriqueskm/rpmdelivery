import { handleGeocoding } from "@/lib/geocoding/handler";

export function POST(request: Request) {
  return handleGeocoding(request, "suggest");
}
