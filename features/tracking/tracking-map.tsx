"use client";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Map as MapboxMap, Marker } from "mapbox-gl";
import { useEffect, useRef, useState } from "react";
import { REFRAME_AFTER_MS, glideMs, pointAlong, pointsBounds, publicMapToken } from "@/lib/tracking/motion";
import { clockTime, distanceText, refreshSeconds, type CourierArea, type Tracking, type TrackingPoint } from "@/lib/tracking/view";
import { courierMarkerElement } from "@/lib/maps/courier-marker";

type Points = Pick<Tracking, "courier" | "courierArea" | "destination">;

type Live = {
  map: MapboxMap;
  courier: Marker;
  /** Before the turn: the rider in the middle of the area, without the exact-position dot. */
  areaRider: Marker;
  destination: Marker;
  /** Where the courier marker is drawn right now (mid-glide included). */
  shown: TrackingPoint | null;
  frame: number;
  /** The customer is panning or zooming: don't reframe under their finger. */
  userMoved: boolean;
  /** Brings the courier back into view a moment after the customer lets go. */
  reframeTimer: number;
};

const GLIDE_MS = (refreshSeconds("NEXT") ?? 15) * 1000;
// The zoom buttons sit top-right; the extra right padding keeps the courier clear of them.
const FIT = { padding: { top: 60, bottom: 60, left: 60, right: 84 }, maxZoom: 16 };

// The page is in Portuguese; Mapbox's own controls and gesture hints default to English.
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

function lngLat(point: TrackingPoint): [number, number] {
  return [point.longitude, point.latitude];
}

const AREA_SOURCE = "courier-area";

/** The area as a 48-sided polygon: drawn in meters on the ground, so it scales with the zoom. */
function areaShape(area: CourierArea | null) {
  if (!area) return { type: "FeatureCollection" as const, features: [] };
  const dLat = area.radiusMeters / 111_320;
  const dLng = dLat / Math.cos((area.latitude * Math.PI) / 180);
  const ring = Array.from({ length: 49 }, (_, i) => {
    const angle = (i / 48) * 2 * Math.PI;
    return [area.longitude + dLng * Math.cos(angle), area.latitude + dLat * Math.sin(angle)];
  });
  return { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [ring] } };
}

/** Two corners of the box around the area, to frame it with the customer's address. */
function areaCorners(area: CourierArea | null): TrackingPoint[] {
  if (!area) return [];
  const dLat = area.radiusMeters / 111_320;
  const dLng = dLat / Math.cos((area.latitude * Math.PI) / 180);
  return [
    { latitude: area.latitude - dLat, longitude: area.longitude - dLng },
    { latitude: area.latitude + dLat, longitude: area.longitude + dLng },
  ];
}

function drawArea({ map }: Live, area: CourierArea | null) {
  const source = map.getSource(AREA_SOURCE) as { setData(data: unknown): void } | undefined;
  if (source) { source.setData(areaShape(area)); return; }
  if (!map.isStyleLoaded()) return; // The load handler draws it.
  map.addSource(AREA_SOURCE, { type: "geojson", data: areaShape(area) });
  map.addLayer({ id: "courier-area-fill", type: "fill", source: AREA_SOURCE,
    paint: { "fill-color": "#234f8c", "fill-opacity": 0.14 } });
  map.addLayer({ id: "courier-area-line", type: "line", source: AREA_SOURCE,
    paint: { "line-color": "#234f8c", "line-width": 2, "line-dasharray": [2, 2] } });
}

function markerElement(kind: "courier" | "area" | "destination") {
  if (kind === "courier") {
    // The rider standing on a dot at the exact position: the customer's turn.
    const rider = courierMarkerElement(undefined, { point: true });
    rider.classList.add("tracking-marker-courier");
    return rider;
  }
  if (kind === "area") {
    const rider = courierMarkerElement();
    rider.classList.add("tracking-marker-area");
    return rider;
  }
  const element = document.createElement("div");
  element.className = `tracking-marker tracking-marker-${kind}`;
  element.setAttribute("aria-hidden", "true");
  // House
  element.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 12 4l8 7M6.5 9.5V20h11V9.5"/></svg>';
  return element;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Moves the markers to the latest reading, gliding the courier, and keeps both in view. */
function sync(live: Live, { courier, courierArea, destination }: Points) {
  const { map } = live;
  if (destination) live.destination.setLngLat(lngLat(destination)).addTo(map);
  else live.destination.remove();
  drawArea(live, courierArea);
  if (courierArea) live.areaRider.setLngLat(lngLat(courierArea)).addTo(map);
  else live.areaRider.remove();

  cancelAnimationFrame(live.frame);
  if (!courier) {
    live.courier.remove();
    live.shown = null;
  } else {
    const from = live.shown;
    const duration = glideMs(from, courier, GLIDE_MS, prefersReducedMotion());
    if (!from || duration === 0) {
      live.shown = { latitude: courier.latitude, longitude: courier.longitude };
      // A marker needs a position before it joins the map.
      live.courier.setLngLat(lngLat(live.shown)).addTo(map);
    } else {
      const started = performance.now();
      const step = (now: number) => {
        live.shown = pointAlong(from, courier, (now - started) / duration);
        live.courier.setLngLat(lngLat(live.shown));
        if (now - started < duration) live.frame = requestAnimationFrame(step);
      };
      live.frame = requestAnimationFrame(step);
    }
  }

  if (!live.userMoved) reframe(live, { courier, courierArea, destination }, true);
}

function framedPoints({ courier, courierArea, destination }: Points): TrackingPoint[] {
  return [courier, destination, ...areaCorners(courierArea)].filter((point): point is NonNullable<typeof point> => Boolean(point));
}

/** Fits the courier (or its area) and the customer's address; `onlyIfHidden` skips it while all are on screen. */
function reframe({ map }: Live, points: Points, onlyIfHidden: boolean) {
  const framed = framedPoints(points);
  const visible = map.getBounds();
  if (onlyIfHidden && visible && framed.every(point => visible.contains(lngLat(point)))) return;
  const bounds = pointsBounds(framed);
  if (bounds) map.fitBounds(bounds, { ...FIT, duration: prefersReducedMotion() ? 0 : 800 });
}

export function TrackingMap({ courier, courierArea, destination, distanceMeters }: Points & { distanceMeters: number | null }) {
  const token = publicMapToken(process.env.NEXT_PUBLIC_MAPBOX_MAP_TOKEN);
  const container = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);
  const latest = useRef<Points>({ courier, courierArea, destination });
  const [failed, setFailed] = useState(!token);
  const alt = courier && destination ? "Mapa com o entregador e o seu endereço"
    : courier ? "Mapa com a posição do entregador"
    : courierArea ? "Mapa com a região aproximada do entregador" : "Mapa com o seu endereço";

  // One map per page view: Mapbox bills each new map, not each marker move.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let created: Live | null = null;
    import("mapbox-gl").then(({ default: mapboxgl }) => {
      if (cancelled || !container.current) return;
      const bounds = pointsBounds(framedPoints(latest.current));
      let map: MapboxMap;
      try {
        map = new mapboxgl.Map({
          container: container.current,
          accessToken: token,
          style: "mapbox://styles/mapbox/streets-v12",
          ...(bounds ? { bounds, fitBoundsOptions: FIT } : { center: [-46.633, -23.55], zoom: 12 }),
          cooperativeGestures: true,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          performanceMetricsCollection: false,
          locale: MAP_LOCALE,
        });
      } catch {
        setFailed(true); // No WebGL on this device.
        return;
      }
      map.touchZoomRotate.disableRotation();
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
      let loaded = false;
      map.on("load", () => {
        loaded = true;
        // The area is a map layer: it needs the style, unlike the markers.
        if (created) drawArea(created, latest.current.courierArea);
      });
      // After the first load a missing tile is transient; before it, the map never shows.
      map.on("error", () => { if (!loaded) setFailed(true); });
      // Only gestures carry an originalEvent; our own fitBounds does not.
      const byCustomer = (event: object) => "originalEvent" in event && Boolean(event.originalEvent);
      map.on("movestart", event => {
        if (!created || !byCustomer(event)) return;
        created.userMoved = true;
        window.clearTimeout(created.reframeTimer);
      });
      map.on("moveend", event => {
        if (!created || !byCustomer(event)) return;
        const current = created;
        window.clearTimeout(current.reframeTimer);
        current.reframeTimer = window.setTimeout(() => {
          current.userMoved = false;
          reframe(current, latest.current, false);
        }, REFRAME_AFTER_MS);
      });
      created = {
        map,
        // Anchored at the center of the dot under the wheels (its bottom edge, 7 px up).
        courier: new mapboxgl.Marker({ element: markerElement("courier"), anchor: "bottom", offset: [0, 7] }),
        areaRider: new mapboxgl.Marker({ element: markerElement("area") }),
        destination: new mapboxgl.Marker({ element: markerElement("destination") }),
        shown: null,
        frame: 0,
        userMoved: false,
        reframeTimer: 0,
      };
      live.current = created;
      sync(created, latest.current);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (created) {
        cancelAnimationFrame(created.frame);
        window.clearTimeout(created.reframeTimer);
        created.map.remove();
      }
      live.current = null;
    };
  }, [token]);

  useEffect(() => {
    latest.current = { courier, courierArea, destination };
    if (live.current) sync(live.current, latest.current);
  }, [courier, courierArea, destination]);

  const time = clockTime(courier?.recordedAt ?? courierArea?.recordedAt ?? null);
  const distance = distanceText(distanceMeters, !courier);
  return (
    <figure className="tracking-map">
      {failed
        ? <p className="map-unavailable">Mapa indisponível no momento.</p>
        : <div ref={container} className="tracking-map-canvas" role="region" aria-label={alt} />}
      <figcaption>
        {courier && time
          ? <><span className="tracking-live" aria-hidden="true" />Posição do entregador às {time}{distance && ` · ${distance}`}</>
          : courierArea && time
            ? <><span className="tracking-area-key" aria-hidden="true" />
                Região aproximada do entregador às {time}{distance && ` · ${distance}`}. A posição exata aparece quando for a sua vez.</>
            : "Aguardando a posição do entregador."}
      </figcaption>
    </figure>
  );
}
