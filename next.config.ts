import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    /*
     * Ohne diese Zeile sucht Turbopack sich die Projektwurzel selbst und landet im
     * Home-Verzeichnis, weil dort ein package.json liegt. Hier festnageln.
     */
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
