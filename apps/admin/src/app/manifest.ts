import type { MetadataRoute } from "next";

/** Installable owner app (PLAN §20): opens on the inbox, full screen, with the brand icons. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/inbox",
    name: "Traiblazer",
    short_name: "Traiblazer",
    description: "Your requests, notes and alerts from your AI assistant.",
    start_url: "/inbox?source=app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f3f5fb",
    theme_color: "#3b5bdb",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
