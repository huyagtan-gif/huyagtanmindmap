"use client";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";

const LiveCtx = createContext(false);
export const useLive = () => useContext(LiveCtx);

/**
 * P2.1: серверээс дохио ирэхэд нээлттэй хуудсыг дахин татна (router.refresh → эрхээр шүүсэн өгөгдөл).
 * Дохионд өгөгдөл байхгүй (A3). Хэрэглэгч формд бичиж байх үед болон таб далд үед хойшлуулна.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let stale = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const typing = () => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !!a.closest("form");
    };
    const run = () => {
      timer = null;
      if (document.hidden || typing()) {
        stale = true;
        return;
      }
      stale = false;
      router.refresh();
    };
    const kick = () => {
      if (!timer) timer = setTimeout(run, 400);
    };
    const later = () => {
      if (stale) kick();
    };
    const es = new EventSource("/api/events");
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = kick;
    document.addEventListener("visibilitychange", later);
    document.addEventListener("focusout", later);
    return () => {
      es.close();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", later);
      document.removeEventListener("focusout", later);
    };
  }, [router]);
  return <LiveCtx.Provider value={live}>{children}</LiveCtx.Provider>;
}

export function LiveBadge() {
  const live = useLive();
  return live ? <span className="live"><span className="dot" />Шууд шинэчлэгдэж байна</span> : null;
}
