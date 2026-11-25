// Phase 5-д бөглөгдөнө: PWA push мэдэгдэл. Одоогоор юу ч хийхгүй.
export type PushMsg = { title: string; body: string; url: string | null };
export async function pushTo(_personId: string, _m: PushMsg): Promise<void> {}
