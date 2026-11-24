"use client";
import { useMemo, useRef, useState } from "react";

export type Opt = { id: string; label: string; sub?: string; search?: string };
type Sel = { id?: string; label: string };

const lc = (s: string) => s.toLowerCase();

/**
 * Олон сонголттой хайлттай сонгогч. Сонгосон утгууд `name` нэртэй нуугдмал input-ээр илгээгдэнэ:
 *   "id:<uuid>"  — жагсаалтаас сонгосон
 *   "new:<text>" — жагсаалтад байхгүй, шинээр бичсэн (allowNew үед)
 */
export function MultiPicker({
  name, options, initial = [], placeholder, allowNew, newHint, max,
}: {
  name: string; options: Opt[]; initial?: Sel[]; placeholder?: string; allowNew?: boolean; newHint?: string; max?: number;
}) {
  const [sel, setSel] = useState<Sel[]>(initial);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const chosen = useMemo(() => new Set(sel.map((s) => s.id).filter(Boolean)), [sel]);
  const hits = useMemo(() => {
    const t = lc(q.trim());
    const pool = options.filter((o) => !chosen.has(o.id));
    const out = t ? pool.filter((o) => lc(o.label + " " + (o.search || "") + " " + (o.sub || "")).includes(t)) : pool;
    return out.slice(0, 30);
  }, [q, options, chosen]);
  const exact = hits.some((h) => lc(h.label) === lc(q.trim()));
  const canNew = !!allowNew && q.trim().length > 1 && !exact;
  const full = max !== undefined && sel.length >= max;

  const add = (s: Sel) => {
    setSel((p) => [...p, s]);
    setQ("");
    setAct(0);
    ref.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setAct((a) => Math.min(a + 1, hits.length - (canNew ? 0 : 1))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAct((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault(); // формыг санамсаргүй илгээхээс сэргийлнэ
      if (!open) return;
      if (hits[act]) add({ id: hits[act].id, label: hits[act].label });
      else if (canNew) add({ label: q.trim() });
    } else if (e.key === "Escape") setOpen(false);
    else if (e.key === "Backspace" && !q && sel.length) setSel((p) => p.slice(0, -1));
  };

  return (
    <div className="picker" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      {sel.map((s, i) => <input key={i} type="hidden" name={name} value={s.id ? `id:${s.id}` : `new:${s.label}`} />)}
      {sel.length ? (
        <div className="tags">
          {sel.map((s, i) => (
            <span key={i} className={`chip ${s.id ? "pri" : "warn"}`} style={{ height: 32 }}>
              {s.label}{s.id ? "" : " · шинэ"}
              <button type="button" aria-label={`${s.label} хасах`} onClick={() => setSel((p) => p.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
        </div>
      ) : null}
      {full ? null : (
        <input
          ref={ref} className="inp" value={q} placeholder={placeholder} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={`${name}-menu`}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setAct(0); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
        />
      )}
      {open && !full && (hits.length || canNew) ? (
        <div className="menu" id={`${name}-menu`} role="listbox">
          {hits.map((h, i) => (
            <button type="button" key={h.id} role="option" aria-selected={i === act} className={i === act ? "act" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => add({ id: h.id, label: h.label })}>
              <span>{h.label}</span>
              {h.sub ? <span className="tiny muted">{h.sub}</span> : null}
            </button>
          ))}
          {canNew ? (
            <button type="button" className={act === hits.length ? "act" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => add({ label: q.trim() })}>
              <span>+ «{q.trim()}» гэж нэмэх</span>
              <span className="tiny muted">{newHint || "Жагсаалтад байхгүй"}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
