"use client";
import { useEffect, useRef } from "react";

declare global {
  interface Window { turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; remove: (id: string) => void } }
}
const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Cloudflare Turnstile. Формд `cf-turnstile-response` талбар нэмнэ; сервер талд lib/captcha.ts шалгана. */
export function Captcha({ siteKey }: { siteKey: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!siteKey || !ref.current) return;
    const el = ref.current;
    let id: string | undefined;
    let gone = false;
    const render = () => {
      if (!gone && window.turnstile && !id) id = window.turnstile.render(el, { sitekey: siteKey, language: "mn" });
    };
    if (window.turnstile) render();
    else {
      let s = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
      if (!s) {
        s = document.createElement("script");
        s.src = SRC;
        s.async = true;
        document.head.appendChild(s);
      }
      s.addEventListener("load", render);
    }
    return () => {
      gone = true;
      if (id) window.turnstile?.remove(id);
    };
  }, [siteKey]);
  return siteKey ? <div ref={ref} style={{ minHeight: 65 }} /> : null;
}
