"use client";
import { useRouter } from "next/navigation";

/** Хэл сэлгэх (mn / en). Сонголт `lang` cookie-д 1 жил хадгалагдана. */
export function LangSwitch({ lang, compact }: { lang: string; compact?: boolean }) {
  const router = useRouter();
  const set = (l: string) => {
    document.cookie = `lang=${l}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  return (
    <span className="row small" style={{ gap: 4, justifyContent: compact ? "flex-start" : "center" }} role="group" aria-label="Хэл / Language">
      {[["mn", "MN"], ["en", "EN"]].map(([c, n]) => (
        <button key={c} type="button" onClick={() => set(c)} aria-pressed={lang === c} className={`btn sm ${lang === c ? "pri" : "ghost"}`} style={{ height: 28, padding: "0 8px" }} lang={c}>{n}</button>
      ))}
    </span>
  );
}
