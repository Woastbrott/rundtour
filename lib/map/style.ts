/**
 * Basemap-Styles: CARTO Vector-Tiles, kostenlos und ohne Token.
 * Bewusst zurückhaltend gefärbt — die Route soll die einzige kräftige Farbe im Bild sein.
 * Austauschbar: hier eine andere Style-URL eintragen, sonst ändert sich nichts.
 */
export const MAP_STYLE = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
} as const;

/** Radolfzell am Bodensee — Startblick, bis der Nutzer etwas anderes wählt. */
export const DEFAULT_VIEW = { lon: 8.9714, lat: 47.7386, zoom: 11.5 } as const;

export const MAP_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://carto.com/attributions">CARTO</a> · Routing: <a href="https://openrouteservice.org/">openrouteservice</a>';
