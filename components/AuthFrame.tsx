import Link from "next/link";
import { Icon } from "./ui";

export function AuthFrame({ title, sub, children, wide }: { title: string; sub?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="authwrap">
      <div className="authcard" style={wide ? { width: "min(560px,100%)" } : undefined}>
        <div className="brand" style={{ padding: 0 }}>
          <span className="logo" style={{ color: "#fff" }}><Icon n="map" s={18} /></span>Хуягтан
          {process.env.APP_ENV === "staging" ? <span className="chip warn" style={{ marginLeft: 8 }}>туршилтын орчин</span> : null}
        </div>
        <div className="card col g16">
          <div className="col g4">
            <h1>{title}</h1>
            {sub ? <span className="small muted">{sub}</span> : null}
          </div>
          {children}
        </div>
        <span className="tiny muted" style={{ textAlign: "center" }}>
          <Link href="/privacy">Нууцлалын бодлого</Link>
        </span>
      </div>
    </div>
  );
}
