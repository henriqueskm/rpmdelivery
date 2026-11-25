// What the e-mail link brought in the URL hash: the recovery session, an error (expired or reused link)
// or nothing (the page was opened to ask for a link).
export function linkKind(hash: string): "recovery" | "error" | "none" {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (params.get("error") || params.get("error_code")) return "error";
  return params.get("type") === "recovery" ? "recovery" : "none";
}
