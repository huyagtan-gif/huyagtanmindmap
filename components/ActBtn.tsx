import type { ReactNode } from "react";
import { ConfirmButton } from "./AutoSubmit";

/**
 * Нэг товчтой жижиг форм: утгуудыг нуугдмал талбараар дамжуулна (товчны name/value-д найдахгүй).
 * confirm өгвөл дарахад баталгаажуулах асуулт гарна.
 */
export function ActBtn({ action, fields, className = "btn sm", confirm, children, label, pressed, disabled }: {
  action: (fd: FormData) => void | Promise<void>; fields: Record<string, string | null | undefined>; className?: string; confirm?: string;
  children: ReactNode; label?: string; pressed?: boolean; disabled?: boolean;
}) {
  return (
    <form action={action} style={{ display: "contents" }}>
      {Object.entries(fields).map(([k, v]) => (v == null ? null : <input key={k} type="hidden" name={k} value={v} />))}
      {confirm
        ? <ConfirmButton className={className} message={confirm} aria-label={label} disabled={disabled}>{children}</ConfirmButton>
        : <button className={className} aria-label={label} aria-pressed={pressed} disabled={disabled}>{children}</button>}
    </form>
  );
}
