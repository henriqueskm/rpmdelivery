import type { Metadata } from "next";
import { TrackingPage } from "@/features/tracking/tracking-page";
import { isTrackingToken } from "@/lib/tracking/links";

// The token is the only credential: keep it out of referrers and search engines.
export async function generateMetadata(props: PageProps<"/acompanhar/[token]">): Promise<Metadata> {
  const token = (await props.params).token.toLowerCase();
  return {
    title: "Acompanhar pedido | RpmDelivery",
    referrer: "no-referrer",
    robots: { index: false, follow: false },
    // Added to the home screen, the icon opens this order (and, on the iPhone, can receive notifications).
    ...(isTrackingToken(token) && {
      manifest: `/acompanhar/${token}/manifest.webmanifest`,
      appleWebApp: { capable: true, title: "Meu pedido", statusBarStyle: "default" as const },
      icons: { apple: "/courier/apple-touch-180.png" },
    }),
  };
}

export default async function Page(props: PageProps<"/acompanhar/[token]">) {
  const { token } = await props.params;
  return <TrackingPage token={token.toLowerCase()} />;
}
