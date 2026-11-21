"use client";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Map as MapboxMap, Marker } from "mapbox-gl";
import { useEffect, useRef, useState } from "react";
import { pointsBounds, publicMapToken } from "@/lib/tracking/motion";
import { courierMarkerElement } from "@/lib/maps/courier-marker";

export type MapCourier = { routeId: string; reference: string; latitude: number; longitude: number; recordedAt: number };
export type MapStop = { id: string; reference: string; latitude: number; longitude: number };
type Point = { latitude: number; longitude: number };

const FIT = { padding: 56, maxZoom: 15 };
const MAP_LOCALE = {
  "Map.Title": "Mapa",
  "NavigationControl.ZoomIn": "Aproximar",
  "NavigationControl.ZoomOut": "Afastar",
  "AttributionControl.ToggleAttribution": "Mostrar créditos do mapa",
  "LogoControl.Title": "Site da Mapbox",
  "ScrollZoomBlocker.CtrlMessage": "Use Ctrl + rolagem para aproximar o mapa",
  "ScrollZoomBlocker.CmdMessage": "Use ⌘ + rolagem para aproximar o mapa",
  "TouchPanBlocker.Message": "Use dois dedos para mover o mapa",
};

function element(kind: "store" | "courier" | "stop", label?: string) {
  if (kind === "courier") {
    // The rider on a motorcycle with the route ("R-1") on a tag above, standing on a dot at the exact position.
    const rider = courierMarkerElement(label, { point: true });
    rider.classList.add("ops-map-marker-courier");
    return rider;
  }
  const node = document.createElement("div");
  node.className = `ops-map-marker ops-map-marker-${kind}`;
  node.setAttribute("aria-hidden", "true");
  node.textContent = kind === "store" ? "Loja" : label ?? "";
  return node;
}

type Live = { map: MapboxMap; markers: Marker[]; make: (kind: "store" | "courier" | "stop", p: Point, label?: string) => Marker };
type Points = { store?: Point; couriers: MapCourier[]; stops: MapStop[] };

/** Redraws every marker from the latest board; the view stays where the store left it. */
function drawMarkers(current: Live | null, { store, couriers, stops }: Points) {
  if (!current) return;
  current.markers.forEach(marker => marker.remove());
  current.markers = [
    ...(store ? [current.make("store", store)] : []),
    ...stops.map(stop => current.make("stop", stop, `#${stop.reference}`)),
    ...couriers.map(courier => current.make("courier", courier, courier.reference)),
  ];
}

/**
 * The store, each courier on the street (labeled with the route) and each route's next stop, on one
 * map. Created when "Acompanhar rotas" opens and removed when it closes: Mapbox bills each new map.
 */
export function RoutesMap({ store, couriers, stops }: { store?: Point; couriers: MapCourier[]; stops: MapStop[] }) {
  const token = publicMapToken(process.env.NEXT_PUBLIC_MAPBOX_MAP_TOKEN);
  const container = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);
  const latest = useRef<Points>({ store, couriers, stops });
  const [failed, setFailed] = useState(!token);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    import("mapbox-gl").then(({ default: mapboxgl }) => {
      if (cancelled || !container.current) return;
      const { store: s, couriers: c, stops: st } = latest.current;
      const bounds = pointsBounds([...(s ? [s] : []), ...c, ...st]);
      let map: MapboxMap;
      try {
        map = new mapboxgl.Map({
          container: container.current, accessToken: token, style: "mapbox://styles/mapbox/streets-v12",
          ...(bounds ? { bounds, fitBoundsOptions: FIT } : { center: [-46.633, -23.55], zoom: 11 }),
          cooperativeGestures: true, dragRotate: false, pitchWithRotate: false, touchPitch: false,
          performanceMetricsCollection: false, locale: MAP_LOCALE,
        });
      } catch { setFailed(true); return; }
      map.touchZoomRotate.disableRotation();
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
      let loaded = false;
      map.on("load", () => { loaded = true; });
      map.on("error", () => { if (!loaded) setFailed(true); });
      live.current = {
        map, markers: [],
        // The courier is anchored at the center of its dot (bottom edge, 7 px up); the rest at their center.
        make: (kind, p, label) => new mapboxgl.Marker(kind === "courier"
          ? { element: element(kind, label), anchor: "bottom", offset: [0, 7] }
          : { element: element(kind, label) }).setLngLat([p.longitude, p.latitude]).addTo(map),
      };
      drawMarkers(live.current, latest.current);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      live.current?.map.remove();
      live.current = null;
    };
  }, [token]);

  // Markers follow the board (every 5 s).
  useEffect(() => {
    latest.current = { store, couriers, stops };
    drawMarkers(live.current, latest.current);
  }, [store, couriers, stops]);

  const described = couriers.length
    ? `Mapa com a loja e ${couriers.length === 1 ? "1 motoboy" : `${couriers.length} motoboys`} na rua`
    : "Mapa com a loja e as próximas entregas";
  return <figure className="ops-routes-map">
    {failed
      ? <p className="ops-routes-map-off">Mapa indisponível no momento.</p>
      : <div ref={container} className="ops-routes-map-canvas" role="region" aria-label={described} />}
    <figcaption>
      {couriers.length ? "Motoboys pelo GPS dos últimos 15 minutos · " : "Sem posição recente dos motoboys · "}
      <span className="ops-map-key ops-map-key-courier">R-1</span> motoboy e sua rota
      <span className="ops-map-key ops-map-key-stop">#</span> próxima entrega
    </figcaption>
  </figure>;
}
