import { Pool, type PoolClient, type QueryResultRow } from "pg";

// Нэг процесс, жижиг pool (1 GB RAM сервер).
const g = globalThis as unknown as { __pgPool?: Pool };
export const pool: Pool =
  g.__pgPool ??
  (g.__pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX || 6),
    idleTimeoutMillis: 30_000,
  }));

/** Системийн хүсэлт: RLS-гүй (хүснэгтийн эзэмшигч). Зөвхөн нэвтрэлт, бүртгүүлэх, урилга зэрэг өргөөний контекстгүй үед. */
export async function sys<T extends QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(text, params as any[])).rows;
}

export type DbCtx = { userId?: number | null; personId?: string | null; urguuId?: string | null };
export type Q = <T extends QueryResultRow = any>(text: string, params?: unknown[]) => Promise<T[]>;

async function run<T>(ctx: DbCtx, asApp: boolean, fn: (q: Q, client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (asApp) await client.query("SET LOCAL ROLE huyagtan_app");
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.person_id', $2, true), set_config('app.urguu_id', $3, true)",
      [ctx.userId ? String(ctx.userId) : "", ctx.personId ?? "", ctx.urguuId ?? ""],
    );
    // Нэг холболт дээр хүсэлтүүд дараалж явна (Promise.all-оор зэрэг дуудсан ч).
    let chain: Promise<unknown> = Promise.resolve();
    const q: Q = (text, params = []) => {
      const r = chain.then(() => client.query(text, params as any[]));
      chain = r.catch(() => {});
      return r.then((x) => x.rows as any);
    };
    const out = await fn(q, client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * A2: хэрэглэгчийн хүсэлт. Транзакц дотор huyagtan_app role + app.user_id / app.person_id / app.urguu_id
 * тохируулна. RLS өргөөгөөр тусгаарлана, audit trigger хэн хийснийг эндээс авна.
 */
export function withCtx<T>(ctx: DbCtx, fn: (q: Q, client: PoolClient) => Promise<T>): Promise<T> {
  return run(ctx, true, fn);
}

/** Системийн транзакц (RLS-гүй) боловч audit-д actor бичигдэнэ. */
export function sysTx<T>(ctx: DbCtx, fn: (q: Q, client: PoolClient) => Promise<T>): Promise<T> {
  return run(ctx, false, fn);
}
