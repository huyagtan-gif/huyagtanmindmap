import Link from "next/link";
import { saveEvent } from "@/app/actions/events";
import { MultiPicker, type Opt } from "@/components/Pickers";
import { localInput } from "@/lib/time";

export type EventRow = {
  id: string; name: string; type_id: string | null; starts_at: Date; ends_at: Date | null; place: string | null; description: string | null;
  organizer_id: string | null; ongod_id: string | null; deedes_id: string | null; state: string; donations_open: boolean; public_code: string | null;
};

/** Үйл үүсгэх / засах форм (P3.1). */
export function EventForm({ ev, types, people, ongods, deedes, cancelHref }: {
  ev?: EventRow; types: { id: string; name: string }[]; people: Opt[]; ongods: { id: string; name: string }[]; deedes: { id: string; name: string }[]; cancelHref: string;
}) {
  const org = ev?.organizer_id ? people.find((p) => p.id === ev.organizer_id) : undefined;
  return (
    <form action={saveEvent} className="card col g12">
      <h2>{ev ? "Үйл засах" : "Үйл нэмэх"}</h2>
      {ev ? <input type="hidden" name="id" value={ev.id} /> : null}
      <div className="formgrid">
        <label className="field" style={{ gridColumn: "1 / -1" }}><span>Нэр <span className="req">*</span></span><input className="inp" name="name" required maxLength={160} defaultValue={ev?.name || ""} placeholder="Жишээ: Цагаан сарын золголт" autoFocus={!ev} /></label>
        <label className="field">Төрөл
          <select className="inp" name="type_id" defaultValue={ev?.type_id || types[0]?.id || ""}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        </label>
        <label className="field">Байршил<input className="inp" name="place" maxLength={200} defaultValue={ev?.place || ""} placeholder="Өргөөний байр" /></label>
        <label className="field"><span>Эхлэх <span className="req">*</span></span><input className="inp" type="datetime-local" name="starts_at" required defaultValue={localInput(ev?.starts_at)} /></label>
        <label className="field">Дуусах<span className="hint">Заавал биш</span><input className="inp" type="datetime-local" name="ends_at" defaultValue={localInput(ev?.ends_at)} /></label>
        <div className="field">Зохион байгуулагч
          <MultiPicker name="organizer" options={people} max={1} placeholder="Хүн хайх" initial={org ? [{ id: org.id, label: org.label }] : []} />
        </div>
        <label className="field">Холбогдох онгод<span className="hint">Заавал биш</span>
          <select className="inp" name="ongod_id" defaultValue={ev?.ongod_id || ""}><option value="">—</option>{ongods.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        </label>
        <label className="field">Холбогдох дээдэс<span className="hint">Заавал биш</span>
          <select className="inp" name="deedes_id" defaultValue={ev?.deedes_id || ""}><option value="">—</option>{deedes.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        </label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>Тайлбар<textarea className="inp" name="description" rows={3} maxLength={4000} defaultValue={ev?.description || ""} /></label>
      </div>
      <label className="row small" style={{ gap: 8 }}><input type="checkbox" name="donations_open" defaultChecked={ev?.donations_open ?? false} />Энэ үйлд QPay-ээр хандив авна</label>
      <div className="row"><button className="btn pri" type="submit">{ev ? "Хадгалах" : "Үүсгэх"}</button><Link className="btn" href={cancelHref}>Болих</Link></div>
    </form>
  );
}
