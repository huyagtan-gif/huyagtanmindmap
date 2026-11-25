import Link from "next/link";
import { auditText, fmtDateTime } from "@/lib/audit-text";
import { displayName } from "@/lib/project";
import { asViewer, requirePerm } from "@/lib/viewer";

export const metadata = { title: "Өөрчлөлтийн түүх" };

export default async function Audit({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const v = await requirePerm("audit.view");
  const page = Math.max(1, parseInt((await searchParams).page || "1", 10) || 1);
  const SIZE = 100;
  const rows = await asViewer(v, (q) =>
    q<{ id: string; entity: string; action: string; before: any; after: any; at: Date; father_name: string | null; given_name: string | null }>(
      `SELECT a.id, a.entity, a.action, a.before, a.after, a.at, p.father_name, p.given_name
       FROM audit_log a LEFT JOIN person p ON p.id = a.actor_person_id ORDER BY a.id DESC LIMIT $1 OFFSET $2`, [SIZE + 1, (page - 1) * SIZE]));
  return (
    <>
      <div className="pagehead"><div><div className="crumb">{v.urguu.name}</div><h1>Өөрчлөлтийн түүх</h1></div></div>
      <div className="card p0 tscroll">
        <table className="t">
          <thead><tr><th>Хэзээ</th><th>Хэн</th><th>Юу</th></tr></thead>
          <tbody>
            {rows.slice(0, SIZE).map((a) => (
              <tr key={a.id}>
                <td className="num small" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(a.at)}</td>
                <td>{a.given_name ? displayName({ father_name: a.father_name, given_name: a.given_name }) : <span className="muted">Систем</span>}</td>
                <td>{auditText(a)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length ? null : <div style={{ padding: 16 }}><div className="empty"><b>Өөрчлөлт алга</b></div></div>}
      </div>
      <div className="row">
        {page > 1 ? <Link className="btn sm" href={`/admin/audit?page=${page - 1}`}>‹ Шинэ</Link> : null}
        {rows.length > SIZE ? <Link className="btn sm" href={`/admin/audit?page=${page + 1}`}>Хуучин ›</Link> : null}
      </div>
    </>
  );
}
