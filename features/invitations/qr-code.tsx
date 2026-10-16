"use client";
import { useMemo } from "react";
import { inviteQr } from "@/lib/invitations/qr";
export function InviteQr({ value }: { value: string }) {
  const { size, path } = useMemo(() => {
    const qr = inviteQr(value), size = qr.getModuleCount() + 8;
    let path = "";
    for (let y = 0; y < size - 8; y++) for (let x = 0; x < size - 8; x++) {
      if (qr.isDark(y, x)) path += `M${x + 4} ${y + 4}h1v1h-1z`;
    }
    return { size, path };
  }, [value]);
  return <svg className="invite-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QR Code do convite" shapeRendering="crispEdges">
    <rect width={size} height={size} fill="#fff" /><path d={path} fill="#000" />
  </svg>;
}
