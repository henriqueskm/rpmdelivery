"use client";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Map as MapboxMap, Marker } from "mapbox-gl";
import { useEffect, useRef, useState } from "react";
import { REFRAME_AFTER_MS, glideMs, pointAlong, pointsBounds, publicMapToken } from "@/lib/tracking/motion";
import { clockTime, refreshSeconds, type Tracking, type TrackingPoint } from "@/lib/tracking/view";

type Points = Pick<Tracking, "courier" | "destination">;

type Live = {
  map: MapboxMap;
  courier: Marker;
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
const FIT = { padding: 60, maxZoom: 16 };

function lngLat(point: TrackingPoint): [number, number] {
  return [point.longitude, point.latitude];
}

function markerElement(kind: "courier" | "destination") {
  const element = document.createElement("div");
  element.className = `tracking-marker tracking-marker-${kind}`;
  element.setAttribute("aria-hidden", "true");
  element.innerHTML = kind === "courier"
    // Scooter
    ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M8.5 17h7M15 6h2l2.5 8.5M11 12h4.5"/></svg>'
    // House
    : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 12 4l8 7M6.5 9.5V20h11V9.5"/></svg>';
  return element;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Moves the markers to the latest reading, gliding the courier, and keeps both in view. */
function sync(live: Live, { courier, destination }: Points) {
  const { map } = live;
  if (destination) live.destination.setLngLat(lngLat(destination)).addTo(map);
  else live.destination.remove();

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

  if (!live.userMoved) reframe(live, { courier, destination }, true);
}

/** Fits the courier and the customer's address; `onlyIfHidden` skips it while both are on screen. */
function reframe({ map }: Live, { courier, destination }: Points, onlyIfHidden: boolean) {
  const points = [courier, destination].filter((point): point is NonNullable<typeof point> => Boolean(point));
  const visible = map.getBounds();
  if (onlyIfHidden && visible && points.every(point => visible.contains(lngLat(point)))) return;
  const bounds = pointsBounds(points);
  if (bounds) map.fitBounds(bounds, { ...FIT, duration: prefersReducedMotion() ? 0 : 800 });
}

export function TrackingMap({ courier, destination }: Points) {
  const token = publicMapToken(process.env.NEXT_PUBLIC_MAPBOX_MAP_TOKEN);
  const container = useRef<HTMLDivElement>(null);
  const live = useRef<Live | null>(null);
  const latest = useRef<Points>({ courier, destination });
  const [failed, setFailed] = useState(!token);
  const alt = courier && destination ? "Mapa com o entregador e o seu endereço"
    : courier ? "Mapa com a posição do entregador" : "Mapa com o seu endereço";

  // One map per page view: Mapbox bills each new map, not each marker move.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    let created: Live | null = null;
    import("mapbox-gl").then(({ default: mapboxgl }) => {
      if (cancelled || !container.current) return;
      const points = [latest.current.courier, latest.current.destination].filter(Boolean) as TrackingPoint[];
      const bounds = pointsBounds(points);
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
        });
      } catch {
        setFailed(true); // No WebGL on this device.
        return;
      }
      map.touchZoomRotate.disableRotation();
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
      let loaded = false;
      map.on("load", () => { loaded = true; });
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
        courier: new mapboxgl.Marker({ element: markerElement("courier") }),
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
    latest.current = { courier, destination };
    if (live.current) sync(live.current, latest.current);
  }, [courier, destination]);

  const time = clockTime(courier?.recordedAt ?? null);
  return (
    <figure className="tracking-map">
      {failed
        ? <p className="map-unavailable">Mapa indisponível no momento.</p>
        : <div ref={container} className="tracking-map-canvas" role="region" aria-label={alt} />}
      <figcaption>
        {courier && time
          ? <><span className="tracking-live" aria-hidden="true" />Posição do entregador às {time}</>
          : "Aguardando a posição do entregador."}
      </figcaption>
    </figure>
  );
}
