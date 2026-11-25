export function Flash({ m }: { m?: string }) {
  return m ? <div className="banner info" role="status">{m}</div> : null;
}
