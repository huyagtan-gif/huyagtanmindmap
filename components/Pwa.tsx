"use client";
import { useEffect, useState } from "react";

/** Service worker-ийг бүртгэнэ (PWA, push). */
export function SwRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}

const b64 = (s: string) => {
  const p = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
};

/** «Миний мэдээлэл» дээрх push мэдэгдэл асаах / унтраах товч. */
export function PushToggle({ vapidKey }: { vapidKey: string }) {
  const [st, setSt] = useState<"loading" | "unsupported" | "denied" | "on" | "off" | "busy">("loading");
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setSt("unsupported");
    if (Notification.permission === "denied") return setSt("denied");
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setSt(s ? "on" : "off")).catch(() => setSt("unsupported"));
  }, []);
  const send = (method: "POST" | "DELETE", endpoint: string) =>
    fetch("/api/push/subscribe", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint }) });
  const on = async () => {
    setSt("busy");
    try {
      if ((await Notification.requestPermission()) !== "granted") return setSt("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(vapidKey) }));
      setSt((await send("POST", sub.endpoint)).ok ? "on" : "off");
    } catch {
      setSt("off");
    }
  };
  const off = async () => {
    setSt("busy");
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) {
      await send("DELETE", sub.endpoint).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
    setSt("off");
  };
  if (st === "loading") return null;
  if (st === "unsupported") return <span className="small muted">Энэ хөтөч push мэдэгдэл дэмжихгүй. iPhone дээр эхлээд «Нүүр дэлгэцэнд нэмэх»-ээр суулгана уу.</span>;
  if (st === "denied") return <span className="small muted">Мэдэгдэл хаагдсан байна. Хөтчийн тохиргооноос энэ сайтад мэдэгдэл зөвшөөрнө үү.</span>;
  return st === "on"
    ? <div className="row wrap"><span className="chip ok">Энэ төхөөрөмж дээр асаалттай</span><button className="btn sm" onClick={off}>Унтраах</button></div>
    : <button className="btn sm pri" onClick={on} disabled={st === "busy"}>Энэ төхөөрөмж дээр мэдэгдэл асаах</button>;
}
