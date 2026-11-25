import Link from "next/link";
import { getT } from "@/lib/i18n";
import { LangSwitch } from "./LangSwitch";
import { Icon } from "./ui";

/** Нэвтрэлтийн болон нийтийн жижиг хуудасны хүрээ. Доод хэсэгт хэл сэлгэгч (D13). */
export async function AuthFrame({ title, sub, children, wide }: { title: string; sub?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  const t = await getT();
  return (
    <div className="authwrap">
      <div className="authcard" style={wide ? { width: "min(560px,100%)" } : undefined}>
        <div className="brand" style={{ padding: 0 }}>
          <span className="logo" style={{ color: "#fff" }}><Icon n="map" s={18} /></span>{t("Хуягтан")}
          {process.env.APP_ENV === "staging" ? <span className="chip warn" style={{ marginLeft: 8 }}>{t("туршилтын орчин")}</span> : null}
        </div>
        <div className="card col g16">
          <div className="col g4">
            <h1>{title}</h1>
            {sub ? <span className="small muted">{sub}</span> : null}
          </div>
          {children}
        </div>
        <PubFooter lang={t.lang} privacy={t("Нууцлалын бодлого")} />
      </div>
    </div>
  );
}

/** Нийтийн хуудасны доод мөр: нууцлалын бодлого + хэл сэлгэгч. */
export function PubFooter({ lang, privacy }: { lang: string; privacy: string }) {
  return (
    <div className="col" style={{ alignItems: "center", gap: 8 }}>
      <LangSwitch lang={lang} />
      <span className="tiny muted" style={{ textAlign: "center" }}><Link href="/privacy">{privacy}</Link></span>
    </div>
  );
}
