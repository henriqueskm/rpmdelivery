import type { Request } from "@playwright/test";

// Next can cancel an Auth RSC stream when navigation replaces the current page.
// Keep HTTP failures, API failures and every other network error as test failures.
export function isCancelledAuthNavigation(request: Request) {
  const url = new URL(request.url());
  return request.failure()?.errorText === "net::ERR_ABORTED"
    && request.resourceType() === "fetch"
    && request.headers().rsc === "1"
    && url.searchParams.has("_rsc")
    && ["/login", "/cadastro"].includes(url.pathname);
}
