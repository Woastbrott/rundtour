import { buildGpx, downloadGpx, gpxFilename } from "./gpx";
import type { RouteCandidate } from "./ors/schema";

/**
 * Export nach komoot.
 *
 * Es gibt keinen direkten Weg. komoot hat keine offene API — der offizielle
 * OAuth-Beispielcode verweist auf "apply for them here: komoot.de/b2b/connect",
 * also einen B2B-Partnervertrag. Ohne den ist ein Server-zu-Server-Upload
 * schlicht nicht möglich, egal wie man es dreht.
 *
 * Was geht, sind zwei Wege über die GPX-Datei:
 *
 *  - **Handy:** Web Share API mit der Datei. Das öffnet den System-Dialog, in
 *    dem komoot als Ziel auftaucht (auf iOS der dokumentierte Weg: Datei
 *    teilen -> komoot wählen). Ein Tipp, näher kommt man ohne Partnerzugang nicht.
 *  - **Desktop:** GPX herunterladen und komoots Import-Seite öffnen. Dort dann
 *    "GPS-Datei importieren".
 *
 * Welcher Weg genommen wurde, gibt die Funktion zurück, damit das UI die
 * passende Anweisung anzeigen kann statt einer allgemeinen.
 */

export const KOMOOT_IMPORT_URL = "https://www.komoot.com/upload";

export type KomootExport = "shared" | "downloaded" | "cancelled";

function canShareFile(file: File): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  );
}

export async function exportToKomoot(
  candidate: RouteCandidate,
  name: string,
): Promise<KomootExport> {
  const file = new File([buildGpx(candidate, name)], gpxFilename(candidate), {
    type: "application/gpx+xml",
  });

  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: name });
      return "shared";
    } catch (cause) {
      // Abbruch im Teilen-Dialog ist kein Fehler — dann passiert einfach nichts.
      if (cause instanceof DOMException && cause.name === "AbortError") return "cancelled";
      // Alles andere: auf den Download-Weg zurückfallen statt den Nutzer stehen zu lassen.
      console.warn("[komoot] Teilen fehlgeschlagen, nutze Download", cause);
    }
  }

  downloadGpx(candidate, name);
  window.open(KOMOOT_IMPORT_URL, "_blank", "noopener,noreferrer");
  return "downloaded";
}
