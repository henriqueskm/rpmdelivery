import type { Metadata } from "next";
import { TrackingPage } from "@/features/tracking/tracking-page";

// The token is the only credential: keep it out of referrers and search engines.
export const metadata: Metadata = {
  title: "Acompanhar pedido | RpmDelivery",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function Page(props: PageProps<"/acompanhar/[token]">) {
  const { token } = await props.params;
  return <TrackingPage token={token.toLowerCase()} />;
}
