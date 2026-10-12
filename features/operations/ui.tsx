import type { ReactNode } from "react";
import type { RouteStatus } from "./model";

export function Icon({
  name,
}: {
  name: "orders" | "route" | "courier" | "activity" | "search" | "plus";
}) {
  const paths = {
    orders: (
      <>
        <path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />
      </>
    ),
    route: (
      <>
        <circle cx="5" cy="6" r="2" />
        <circle cx="19" cy="18" r="2" />
        <path d="M7 6h8a4 4 0 0 1 0 8H9a4 4 0 0 0 0 4h8" />
      </>
    ),
    courier: (
      <>
        <circle cx="12" cy="7" r="3" />
        <path d="M5 21v-3a7 7 0 0 1 14 0v3M8 21h8" />
      </>
    ),
    activity: (
      <>
        <path d="M3 12h4l3-7 4 14 3-7h4" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`ops-badge ops-badge-${tone}`}>{children}</span>;
}
export const routeLabels: Record<RouteStatus, string> = {
  PREPARING: "Em preparação",
  ON_ROUTE: "Em rota",
  RETURNING: "Retornando",
  COMPLETED: "Concluída",
};
export function RouteBadge({ status }: { status: RouteStatus }) {
  return (
    <Badge
      tone={
        {
          PREPARING: "amber",
          ON_ROUTE: "green",
          RETURNING: "blue",
          COMPLETED: "neutral",
        }[status]
      }
    >
      {routeLabels[status]}
    </Badge>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="ops-empty">
      <Icon name="orders" />
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
