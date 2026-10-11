"use client";

import Image from "next/image";
import { useState } from "react";
import type { ResolvedAddress } from "@/services/geocoding/types";

export function AddressConfirmationMap({ address }: { address: ResolvedAddress }) {
  const [failed, setFailed] = useState(false);
  const token = process.env.NEXT_PUBLIC_MAPBOX_MAP_TOKEN;
  const location = `${address.longitude},${address.latitude}`;
  // Only a separate, public Maps token can be embedded in this image URL.
  const src = token?.startsWith("pk.")
    ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-s+bd401b(${location})/${location},15/600x240@2x?access_token=${encodeURIComponent(token)}`
    : null;
  return (
    <figure className="address-confirmation">
      {src && !failed ? (
        <Image unoptimized src={src} width={600} height={240}
          alt="Mapa do endereço confirmado, com marcador do restaurante"
          onError={() => setFailed(true)} />
      ) : (
        <p className="map-unavailable">{failed ? "Mapa indisponível no momento." : "Configure o token público do mapa para visualizar a localização."}</p>
      )}
      <figcaption>
        <strong>✓ Endereço confirmado</strong>
        <span>{address.address}</span>
      </figcaption>
    </figure>
  );
}
