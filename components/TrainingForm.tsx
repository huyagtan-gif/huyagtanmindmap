import Link from "next/link";
import { saveTraining } from "@/app/actions/training";
import { MultiPicker, type Opt } from "@/components/Pickers";
import { REG, SCOPE, T_STATE, type Training } from "@/lib/training";

/** Сургалт үүсгэх / тохиргоо засах форм (P3.2). */
export function TrainingForm({ t, people, teachers, cancelHref }: { t?: Training; people: Opt[]; teachers?: { id: string; label: string }[]; cancelHref?: string }) {
  return (
    <form action={saveTraining} className={t ? "col g12" : "card col g12"}>
      {t ? <input type="hidden" name="id" value={t.id} /> : <h2>Сургалт нэмэх</h2>}
      <input type="hidden" name="teachers_sent" value="1" />
      <div className="formgrid">
        <label className="field" style={{ gridColumn: "1 / -1" }}><span>Нэр <span className="req">*</span></span><input className="inp" name="name" required maxLength={160} defaultValue={t?.name || ""} placeholder="Жишээ: Хээрийн сургалт · 2027 хавар" autoFocus={!t} /></label>
        <label className="field" style={{ gridColumn: "1 / -1" }}>Сэдэв<input className="inp" name="topic" maxLength={300} defaultValue={t?.topic || ""} placeholder="Онгодын түүх, ёс заншил" /></label>
        <div className="field" style={{ gridColumn: "1 / -1" }}>Багш(ууд)
          <MultiPicker name="teachers" options={people} placeholder="Багш хайж нэмэх" initial={teachers || []} />
        </div>
        <label className="field">Хамрах хүрээ
          <select className="inp" name="scope" defaultValue={t?.scope || "members"}>{Object.entries(SCOPE).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        </label>
        <label className="field">Бүртгэлийн хэлбэр
          <select className="inp" name="reg_mode" defaultValue={t?.reg_mode || "both"}>{Object.entries(REG).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        </label>
        <label className="field">Төлбөр (₮)<span className="hint">0 бол үнэгүй</span><input className="inp" name="fee" inputMode="numeric" defaultValue={t?.fee ?? 0} /></label>
        <label className="field">Хүний тооны хязгаар<span className="hint">Хоосон бол хязгааргүй</span><input className="inp" name="capacity" inputMode="numeric" defaultValue={t?.capacity ?? ""} /></label>
        <label className="field">Байршил<input className="inp" name="place" maxLength={200} defaultValue={t?.place || ""} placeholder="Өргөөний байр" /></label>
        <label className="field">Онлайн холбоос<span className="hint">Заавал биш</span><input className="inp" name="online_url" type="url" maxLength={300} defaultValue={t?.online_url || ""} placeholder="https://" /></label>
        {t ? (
          <label className="field">Төлөв
            <select className="inp" name="state" defaultValue={t.state}>{Object.entries(T_STATE).map(([k, n]) => <option key={k} value={k}>{n[1]}</option>)}</select>
          </label>
        ) : (
          <label className="field">Эхний хичээл<span className="hint">Бусад хичээлийг дараа нэмнэ</span><input className="inp" type="datetime-local" name="first_session" /></label>
        )}
        <label className="field" style={{ gridColumn: "1 / -1" }}>Тайлбар<textarea className="inp" name="description" rows={3} maxLength={4000} defaultValue={t?.description || ""} /></label>
      </div>
      <label className="row small" style={{ gap: 8 }}><input type="checkbox" name="is_field" defaultChecked={t?.is_field ?? false} />Хээрийн сургалт (дүүргэсэн хүний «Хээрийн сургалтад суусан» автоматаар тэмдэглэгдэнэ)</label>
      {t ? <label className="row small" style={{ gap: 8 }}><input type="checkbox" name="survey_open" defaultChecked={t.survey_open} />Санал асуулга нээлттэй (оролцогчид үнэлгээ өгнө)</label> : null}
      <div className="row"><button className="btn pri" type="submit">{t ? "Хадгалах" : "Үүсгэх"}</button>{cancelHref ? <Link className="btn" href={cancelHref}>Болих</Link> : null}</div>
    </form>
  );
}
