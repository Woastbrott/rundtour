"use client";

import maplibregl, { type LngLatBoundsLike, type Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";

import type { LatLon, Position3, RouteCandidate } from "@/lib/ors/schema";
import { DEFAULT_VIEW, MAP_ATTRIBUTION, MAP_STYLE } from "@/lib/map/style";

const SRC_ROUTE = "route";
const LAYER_HALO = "route-halo";
const LAYER_LINE = "route-line";
const LAYER_ARROWS = "route-arrows";
const IMG_ARROW = "dir-arrow";

const ROUTE_COLOR = "#FF375F";
const ROUTE_CLEAR = "rgba(255,55,95,0)";

export type MapPadding = { top: number; right: number; bottom: number; left: number };

type Props = {
  start: LatLon | null;
  onStartChange: (point: LatLon) => void;
  route: RouteCandidate | null;
  hoverPoint: Position3 | null;
  padding: MapPadding;
};

const signature = (p: MapPadding) => `${p.top}|${p.right}|${p.bottom}|${p.left}`;

function emptyLine(): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } };
}

/**
 * Weißes Dreieck als Fahrtrichtungspfeil. Als Bild statt als Text-Glyphe, damit
 * wir nicht davon abhängen, welche Zeichen der Basemap-Style ausliefert.
 */
function arrowImage(): ImageData | null {
  const size = 18;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(size * 0.74, size * 0.5);
  ctx.lineTo(size * 0.3, size * 0.24);
  ctx.lineTo(size * 0.41, size * 0.5);
  ctx.lineTo(size * 0.3, size * 0.76);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

function startMarkerElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "start-marker";
  el.innerHTML = '<span class="start-marker__ring"></span><span class="start-marker__dot"></span>';
  return el;
}

function hoverMarkerElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "hover-marker";
  return el;
}

export function RouteMap({ start, onStartChange, route, hoverPoint, padding }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const startMarker = useRef<maplibregl.Marker | null>(null);
  const hoverMarker = useRef<maplibregl.Marker | null>(null);
  const drawFrame = useRef(0);
  const appliedPadding = useRef<string | null>(null);

  // Callback und Padding über Refs, damit die Karte nicht bei jedem Render neu gebaut wird.
  // Zuweisung im Effekt, nicht im Render — und als erster Effekt, damit die
  // nachfolgenden Effekte im selben Commit schon die aktuellen Werte sehen.
  const onStartRef = useRef(onStartChange);
  const paddingRef = useRef(padding);
  useEffect(() => {
    onStartRef.current = onStartChange;
    paddingRef.current = padding;
  });

  /* --- Karte einmalig aufbauen ------------------------------------- */
  useEffect(() => {
    if (!container.current || map.current) return;

    const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const instance = new maplibregl.Map({
      container: container.current,
      style: darkQuery.matches ? MAP_STYLE.dark : MAP_STYLE.light,
      center: [DEFAULT_VIEW.lon, DEFAULT_VIEW.lat],
      zoom: DEFAULT_VIEW.zoom,
      attributionControl: false,
      // Eine Rundtour hat kein Oben-Unten-Problem; die Rotationsgeste stört auf dem Handy nur.
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.current = instance;

    instance.addControl(
      new maplibregl.AttributionControl({ compact: true, customAttribution: MAP_ATTRIBUTION }),
      "bottom-right",
    );
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    instance.touchZoomRotate.disableRotation();

    const install = () => {
      if (!instance.getSource(SRC_ROUTE)) {
        instance.addSource(SRC_ROUTE, {
          type: "geojson",
          // lineMetrics ist Voraussetzung für line-gradient — und damit für das Einzeichnen.
          lineMetrics: true,
          data: emptyLine(),
        });
      }
      if (!instance.hasImage(IMG_ARROW)) {
        const img = arrowImage();
        if (img) instance.addImage(IMG_ARROW, img);
      }
      if (!instance.getLayer(LAYER_HALO)) {
        instance.addLayer({
          id: LAYER_HALO,
          type: "line",
          source: SRC_ROUTE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ROUTE_COLOR,
            "line-opacity": 0.2,
            "line-width": ["interpolate", ["linear"], ["zoom"], 8, 9, 14, 18],
            "line-blur": 6,
          },
        });
      }
      if (!instance.getLayer(LAYER_LINE)) {
        instance.addLayer({
          id: LAYER_LINE,
          type: "line",
          source: SRC_ROUTE,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ROUTE_COLOR,
            "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2.5, 14, 5],
          },
        });
      }
      if (!instance.getLayer(LAYER_ARROWS)) {
        instance.addLayer({
          id: LAYER_ARROWS,
          type: "symbol",
          source: SRC_ROUTE,
          layout: {
            "symbol-placement": "line",
            "symbol-spacing": 110,
            "icon-image": IMG_ARROW,
            "icon-size": 0.72,
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
          paint: { "icon-opacity": 0.95 },
        });
      }
    };

    instance.on("load", install);
    // Nach einem Style-Wechsel (Dark Mode) sind alle eigenen Layer weg — neu setzen.
    instance.on("styledata", install);
    instance.on("click", (e) => {
      onStartRef.current({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });

    const onScheme = (e: MediaQueryListEvent) => {
      instance.setStyle(e.matches ? MAP_STYLE.dark : MAP_STYLE.light, { diff: false });
    };
    darkQuery.addEventListener("change", onScheme);

    return () => {
      darkQuery.removeEventListener("change", onScheme);
      cancelAnimationFrame(drawFrame.current);
      startMarker.current?.remove();
      hoverMarker.current?.remove();
      instance.remove();
      map.current = null;
    };
  }, []);

  /* --- Startmarker -------------------------------------------------- */
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    if (!start) {
      startMarker.current?.remove();
      startMarker.current = null;
      return;
    }
    if (startMarker.current) {
      startMarker.current.setLngLat([start.lon, start.lat]);
    } else {
      startMarker.current = new maplibregl.Marker({ element: startMarkerElement() })
        .setLngLat([start.lon, start.lat])
        .addTo(instance);
    }
  }, [start]);

  /* --- Route einzeichnen + Kamera ----------------------------------- */
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    cancelAnimationFrame(drawFrame.current);

    const source = instance.getSource(SRC_ROUTE) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    if (!route) {
      source.setData(emptyLine());
      return;
    }

    source.setData({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: route.coordinates },
    });

    const bounds: LngLatBoundsLike = [
      [route.bbox[0], route.bbox[1]],
      [route.bbox[2], route.bbox[3]],
    ];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    instance.fitBounds(bounds, {
      padding: paddingRef.current,
      duration: reduced ? 0 : 900,
      easing: (t) => 1 - Math.pow(1 - t, 3),
      maxZoom: 15,
    });
    // Merken, mit welchem Padding gerade gefittet wurde, damit der Padding-Effekt
    // nicht im selben Commit ein zweites Mal fittet und die Kamerafahrt abschneidet.
    appliedPadding.current = signature(paddingRef.current);

    const clearGradient = () => {
      if (!instance.getLayer(LAYER_LINE)) return;
      instance.setPaintProperty(LAYER_LINE, "line-gradient", undefined);
      instance.setPaintProperty(LAYER_HALO, "line-gradient", undefined);
      instance.setLayoutProperty(LAYER_ARROWS, "visibility", "visible");
    };

    if (reduced) {
      clearGradient();
      return;
    }

    const setProgress = (t: number) => {
      if (!instance.getLayer(LAYER_LINE)) return;
      const head = Math.min(Math.max(t, 0.0001), 0.9985);
      const gradient: maplibregl.ExpressionSpecification = [
        "interpolate",
        ["linear"],
        ["line-progress"],
        0,
        ROUTE_COLOR,
        head,
        ROUTE_COLOR,
        head + 0.001,
        ROUTE_CLEAR,
      ];
      instance.setPaintProperty(LAYER_LINE, "line-gradient", gradient);
      instance.setPaintProperty(LAYER_HALO, "line-gradient", gradient);
      instance.setLayoutProperty(LAYER_ARROWS, "visibility", "none");
    };

    // Die Route zeichnet sich einmal von Start nach Ziel.
    const started = performance.now();
    const duration = 850;
    const tick = (now: number) => {
      const raw = Math.min((now - started) / duration, 1);
      if (raw >= 1) {
        clearGradient();
        return;
      }
      setProgress(1 - Math.pow(1 - raw, 3));
      drawFrame.current = requestAnimationFrame(tick);
    };
    setProgress(0);
    drawFrame.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(drawFrame.current);
  }, [route]);

  /* --- Hover-Marker aus dem Höhenprofil ----------------------------- */
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    if (!hoverPoint) {
      hoverMarker.current?.remove();
      hoverMarker.current = null;
      return;
    }
    if (hoverMarker.current) {
      hoverMarker.current.setLngLat([hoverPoint[0], hoverPoint[1]]);
    } else {
      hoverMarker.current = new maplibregl.Marker({ element: hoverMarkerElement() })
        .setLngLat([hoverPoint[0], hoverPoint[1]])
        .addTo(instance);
    }
  }, [hoverPoint]);

  /* --- Kamera nachziehen, wenn sich das Layout ändert (Sheet auf/zu) - */
  useEffect(() => {
    const instance = map.current;
    if (!instance || !route) return;
    const next = signature(padding);
    if (appliedPadding.current === next) return;

    const id = window.setTimeout(() => {
      appliedPadding.current = next;
      instance.fitBounds(
        [
          [route.bbox[0], route.bbox[1]],
          [route.bbox[2], route.bbox[3]],
        ],
        { padding, duration: 400, maxZoom: 15 },
      );
    }, 60);
    return () => window.clearTimeout(id);
    // Absichtlich nur auf die Padding-Werte reagieren, nicht auf die Route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padding.top, padding.right, padding.bottom, padding.left]);

  /*
   * h-full statt absolute+inset-0: MapLibre hängt dem Container die Klasse
   * .maplibregl-map an, und deren CSS setzt `position: relative`. Das überschreibt
   * ein `absolute` aus den Utilities, damit greift inset-0 nicht mehr und der
   * Container fällt auf Höhe 0 zusammen — Karte unsichtbar, Seite schwarz.
   * Eine feste Höhe ist unabhängig davon, welche `position` gewinnt.
   */
  return <div ref={container} className="h-full w-full" aria-label="Karte" />;
}
