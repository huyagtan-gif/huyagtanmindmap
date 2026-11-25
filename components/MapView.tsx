"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { changeStatus } from "@/app/actions/person";
import { VIEWS, type ViewKey } from "@/lib/fields";
import { exportMap, type XEdge, type XNode } from "./mapExport";
import { LiveBadge } from "./Realtime";
import { Avatar, Icon, Locked, PAL, Shape, StatusChip, initials, pal } from "./ui";

export type MStatus = { id: string; name: string; pal: number; shape: string; description: string | null };
export type MOngod = { id: string; parent_id: string | null; name: string; kind: "group" | "ongod"; era_id: string | null; needs_review: boolean };
export type MPerson = {
  id: string; name: string; /** false = зөвхөн нэрээр дурдагдсан, бүртгэлгүй хүн */ reg: boolean; clan: string | null; status_id: string | null; ongods: string[]; deedes: string[];
  supporters: string[]; teachers: string[]; introducers: string[]; search: string;
  huyag_on?: string | null; phone?: string | null; email?: string | null; hidden: string[]; since: string | null;
  nStudents: number; nIntroduced: number; nSupported: number;
};
type TNode = { key: string; kind: "root" | "k" | "g" | "o" | "e" | "p"; label: string; pid?: string; children: TNode[];
  w?: number; x?: number; y?: number; depth?: number; coll?: boolean; kids?: TNode[] };

type Props = {
  urguuName: string; statuses: MStatus[]; eras: { id: string; name: string }[]; ongods: MOngod[]; people: MPerson[];
  canStatus: boolean; canEdit: boolean; canExport: boolean; views: ViewKey[]; initialView: ViewKey; meId: string | null; initialEgo: string | null;
  recent: { what: string; who: string; at: string }[];
};

type NetRel = "teacher" | "supporter" | "introducer";
const NET: Record<NetRel, { name: string; none: string }> = {
  teacher: { name: "Багш–шавь", none: "Багш, шавь бүртгэгдээгүй" },
  supporter: { name: "Түшсэн", none: "Түшсэн хүн бүртгэгдээгүй" },
  introducer: { name: "Танилцуулсан", none: "Танилцуулсан хүн бүртгэгдээгүй" },
};
const VIEW_NAME = new Map<string, string>(VIEWS.map((v) => [v.key, v.name]));

let ctx2d: CanvasRenderingContext2D | null = null;
function textW(t: string, px: number, wt: number) {
  ctx2d ||= document.createElement("canvas").getContext("2d");
  if (!ctx2d) return t.length * px * 0.6;
  ctx2d.font = `${wt} ${px}px Inter, system-ui, sans-serif`;
  return ctx2d.measureText(t).width;
}
const EMPTY: Record<string, boolean> = {};
const countP = (n: TNode): number => (n.kind === "p" ? 1 : 0) + n.children.reduce((a, c) => a + countP(c), 0);
const daysSince = (d: string | null) => (d ? Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 864e5)) : 0);

function useIsMobile() {
  const [m, setM] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(max-width:900px)");
    const f = () => setM(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return m;
}

export function MapView(props: Props) {
  const { statuses, eras, ongods, canStatus } = props;
  const router = useRouter();
  const mobile = useIsMobile();
  // Бүртгэлгүй (нэрээр дурдагдсан) хүмүүс зөвхөн сүлжээ ба «нэг хүн төвд» харагдацад гарна.
  const [allPeople, setPeople] = useState(props.people);
  useEffect(() => setPeople(props.people), [props.people]);
  const people = useMemo(() => allPeople.filter((p) => p.reg), [allPeople]);
  const [view, setView] = useState<ViewKey>(props.initialView);
  const [ego, setEgo] = useState<string | null>(props.initialEgo);
  const [netRel, setNetRel] = useState<NetRel>("teacher");
  const [q, setQ] = useState("");
  const [off, setOff] = useState<Set<string>>(new Set());
  const [era, setEra] = useState("");
  const [showEmpty, setShowEmpty] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [collapsedAll, setCollapsedAll] = useState<Record<string, Record<string, boolean>>>({ net: { "net:none": true } });
  const collapsed = collapsedAll[view] || EMPTY;
  const setCollapsed = (f: (c: Record<string, boolean>) => Record<string, boolean>) => setCollapsedAll((all) => ({ ...all, [view]: f(all[view] || EMPTY) }));
  const [toast, setToast] = useState("");
  const [, startT] = useTransition();

  const stBy = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses]);
  const pBy = useMemo(() => new Map(allPeople.map((p) => [p.id, p])), [allPeople]);
  const oBy = useMemo(() => new Map(ongods.map((o) => [o.id, o])), [ongods]);
  const ongodPath = (id: string) => {
    const parts: string[] = [];
    let o = oBy.get(id);
    let g = 0;
    while (o && g++ < 50) { parts.unshift(o.name); o = o.parent_id ? oBy.get(o.parent_id) : undefined; }
    return parts.join(" › ");
  };
  const ql = q.trim().toLowerCase();
  const matchQ = (n: TNode) => !!ql && (n.kind === "p" ? (pBy.get(n.pid!)?.search || "").includes(ql) : n.label.toLowerCase().includes(ql));
  const hasHit = (n: TNode): boolean => matchQ(n) || n.children.some(hasHit);

  const egoId = ego && pBy.get(ego)?.reg ? ego : props.meId && pBy.get(props.meId)?.reg ? props.meId : people[0]?.id ?? null;
  const goEgo = (id: string) => {
    setEgo(id);
    setSel(id);
    setView("ego");
    window.history.replaceState(null, "", `/map?view=ego&ego=${id}`);
  };

  const tree = useMemo<TNode>(() => {
    const pNode = (p: MPerson, pre = ""): TNode => ({ key: pre + "p" + p.id, kind: "p", pid: p.id, label: p.name, children: [] });
    const rootOf = (children: TNode[]): TNode => ({ key: "root", kind: "root", label: props.urguuName, children });
    const byOngod = new Map<string, MPerson[]>();
    for (const p of people) for (const o of p.ongods) (byOngod.get(o) || byOngod.set(o, []).get(o)!).push(p);

    if (view === "era") {
      // Цаг үе → онгод → хүн. Онгодын цаг үе нь өөрийн эсвэл дээд зангилааных.
      const eraOf = (id: string): string | null => {
        let o = oBy.get(id);
        let g = 0;
        while (o && g++ < 50) { if (o.era_id) return o.era_id; o = o.parent_id ? oBy.get(o.parent_id) : undefined; }
        return null;
      };
      const groups = new Map<string, TNode[]>();
      for (const o of ongods) {
        const ps = byOngod.get(o.id);
        if (!ps?.length) continue;
        const e = eraOf(o.id) || "none";
        (groups.get(e) || groups.set(e, []).get(e)!).push({ key: "e" + o.id, kind: "o", label: o.name, children: ps.map((p) => pNode(p, "e" + o.id)) });
      }
      const top: TNode[] = eras.filter((e) => (!era || e.id === era) && groups.get(e.id)?.length).map((e) => ({ key: "era:" + e.id, kind: "k", label: e.name, children: groups.get(e.id)! }));
      if (!era) {
        if (groups.get("none")?.length) top.push({ key: "era:none", kind: "k", label: "Цаг үе заагаагүй", children: groups.get("none")! });
        const no = people.filter((p) => !p.ongods.some((o) => oBy.has(o)));
        if (no.length) top.push({ key: "era:noongod", kind: "k", label: "Онгод тодроогүй", children: no.map((p) => pNode(p, "en")) });
      }
      return rootOf(top);
    }

    if (view === "net") {
      // Багш → шавь (эсвэл түшсэн / танилцуулсан) сүлжээ. Олон багштай хүн багш бүрийнхээ доор гарна (D38).
      const parentsOf = (p: MPerson) => (netRel === "teacher" ? p.teachers : netRel === "supporter" ? p.supporters : p.introducers).filter((t) => t !== p.id && pBy.has(t));
      const kids = new Map<string, MPerson[]>();
      for (const p of allPeople) for (const t of parentsOf(p)) (kids.get(t) || kids.set(t, []).get(t)!).push(p);
      const seen = new Set<string>();
      const build = (p: MPerson, pre: string, path: Set<string>): TNode => {
        seen.add(p.id);
        const key = pre + ">" + p.id;
        const np = new Set(path).add(p.id);
        return { key: "n" + key, kind: "p", pid: p.id, label: p.name, children: (kids.get(p.id) || []).filter((c) => !np.has(c.id)).map((c) => build(c, key, np)) };
      };
      const ch = allPeople.filter((p) => kids.has(p.id) && !parentsOf(p).length).map((r) => build(r, "", new Set()));
      // Тойрог холбоо (А нь Б-ийн багш, Б нь А-ийн багш) үндэсгүй үлдэхээс сэргийлнэ.
      for (const p of allPeople) if (!seen.has(p.id) && kids.has(p.id)) ch.push(build(p, "", new Set()));
      const rest = people.filter((p) => !seen.has(p.id));
      if (rest.length) ch.push({ key: "net:none", kind: "g", label: NET[netRel].none, children: rest.map((p) => pNode(p, "nn")) });
      return rootOf(ch);
    }

    if (view === "deedes") {
      const by = new Map<string, MPerson[]>();
      for (const p of people) for (const d of p.deedes) (by.get(d) || by.set(d, []).get(d)!).push(p);
      const ch: TNode[] = [...by].sort((a, b) => a[0].localeCompare(b[0], "mn")).map(([d, ps]) => ({ key: "d:" + d, kind: "g", label: d, children: ps.map((p) => pNode(p, "d:" + d)) }));
      const no = people.filter((p) => !p.deedes.length);
      if (no.length) ch.push({ key: "d:none", kind: "k", label: "Дээдэс хараахан тодроогүй", children: no.map((p) => pNode(p, "dn")) });
      return rootOf(ch);
    }

    if (view === "ego") {
      const c = egoId ? pBy.get(egoId) : undefined;
      if (!c) return rootOf([]);
      const sec = (k: string, label: string, arr: TNode[]): TNode | null => (arr.length ? { key: "s" + k, kind: "g", label, children: arr } : null);
      const pp = (k: string, ids: string[]) => [...new Set(ids)].map((i) => pBy.get(i)).filter((x): x is MPerson => !!x && x.id !== c.id).map((x) => pNode(x, "eg" + k));
      const rev = (f: (p: MPerson) => string[]) => allPeople.filter((p) => f(p).includes(c.id)).map((p) => p.id);
      const leaf = (key: string, label: string): TNode => ({ key, kind: "o", label, children: [] });
      return { key: "root", kind: "p", pid: c.id, label: c.name, children: [
        sec("o", "Онгод", c.ongods.filter((o) => oBy.has(o)).map((o) => leaf("eo" + o, ongodPath(o)))),
        sec("d", "Хуягласан дээдэс", c.deedes.map((d) => leaf("ed" + d, d))),
        sec("t", "Багш", pp("t", c.teachers)),
        sec("i", "Танилцуулсан", pp("i", c.introducers)),
        sec("u", "Түшиж хуягласан", pp("u", c.supporters)),
        sec("st", "Шавь нар", pp("st", rev((p) => p.teachers))),
        sec("si", "Түүний танилцуулсан хүмүүс", pp("si", rev((p) => p.introducers))),
        sec("su", "Түүний түшсэн хүмүүс", pp("su", rev((p) => p.supporters))),
      ].filter((x): x is TNode => !!x) };
    }

    const kidsOf = new Map<string, MOngod[]>();
    for (const o of ongods) { const k = o.parent_id || "root"; (kidsOf.get(k) || kidsOf.set(k, []).get(k)!).push(o); }
    const build = (parent: string, depth: number): TNode[] =>
      (kidsOf.get(parent) || []).map((o): TNode | null => {
        if (depth > 40) return null;
        if (era && parent === "root" && o.era_id !== era) return null;
        const sub = build(o.id, depth + 1);
        const ps = (byOngod.get(o.id) || []).map((p) => pNode(p, o.id));
        const isLeaf = !sub.length && o.kind === "ongod";
        if (isLeaf && !ps.length && !showEmpty) return null;
        const kind: TNode["kind"] = parent === "root" && o.kind === "group" ? "k" : isLeaf ? (ps.length ? "o" : "e") : o.kind === "ongod" ? "o" : "g";
        const ch = [...sub, ...ps];
        if (kind === "g" && !ch.length && !showEmpty) return null;
        return { key: o.id, kind, label: o.name, children: ch };
      }).filter(Boolean) as TNode[];
    const top = build("root", 0);
    // Онгод нь тодроогүй хүмүүс: явцын төлөвөөр нь бүлэглэнэ (Waiting list, Тодлох …)
    if (!era)
      for (const s of statuses) {
        const ps = people.filter((p) => !p.ongods.length && p.status_id === s.id);
        if (ps.length) top.push({ key: "none:" + s.id, kind: "k", label: `${s.name} · онгод тодроогүй`, children: ps.map((p) => pNode(p)) });
      }
    return rootOf(top);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, allPeople, ongods, era, showEmpty, statuses, props.urguuName, view, netRel, egoId, eras]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of people) if (p.status_id) c[p.status_id] = (c[p.status_id] || 0) + 1;
    return c;
  }, [people]);

  const move = (pid: string, to: string) => {
    const p = pBy.get(pid);
    if (!p || p.status_id === to || !canStatus) return;
    const from = p.status_id;
    setPeople((arr) => arr.map((x) => (x.id === pid ? { ...x, status_id: to } : x)));
    startT(async () => {
      const r = await changeStatus(pid, to);
      if (!r.ok) {
        setPeople((arr) => arr.map((x) => (x.id === pid ? { ...x, status_id: from } : x)));
        setToast(r.error || "Алдаа гарлаа");
      } else {
        setToast(`${p.name}: ${stBy.get(from || "")?.name || "—"} → ${stBy.get(to)?.name}`);
        router.refresh();
      }
      setTimeout(() => setToast(""), 3500);
    });
  };

  const quickCard = (pid: string, compact?: boolean) => {
    const p = pBy.get(pid);
    if (!p) return null;
    const st = stBy.get(p.status_id || "");
    const names = (ids: string[]) => ids.map((i) => pBy.get(i)?.name).filter(Boolean).join(", ");
    return (
      <>
        <div className="row g12" style={{ alignItems: "flex-start" }}>
          <Avatar name={p.name} st={st} size={56} />
          <div className="col g4" style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 20 }}>{p.name}</h2>
            <div className="row wrap" style={{ gap: 6 }}>{p.reg ? <StatusChip st={st} /> : <span className="chip">Бүртгэлд алга</span>}{p.nStudents ? <span className="chip">Багш</span> : null}</div>
          </div>
          {compact ? null : <button className="btn icon sm ghost" aria-label="Хаах" onClick={() => setSel(null)}><Icon n="x" s={18} /></button>}
        </div>
        <dl className="kv" style={{ gridTemplateColumns: "110px 1fr" }}>
          <dt>Онгод</dt><dd>{p.ongods.length ? p.ongods.map((o) => <div key={o}>{ongodPath(o)}</div>) : <span className="muted">Тодорхойгүй</span>}</dd>
          <dt>Дээдэс</dt><dd>{p.deedes.join(", ") || "—"}</dd>
          <dt>Түшсэн</dt><dd>{names(p.supporters) || "—"}</dd>
          <dt>Хуягийн огноо</dt><dd className="num">{p.hidden.includes("huyag_on") ? <Locked /> : p.huyag_on || "—"}</dd>
        </dl>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
          {([[p.nStudents, "шавь"], [p.nIntroduced, "танилцуулсан"], [p.nSupported, "түшсэн"]] as const).map(([n, l]) => (
            <div key={l} style={{ background: "var(--bg)", borderRadius: 10, padding: 10 }}><b style={{ font: "800 20px var(--f-head)" }}>{n}</b><div className="tiny muted">{l}</div></div>
          ))}
        </div>
        {p.hidden.includes("phone") ? (
          <div className="row between small"><span className="muted">Утас, имэйл</span><Locked /></div>
        ) : (
          <div className="col g4" style={{ border: "1px solid #EBDDC0", background: "#FBF7EF", borderRadius: "var(--r)", padding: "12px 14px" }}>
            <span className="row small" style={{ gap: 6, fontWeight: 700, color: "var(--gold-ink)" }}><Icon n="lock" s={14} w={2.4} />Хувийн мэдээлэл</span>
            <div className="row between small"><span className="muted">Утас</span>{p.phone ? <a href={`tel:${p.phone}`} className="num" style={{ fontWeight: 600 }}>{p.phone}</a> : "—"}</div>
            {p.hidden.includes("email") ? null : <div className="row between small"><span className="muted">Имэйл</span><b style={{ overflowWrap: "anywhere" }}>{p.email || "—"}</b></div>}
          </div>
        )}
        <div className="row" style={{ marginTop: "auto" }}>
          <Link className="btn pri" style={{ flex: 1 }} href={`/people/${pid}`}>Профайл нээх</Link>
          {props.views.includes("ego") && p.reg && !(view === "ego" && egoId === pid) ? <button className="btn" onClick={() => goEgo(pid)}>Төвд нь харах</button> : null}
        </div>
      </>
    );
  };

  return (
    <>
      <div className="pagehead">
        <div className="col g4"><div className="crumb">{props.urguuName}</div><div className="row wrap g12"><h1>Mind map</h1><LiveBadge /></div></div>
        <div className="row wrap">
          <label className="search" style={{ width: 300, maxWidth: "100%", flex: "1 1 220px" }}>
            <Icon n="search" s={16} /><input type="search" placeholder="Хүн, онгод хайх" aria-label="Хайх" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {props.canEdit ? <Link className="btn pri" href="/people?add=1"><Icon n="plus" s={16} w={2.4} /><span className="hide-m">Хүн нэмэх</span></Link> : null}
        </div>
      </div>
      <div className="kpis" role="group" aria-label="Тойм ба төлвөөр шүүх">
        <button className="kpi" onClick={() => setOff(new Set())} style={off.size ? undefined : { boxShadow: "inset 0 -3px 0 var(--pri)" }}>
          <span className="small muted">Нийт хүн</span><b className="num">{people.length}</b>
        </button>
        {[...statuses].reverse().map((s) => (
          <button key={s.id} className={`kpi${off.has(s.id) ? " off" : ""}`} aria-pressed={!off.has(s.id)}
            style={off.size && !off.has(s.id) ? { boxShadow: `inset 0 -3px 0 ${pal(s.pal).c}` } : undefined}
            onClick={() => setOff((o) => { const n = new Set(o); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}>
            <span className="row small" style={{ gap: 6, color: "var(--ink2)" }}><Shape st={s} s={13} />{s.name}</span><b className="num">{counts[s.id] || 0}</b>
          </button>
        ))}
      </div>
      <div className="row wrap between g12">
        <div className="seg" role="tablist" aria-label="Харагдац" style={{ flexWrap: "nowrap", overflowX: "auto", maxWidth: "100%" }}>
          {VIEWS.filter((x) => props.views.includes(x.key)).map(({ key: id, name: nm }) => (
            <button key={id} role="tab" aria-selected={view === id} className={view === id ? "on" : ""} style={{ whiteSpace: "nowrap" }}
              onClick={() => { setView(id); setSel(null); window.history.replaceState(null, "", `/map?view=${id}`); }}>{nm}</button>
          ))}
        </div>
        <div className="row wrap">
          {view === "tree" || view === "era" ? (
            <label className="search" style={{ padding: "0 10px", gap: 6 }}>
              <span className="small muted">Цаг үе</span>
              <select value={era} onChange={(e) => setEra(e.target.value)} style={{ border: 0, background: "transparent", fontWeight: 600, fontSize: 14 }}>
                <option value="">Бүгд</option>{eras.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
          ) : null}
          {view === "tree" ? <button className={`fchip${showEmpty ? " on" : ""}`} aria-pressed={showEmpty} onClick={() => setShowEmpty((v) => !v)}>Сул суудал</button> : null}
          {view === "net" ? (
            <label className="search" style={{ padding: "0 10px", gap: 6 }}>
              <span className="small muted">Холбоо</span>
              <select value={netRel} onChange={(e) => setNetRel(e.target.value as NetRel)} aria-label="Холбооны төрөл" style={{ border: 0, background: "transparent", fontWeight: 600, fontSize: 14 }}>
                {(Object.keys(NET) as NetRel[]).map((k) => <option key={k} value={k}>{NET[k].name}</option>)}
              </select>
            </label>
          ) : null}
          {view === "ego" ? (
            <label className="search" style={{ padding: "0 10px", gap: 6 }}>
              <span className="small muted">Төвд</span>
              <select value={egoId || ""} onChange={(e) => goEgo(e.target.value)} aria-label="Төвд харах хүн" style={{ border: 0, background: "transparent", fontWeight: 600, fontSize: 14, maxWidth: 200 }}>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {!props.views.length ? <div className="card"><div className="empty"><b>Харагдац нээгдээгүй байна</b><span>Таны түвшинд mind map-ийн харагдац зөвшөөрөгдөөгүй байна. Өргөөний админд хандана уу.</span></div></div> : null}
      {!props.views.length ? null : mobile === null ? <div className="card" style={{ minHeight: 320 }} /> : view === "kanban" ? (
        <Kanban people={people} statuses={statuses} stBy={stBy} ql={ql} can={canStatus} mobile={mobile} move={move} ongodPath={ongodPath} pBy={pBy} />
      ) : mobile ? (
        <>
          {view === "ego" && egoId && pBy.get(egoId) ? (
            <button className="pchip" style={{ alignSelf: "flex-start", height: 44, fontWeight: 700, borderColor: pal(stBy.get(pBy.get(egoId)!.status_id || "")?.pal).c }} onClick={() => setSel(egoId)}>
              <Avatar name={pBy.get(egoId)!.name} st={stBy.get(pBy.get(egoId)!.status_id || "")} size={30} />{pBy.get(egoId)!.name}
            </button>
          ) : null}
          <Outline key={view} root={tree} pBy={pBy} stBy={stBy} off={off} matchQ={matchQ} hasHit={hasHit} ql={ql} onPerson={setSel} />
        </>
      ) : (
        <div className="mapwrap">
          <TreeCanvas key={view} view={view} canExport={props.canExport} rootName={props.urguuName} root={tree} pBy={pBy} stBy={stBy} off={off} sel={sel} setSel={setSel} zoom={zoom} setZoom={setZoom}
            collapsed={collapsed} setCollapsed={setCollapsed} matchQ={matchQ} hasHit={hasHit} ql={ql} statuses={statuses} />
          <aside className="panel" aria-label="Дэлгэрэнгүй">
            {sel && pBy.get(sel) ? quickCard(sel) : (
              <>
                <h2>Сүүлийн өөрчлөлт</h2>
                <span className="small muted">Map дээрх хүн дээр дарж дэлгэрэнгүйг харна. Хаан, бүлэг дээр дарж эвхэнэ. Хоосон газар чирч гүйлгэнэ.</span>
                <div className="col g12">
                  {props.recent.map((a, i) => <div className="col" key={i}><span className="small">{a.what}</span><span className="tiny muted">{a.who} · {a.at}</span></div>)}
                </div>
              </>
            )}
          </aside>
        </div>
      )}

      {mobile && sel && pBy.get(sel) && view !== "kanban" ? (
        <>
          <div className="scrim in" style={{ zIndex: 55 }} onClick={() => setSel(null)} />
          <section className="sheet in"><div className="grab" />{quickCard(sel, true)}</section>
        </>
      ) : null}
      {toast ? <div className="toast-wrap" aria-live="polite"><div className="toast"><span>{toast}</span></div></div> : null}
    </>
  );
}

/* ---------- Онгодын мод (компьютер) ---------- */
const nodeH = (n: TNode) => (n.key === "root" ? 44 : n.kind === "k" ? 38 : 34);

function TreeCanvas({ view, canExport, rootName, root, pBy, stBy, off, sel, setSel, zoom, setZoom, collapsed, setCollapsed, matchQ, hasHit, ql, statuses }: {
  view: ViewKey; canExport: boolean; rootName: string; root: TNode; pBy: Map<string, MPerson>; stBy: Map<string, MStatus>; off: Set<string>; sel: string | null; setSel: (s: string | null) => void;
  zoom: number; setZoom: (f: (z: number) => number) => void; collapsed: Record<string, boolean>; setCollapsed: (f: (c: Record<string, boolean>) => Record<string, boolean>) => void;
  matchQ: (n: TNode) => boolean; hasHit: (n: TNode) => boolean; ql: string; statuses: MStatus[];
}) {
  const ms = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const [fontsReady, setFontsReady] = useState(0);
  useEffect(() => { document.fonts?.ready.then(() => setFontsReady(1)); }, []);

  const L = useMemo(() => {
    const ROW = 46, GAP = 56;
    const colW: number[] = [];
    const nodes: TNode[] = [];
    let row = 0;
    let selChain: TNode[] = [];
    const sz = (n: TNode): [number, number, number] => n.key === "root" ? (n.kind === "p" ? [15, 700, 70] : [15, 700, 34]) : n.kind === "k" ? [14, 700, 30] : n.kind === "p" ? [13, 600, 58] : [13, n.kind === "g" ? 600 : 500, 30];
    const walk = (n: TNode, depth: number, chain: TNode[]) => {
      const coll = !!collapsed[n.key] && !(ql && hasHit(n));
      const [px, wt, pad] = sz(n);
      n.w = Math.ceil(textW(n.label, px, wt)) + pad + (n.kind === "e" ? 100 : 0) + ((n.kind === "k" || n.kind === "g") && n.children.length ? 34 : 0);
      n.depth = depth; n.coll = coll; colW[depth] = Math.max(colW[depth] || 0, n.w);
      if (n.kind === "p" && n.pid === sel && !selChain.length) selChain = chain.concat(n);
      const kids = coll ? [] : n.children;
      if (!kids.length) { n.y = row * ROW + 56; row++; }
      else { kids.forEach((c) => walk(c, depth + 1, chain.concat(n))); n.y = (kids[0].y! + kids[kids.length - 1].y!) / 2; }
      n.kids = kids; nodes.push(n);
    };
    walk(root, 0, []);
    const colX = [24];
    for (let i = 1; i < colW.length; i++) colX[i] = colX[i - 1] + colW[i - 1] + GAP;
    const H = nodeH;
    let paths = "", hot = "";
    const hotSet = new Set(selChain);
    nodes.forEach((n) => { n.x = colX[n.depth!]; });
    nodes.forEach((n) => n.kids!.forEach((c) => {
      const x1 = n.x! + n.w!, y1 = n.y! + H(n) / 2, x2 = c.x!, y2 = c.y! + H(c) / 2, mx = (x1 + x2) / 2;
      const d = `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
      if (hotSet.has(n) && hotSet.has(c)) hot += d; else paths += d;
    }));
    return { nodes, paths, hot, W: colX[colX.length - 1] + colW[colW.length - 1] + 60, Ht: row * ROW + 120, selChain };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, collapsed, sel, ql, fontsReady]);

  // Эхний удаа үндэс зангилааг босоо тэнхлэгт голлуулна.
  const centered = useRef(false);
  useEffect(() => {
    const el = ms.current;
    const rootN = L.nodes.find((n) => n.key === "root");
    if (!el || !rootN || centered.current || !fontsReady) return;
    centered.current = true;
    el.scrollTop = Math.max(0, rootN.y! * zoom - el.clientHeight / 2 + 20);
  }, [L, fontsReady, zoom]);

  useEffect(() => {
    if (!ql) return;
    const hit = ms.current?.querySelector(".node.hit") as HTMLElement | null;
    hit?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [ql]);

  // P2.6: одоо харагдаж буй (эвхсэн, шүүсэн) модыг PNG / PDF болгон татна.
  const [busy, setBusy] = useState(false);
  const doExport = async (fmt: "png" | "pdf") => {
    if (busy) return;
    setBusy(true);
    try {
      const hot = new Set(L.selChain);
      const edges: XEdge[] = [];
      const nodes: XNode[] = L.nodes.map((n) => {
        const h = nodeH(n);
        for (const c of n.kids || []) edges.push({ x1: n.x! + n.w!, y1: n.y! + h / 2, x2: c.x!, y2: c.y! + nodeH(c) / 2, hot: hot.has(n) && hot.has(c) });
        const p = n.kind === "p" ? pBy.get(n.pid!) : undefined;
        const st = p?.reg ? stBy.get(p.status_id || "") : undefined;
        const c = st ? pal(st.pal) : n.kind === "p" && p?.reg ? PAL[4] : pal(0);
        return {
          x: n.x!, y: n.y!, w: n.w!, h, label: n.label, kind: n.kind, big: n.key === "root" && n.kind === "p",
          ...(n.kind === "p" ? { border: c.c, dashed: !!p && !p.reg, ink: p && !p.reg ? "#5A6576" : undefined, avatar: { text: initials(n.label), bg: c.s, ink: c.i } } : {}),
          cnt: (n.kind === "k" || n.kind === "g") && n.children.length ? countP(n) : undefined,
        };
      });
      const day = new Date().toISOString().slice(0, 10);
      await exportMap(fmt, nodes, edges, L.W, L.Ht, `${root.kind === "p" ? root.label + " · " : ""}${VIEW_NAME.get(view)} · ${rootName} · ${day}`, `huyagtan-${view}-${day}`);
    } finally {
      setBusy(false);
    }
  };

  const fit = () => {
    const el = ms.current;
    if (!el) return;
    const z = Math.max(0.3, Math.min(1, (el.clientWidth - 20) / L.W, (el.clientHeight - 20) / L.Ht));
    setZoom(() => z);
    el.scrollTo({ left: 0, top: 0, behavior: "smooth" });
  };

  return (
    <section className="mapbox" aria-label="Mind map талбай">
      <div className={"mapscroll"} ref={ms}
        onPointerDown={(e) => { if ((e.target as HTMLElement).closest(".node")) return; const el = ms.current!; drag.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop }; el.classList.add("drag"); el.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { const d = drag.current; if (!d) return; const el = ms.current!; el.scrollLeft = d.l - (e.clientX - d.x); el.scrollTop = d.t - (e.clientY - d.y); }}
        onPointerUp={() => { drag.current = null; ms.current?.classList.remove("drag"); }}>
        <div style={{ width: L.W * zoom, height: L.Ht * zoom }}>
          <div className="stage" style={{ width: L.W, height: L.Ht, transform: `scale(${zoom})` }}>
            <svg width={L.W} height={L.Ht} aria-hidden="true">
              <path d={L.paths} fill="none" stroke="#C3CCD8" strokeWidth="1.5" />
              <path d={L.hot} fill="none" stroke="#1E4FA0" strokeWidth="2.5" />
            </svg>
            {L.nodes.map((n) => {
              const isP = n.kind === "p";
              const p = isP ? pBy.get(n.pid!) : undefined;
              const st = p?.reg ? stBy.get(p.status_id || "") : undefined;
              const c = pal(st?.pal);
              const cls = ["node", n.kind, n.coll ? "coll" : "", isP && sel === n.pid ? "on" : "", p?.reg && off.has(p.status_id || "") ? "dim" : "", matchQ(n) ? "hit" : ""].join(" ");
              const style: React.CSSProperties = { left: n.x, top: n.y, width: n.w, ...(isP ? { borderColor: c.c, background: sel === n.pid ? c.s : "#fff" } : {}), ...(p && !p.reg ? { borderStyle: "dashed", color: "var(--muted)" } : {}),
                ...(isP && n.key === "root" ? { height: 44, fontSize: 15, borderWidth: 2, fontWeight: 700 } : {}) };
              const cnt = (n.kind === "k" || n.kind === "g") && n.children.length ? countP(n) : 0;
              return (
                <button key={n.key} className={cls} style={style}
                  aria-label={isP ? `${n.label}, ${st?.name || ""}` : n.label + (n.children.length ? (n.coll ? ", хаалттай" : ", нээлттэй") : "")}
                  onClick={() => {
                    if (isP) return setSel(sel === n.pid ? null : n.pid!);
                    if (n.kind === "root" || !n.children.length) return;
                    setCollapsed((cm) => ({ ...cm, [n.key]: !n.coll }));
                  }}>
                  {isP ? <><Avatar name={n.label} st={st} size={n.key === "root" ? 32 : 24} /><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{n.label}</span></> : (
                    <><span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{n.label}</span>{cnt ? <span className="cnt">{cnt}</span> : null}{n.kind === "e" ? <span className="add" style={{ color: "var(--faint)" }}>сул суудал</span> : null}</>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mcrumb">
        {L.selChain.length ? <>{L.selChain.slice(0, -1).map((n) => n.label).join(" › ")} › <b>{L.selChain[L.selChain.length - 1].label}</b></> : <><b>{VIEW_NAME.get(view)}</b> · Хүн дээр дарж дэлгэрэнгүйг харна</>}
      </div>
      <div className="legend">
        {statuses.map((s) => <span key={s.id} className="row" style={{ gap: 6 }}><Shape st={s} s={12} />{s.name}</span>)}
        {view === "tree" ? <span className="row" style={{ gap: 6 }}><span style={{ width: 18, height: 10, border: "1px dashed #8A94A3", borderRadius: 3 }} />Сул суудал</span> : null}
      </div>
      <div className="mapctl">
        <button aria-label="Томруулах" onClick={() => setZoom((z) => Math.min(1.8, z + 0.15))}>+</button>
        <button aria-label="Бүгдийг харах" onClick={fit}><Icon n="fit" s={18} /></button>
        <button aria-label="Жижигрүүлэх" onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))}>−</button>
        {canExport ? (
          <>
            <button aria-label="PNG зураг татах" title="PNG зураг татах" disabled={busy} onClick={() => doExport("png")} style={{ fontSize: 11, fontWeight: 700 }}>PNG</button>
            <button aria-label="PDF татах" title="PDF татах" disabled={busy} onClick={() => doExport("pdf")} style={{ fontSize: 11, fontWeight: 700 }}>PDF</button>
          </>
        ) : null}
      </div>
    </section>
  );
}

/* ---------- Онгодын мод (гар утас: эвхэгддэг жагсаалт) ---------- */
function Outline({ root, pBy, stBy, off, matchQ, hasHit, ql, onPerson }: {
  root: TNode; pBy: Map<string, MPerson>; stBy: Map<string, MStatus>; off: Set<string>; matchQ: (n: TNode) => boolean; hasHit: (n: TNode) => boolean; ql: string; onPerson: (id: string) => void;
}) {
  const chip = (n: TNode) => {
    const p = pBy.get(n.pid!)!;
    const st = stBy.get(p.status_id || "");
    return (
      <button key={n.key} className="pchip" onClick={() => onPerson(p.id)} style={{ borderColor: pal(st?.pal).c, opacity: off.has(p.status_id || "") ? 0.3 : 1, boxShadow: matchQ(n) ? "0 0 0 4px rgba(176,106,8,.35)" : undefined }}>
        <Avatar name={p.name} st={st} size={26} />{p.name}
      </button>
    );
  };
  const rec = (n: TNode, lv: number): React.ReactNode => {
    const ps = n.children.filter((k) => k.kind === "p" && !k.children.length);
    const others = n.children.filter((k) => k.kind !== "p" || k.children.length);
    if (ql && !hasHit(n)) return null;
    if (!n.children.length)
      return <div key={n.key} style={{ padding: "8px 12px 8px 22px", color: n.kind === "e" ? "var(--muted)" : "var(--ink2)", fontSize: 14 }}>{n.label} {n.kind === "e" ? <span className="tiny">· сул суудал</span> : null}</div>;
    const c = countP(n);
    return (
      <details key={n.key + (ql ? ":q" : "")} className={lv === 0 ? "lv0" : ""} open={ql ? true : n.key !== "net:none" && (lv < 2 || others.length === 0)}>
        <summary><span className="chev"><Icon n="right" s={16} /></span>{n.kind === "p" ? <span style={{ flex: 1 }} onClick={(e) => e.preventDefault()}>{chip(n)}</span> : <span style={{ flex: 1 }}>{n.label}</span>}{c ? <span className="chip">{c}</span> : null}</summary>
        {others.map((k) => rec(k, lv + 1))}
        {ps.length ? <div className="pchips">{ps.map(chip)}</div> : null}
      </details>
    );
  };
  const body = root.children.map((n) => rec(n, 0)).filter(Boolean);
  return <div className="outline">{body.length ? body : <div className="empty"><b>Илэрц алга</b></div>}</div>;
}

/* ---------- Явцын самбар ---------- */
function Kanban({ people, statuses, stBy, ql, can, mobile, move, ongodPath, pBy }: {
  people: MPerson[]; statuses: MStatus[]; stBy: Map<string, MStatus>; ql: string; can: boolean; mobile: boolean; move: (pid: string, to: string) => void;
  ongodPath: (id: string) => string; pBy: Map<string, MPerson>;
}) {
  const router = useRouter();
  const [over, setOver] = useState<string | null>(null);
  const last = statuses[statuses.length - 1]?.id;
  return (
    <>
      <p className="small muted" style={{ margin: "0 0 2px" }}>
        {can ? (mobile ? "Картын сумаар дараагийн шат руу шилжүүлнэ." : "Картыг чирж дараагийн шат руу шилжүүлнэ.") + " Өөрчлөлт бүр хүний түүхэнд хадгалагдана." : "Та зөвхөн харах эрхтэй."}
      </p>
      <div className="kanban" style={{ ["--n" as any]: statuses.length }}>
        {statuses.map((s, ci) => {
          const ps = people.filter((p) => p.status_id === s.id && (!ql || p.search.includes(ql)));
          return (
            <div key={s.id} className={`kcol${over === s.id ? " over" : ""}`}
              onDragOver={(e) => { if (!can) return; e.preventDefault(); setOver(s.id); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); move(e.dataTransfer.getData("text/plain"), s.id); }}>
              <div className="col" style={{ padding: "2px 4px 6px" }}>
                <div className="row"><Shape st={s} s={14} /><b style={{ flex: 1, fontSize: 14 }}>{s.name}</b><span className="chip" style={{ background: "#fff" }}>{ps.length}</span></div>
                <span className="tiny muted">{s.description || ""}</span>
              </div>
              {ps.length ? ps.map((p) => {
                const days = daysSince(p.since);
                const sup = p.supporters[0] ? pBy.get(p.supporters[0]) : undefined;
                const intro = p.introducers[0] ? pBy.get(p.introducers[0]) : undefined;
                return (
                  <article key={p.id} className="kcard" draggable={can} tabIndex={0} aria-label={p.name}
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", p.id); e.currentTarget.classList.add("dragging"); }}
                    onDragEnd={(e) => e.currentTarget.classList.remove("dragging")}
                    onClick={(e) => { if ((e.target as HTMLElement).closest("[data-mv]")) return; router.push(`/people/${p.id}`); }}
                    onKeyDown={(e) => { if (e.key === "Enter") router.push(`/people/${p.id}`); }}>
                    <div className="row between"><b style={{ fontSize: 14 }}>{p.name}</b>{s.id !== last && days >= 40 ? <span className="chip bad">{days}+ хоног</span> : null}</div>
                    <span className="tiny muted">{p.ongods.length ? ongodPath(p.ongods[0]).split(" › ").slice(-2).join(" › ") : "Онгод тодорхойгүй"}</span>
                    {s.id === last && p.deedes.length ? <span className="chip gold" style={{ alignSelf: "flex-start", height: 22 }}>{p.deedes[0]}</span> : null}
                    <div className="row between tiny muted">
                      <span className="row" style={{ gap: 6 }}>{sup ? <><Avatar name={sup.name} st={stBy.get(sup.status_id || "")} size={22} />{sup.name}</> : intro ? `Танилцуулсан: ${intro.name}` : ""}</span>
                      <span className="num" style={{ whiteSpace: "nowrap" }}>{s.id === last ? (p.hidden.includes("huyag_on") ? "" : p.huyag_on || "") : `${days} хоног`}</span>
                    </div>
                    {can ? (
                      <div className="mv row between">
                        {ci > 0 ? <button className="btn sm" data-mv onClick={() => move(p.id, statuses[ci - 1].id)} aria-label="Өмнөх шат">‹ {statuses[ci - 1].name}</button> : <span />}
                        {ci < statuses.length - 1 ? <button className="btn sm soft" data-mv onClick={() => move(p.id, statuses[ci + 1].id)} aria-label="Дараагийн шат">{statuses[ci + 1].name} ›</button> : null}
                      </div>
                    ) : null}
                  </article>
                );
              }) : <div className="empty" style={{ padding: 16 }}><span className="small">Хоосон</span></div>}
            </div>
          );
        })}
      </div>
    </>
  );
}
