"use client";
import { useEffect } from "react";

const seen = new Set<string>();

/** Хөтчийн алдааг сервер рүү мэдээлнэ (хуудас бүрт хамгийн ихдээ 5, ижлийг нэг удаа). */
export function reportClientError(err: unknown) {
  try {
    const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : "Unknown error");
    const key = `${e.message}\n${(e.stack || "").split("\n")[1] || ""}`;
    if (seen.has(key) || seen.size >= 5) return;
    seen.add(key);
    void fetch("/api/errors", {
      method: "POST", keepalive: true, headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: e.message.slice(0, 500), stack: (e.stack || "").slice(0, 4000), path: location.pathname }),
    }).catch(() => {});
  } catch {
    /* хяналт өөрөө алдаа гаргах ёсгүй */
  }
}

export function ErrorReporter() {
  useEffect(() => {
    const onErr = (ev: ErrorEvent) => reportClientError(ev.error || ev.message);
    const onRej = (ev: PromiseRejectionEvent) => reportClientError(ev.reason);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);
  return null;
}
