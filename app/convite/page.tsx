import type { Metadata } from "next";
import { CourierInvitePage } from "@/features/invitations/invite-page";
export const metadata: Metadata = { title: "Convite para motoboy | RpmDelivery", referrer: "no-referrer", robots: { index: false, follow: false } };
export default function InvitePage() { return <CourierInvitePage />; }
