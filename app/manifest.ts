import type { MetadataRoute } from "next";

/** Phase 5: PWA — утасны нүүр дэлгэцэнд суулгаж, апп шиг нээгдэнэ. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Хуягтан", short_name: "Хуягтан", description: "Хуягтан өргөөний бүртгэл, онгодын mind map, үйл ажиллагаа, сургалт",
    start_url: "/", scope: "/", display: "standalone", orientation: "any", lang: "mn",
    background_color: "#F4F6F9", theme_color: "#1E4FA0",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Календарь", url: "/calendar" }, { name: "Миний хуваарь", url: "/me#schedule" }, { name: "Mind map", url: "/map" },
    ],
  };
}
