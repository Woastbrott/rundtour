/**
 * BRouter läuft auf einem Community-Server ohne Zusage und ohne Bezahlung.
 * Alles hier drin ist darauf ausgelegt, ihn nicht zu belasten.
 */

export const BROUTER_BASE = "https://brouter.de";

/** Eigener User-Agent, damit der Traffic zuordenbar ist. */
export const BROUTER_USER_AGENT =
  "RundtourGenerator/1.0 (+https://github.com/Woastbrott/rundtour)";

/**
 * Pause zwischen zwei Kandidaten. Kandidaten laufen sequenziell, nicht parallel.
 * Median einer Anfrage lag bei ~430 ms, gemessen über Radolfzell.
 */
export const BROUTER_REQUEST_GAP_MS = 900;

/**
 * Zeitlimit pro Anfrage. Der öffentliche Server bricht schwere Suchen selbst mit
 * "operation killed by thread-priority-watchdog" ab, einzelne Runden brauchten
 * aber auch schon ~17 s und kamen durch. Wir warten nicht beliebig lange.
 */
export const BROUTER_TIMEOUT_MS = 20_000;
