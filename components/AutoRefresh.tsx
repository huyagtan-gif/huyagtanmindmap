"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** Хуудсыг тогтмол хугацаанд шинэчилнэ (QR токен эргэх, ирцийн тоо). */
export function AutoRefresh({ ms = 20_000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, ms);
    return () => clearInterval(t);
  }, [router, ms]);
  return null;
}

/** Хуудас ачаалмагц формыг нэг удаа илгээнэ (QR уншуулсан гишүүний ирц шууд бүртгэгдэнэ). */
export function AutoSubmitOnce({ formId }: { formId: string }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit();
  }, [formId]);
  return null;
}
