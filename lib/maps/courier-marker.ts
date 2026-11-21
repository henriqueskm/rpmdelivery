/**
 * The courier on the map: the rider on a motorcycle with the orange box (public/courier/rider-96.webp),
 * the same on the store's map and the customer's. Small on purpose, so the map still shows where it is.
 * - The store's map adds a tag above it with the route ("R-1").
 * - `point: true` adds a dot under the wheels at the exact position (the marker is anchored there).
 * Decorative: the map region carries the description.
 */
export function courierMarkerElement(label?: string, { point = false }: { point?: boolean } = {}) {
  const node = document.createElement("div");
  node.className = point ? "courier-marker has-point" : "courier-marker";
  node.setAttribute("aria-hidden", "true");
  if (label) {
    const tag = document.createElement("span");
    tag.className = "courier-marker-tag";
    tag.textContent = label;
    node.appendChild(tag);
  }
  const rider = document.createElement("img");
  rider.className = "courier-marker-rider";
  rider.src = "/courier/rider-96.webp";
  rider.alt = "";
  rider.width = 40;
  rider.height = 41;
  rider.decoding = "async";
  rider.draggable = false;
  node.appendChild(rider);
  if (point) {
    const dot = document.createElement("span");
    dot.className = "courier-marker-point";
    node.appendChild(dot);
  }
  return node;
}
