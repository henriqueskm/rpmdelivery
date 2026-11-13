"use client";
import Image from "next/image";
import { useState } from "react";
import { clockTime, trackingMapUrl, type Tracking } from "@/lib/tracking/view";

export function TrackingMap({ courier, destination }: Pick<Tracking, "courier" | "destination">) {
  const src = trackingMapUrl(process.env.NEXT_PUBLIC_MAPBOX_MAP_TOKEN, courier, destination);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const time = clockTime(courier?.recordedAt ?? null);
  const alt = courier && destination ? "Mapa com o entregador e o seu endereço"
    : courier ? "Mapa com a posição do entregador" : "Mapa com o seu endereço";
  return (
    <figure className="tracking-map">
      {src && failedSrc !== src
        ? <Image unoptimized src={src} width={640} height={320} alt={alt}
            referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} />
        : <p className="map-unavailable">Mapa indisponível no momento.</p>}
      <figcaption>
        {courier && time
          ? <><span className="tracking-live" aria-hidden="true" />Posição do entregador às {time}</>
          : "Aguardando a posição do entregador."}
      </figcaption>
    </figure>
  );
}
