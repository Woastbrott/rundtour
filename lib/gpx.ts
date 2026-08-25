import type { RouteCandidate } from "@/lib/ors/schema";

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;",
  );
}

function today(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function gpxFilename(candidate: RouteCandidate): string {
  return `rundtour-${Math.round(candidate.distance / 1000)}km-${today()}.gpx`;
}

/** GPX 1.1 von Hand — eine Library wäre für 15 Zeilen Markup Overhead. */
export function buildGpx(candidate: RouteCandidate, name: string): string {
  const points = candidate.coordinates
    .map(
      ([lon, lat, ele]) =>
        `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${ele.toFixed(1)}</ele></trkpt>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Rundtour-Generator" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(name)}</name>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}

export function downloadGpx(candidate: RouteCandidate, name: string): void {
  const blob = new Blob([buildGpx(candidate, name)], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = gpxFilename(candidate);
  document.body.appendChild(a);
  a.click();
  a.remove();
  /*
   * Nicht sofort freigeben: Safari (auch auf dem iPhone) liest den Blob erst
   * nach dem aktuellen Task aus. Ein synchrones revoke bricht den Download dort
   * ab — die Datei kommt einfach nie an.
   */
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
