import { Client } from "pg";

// P2.1: PostgreSQL LISTEN/NOTIFY → SSE. Процесст НЭГ л LISTEN холболт; SSE холболт бүр DB холболт эзлэхгүй.
// A3: энд зөвхөн дохио ({entity, id, urguu_id}) дамжина. Өгөгдөл хэзээ ч явахгүй.
export type Signal = { entity: string; resync?: boolean };
type Sub = { urguuId: string; push: (s: Signal) => void };
type State = { subs: Set<Sub>; client: Client | null; connecting: boolean; retry: ReturnType<typeof setTimeout> | null };

const g = globalThis as unknown as { __rt?: State };
const st: State = (g.__rt ??= { subs: new Set(), client: null, connecting: false, retry: null });
export const MAX_SUBSCRIBERS = 400;

function scheduleReconnect() {
  if (st.retry || !st.subs.size) return;
  st.retry = setTimeout(() => {
    st.retry = null;
    void connect(true);
  }, 2000);
}

async function connect(resync = false) {
  if (st.client || st.connecting || !st.subs.size) return;
  st.connecting = true;
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  const drop = () => {
    if (st.client !== c) return;
    st.client = null;
    c.end().catch(() => {});
    scheduleReconnect();
  };
  c.on("error", drop);
  c.on("end", drop);
  c.on("notification", (m) => {
    let p: { entity?: string; urguu_id?: string | null };
    try {
      p = JSON.parse(m.payload || "{}");
    } catch {
      return;
    }
    if (!p.entity) return;
    for (const s of st.subs) if (!p.urguu_id || p.urguu_id === s.urguuId) s.push({ entity: p.entity });
  });
  try {
    await c.connect();
    await c.query("LISTEN huyagtan");
    st.client = c;
    // Холболт тасарсан хугацаанд дохио алдагдсан байж болно: бүгдэд "дахин тат" гэж хэлнэ.
    if (resync) for (const s of st.subs) s.push({ entity: "*", resync: true });
  } catch (e) {
    console.error("[realtime] LISTEN холбогдож чадсангүй:", e instanceof Error ? e.message : e);
    c.end().catch(() => {});
    scheduleReconnect();
  } finally {
    st.connecting = false;
  }
}

/** Өргөөний дохионд бүртгүүлнэ. Буцаах функц нь бүртгэлийг цуцална. Хязгаар хэтэрсэн бол null. */
export function subscribe(urguuId: string, push: (s: Signal) => void): (() => void) | null {
  if (st.subs.size >= MAX_SUBSCRIBERS) return null;
  const sub: Sub = { urguuId, push };
  st.subs.add(sub);
  void connect();
  return () => {
    st.subs.delete(sub);
    if (!st.subs.size && st.client) {
      const c = st.client;
      st.client = null;
      c.end().catch(() => {});
    }
  };
}

export const realtimeStats = () => ({ subscribers: st.subs.size, listening: !!st.client });
