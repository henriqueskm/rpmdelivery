import type { Metadata } from "next";
import { Operations } from "@/features/operations/operations";
import { optimizationScenarios, automaticScenarios, issueScenarios, type Scenario } from "@/features/operations/fixtures";

export const metadata: Metadata = {
  title: "Central de operações — Preview | RpmDelivery",
  robots: { index: false, follow: false },
};

// Public visual prototype: fixed fictional data, no session or restaurant lookup.
export default async function OperationsPreview({
  searchParams,
}: PageProps<"/preview/operacao">) {
  const { scenario } = await searchParams;
  const allowed: Scenario[] = ["demo", "worst", "empty", "one", "busy", ...optimizationScenarios.map(([value])=>value), ...automaticScenarios.map(([value])=>value), ...issueScenarios.map(([value])=>value)];
  const initialScenario = allowed.includes(scenario as Scenario)
    ? (scenario as Scenario)
    : "demo";
  return (
    <Operations
      restaurantName="Cozinha do Bairro · demonstração"
      preview
      initialScenario={initialScenario}
    />
  );
}
