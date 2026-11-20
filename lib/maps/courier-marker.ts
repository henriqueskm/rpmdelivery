/**
 * The courier on the map: a solid silhouette of a rider on a motorcycle with the delivery box, the same on the store's map and the
 * customer's. The store's map adds a tag above it with the route ("R-1").
 * Plain SVG, no images or fonts to load; decorative (the map region carries the description).
 */
const RIDER = `<svg viewBox="0 0 64 48" width="58" height="44" aria-hidden="true" focusable="false">
  <g fill="#1d2c24">
    <circle cx="13" cy="38" r="7.6"/>
    <circle cx="51" cy="38" r="7.6"/>
    <path d="M6 33 Q7 27 13 27 H23 L26 30.5 H39 L44 24.5 H47.5 L50.5 31.5 Q54 30 57.5 32.5 L58 35.5 Q53 32.5 48.5 35.5 L44.5 37 H22 Q20.5 32.5 14 32.5 Q9.5 32.5 7.5 35.5 Z"/>
    <path d="M44.5 24.5 L47.5 19.5 L50 20 L47.5 25 Z"/>
    <path d="M26.5 29 Q25 19.5 30 14.5 Q32.5 12.5 36 13 Q39 13.8 40.6 16.6 L45.5 21.6 L43.6 23.4 L38.2 19.6 L36 28.5 Z"/>
    <path d="M26.5 28 H37.6 L41.6 34.2 L37.9 35.6 L35.2 31.4 H27.6 Z"/>
    <circle cx="34.2" cy="7.6" r="6.2"/>
  </g>
  <circle cx="13" cy="38" r="2.6" fill="#ecf1e7"/>
  <circle cx="51" cy="38" r="2.6" fill="#ecf1e7"/>
  <path d="M35.4 5.6 Q39.8 5.4 40.4 9 H35.4 Z" fill="#ecf1e7"/>
  <rect x="3" y="14" width="16" height="13" rx="2.4" fill="#fb673b" stroke="#1d2c24" stroke-width="2"/>
</svg>`;

/** A marker element: the rider, with an optional tag above (store map: the route reference). */
export function courierMarkerElement(label?: string) {
  const node = document.createElement("div");
  node.className = "courier-marker";
  node.setAttribute("aria-hidden", "true");
  if (label) {
    const tag = document.createElement("span");
    tag.className = "courier-marker-tag";
    tag.textContent = label;
    node.appendChild(tag);
  }
  const body = document.createElement("span");
  body.className = "courier-marker-rider";
  body.innerHTML = RIDER;
  node.appendChild(body);
  return node;
}
