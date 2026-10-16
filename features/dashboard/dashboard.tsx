"use client";

import { WorkspaceStatus } from "@/components/workspace-status";
import { useWorkspace } from "@/hooks/use-workspace";
import { SignOut } from "@/features/auth/sign-out";
import { Operations } from "@/features/operations/operations";

export function Dashboard() {
  const { state, retry } = useWorkspace("dashboard");
  if (state.status !== "ready" || !state.restaurant)
    return (
      <WorkspaceStatus
        message={state.status === "error" ? state.message : undefined}
        retry={retry}
      />
    );
  return (
    <Operations
      courierManagementHref="/motoboys"
      key={state.restaurant.id}
      restaurantName={state.restaurant.name}
      email={state.user.email}
      accountAction={<SignOut />}
    />
  );
}
