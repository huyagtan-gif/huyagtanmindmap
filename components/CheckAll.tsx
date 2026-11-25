"use client";

/** Хүснэгтийн «бүгдийг сонгох» чагт: `form` шинж нь таарах `name`-тэй бүх чагтыг тэмдэглэнэ. */
export function CheckAll({ form, name = "pid", label = "Бүгдийг сонгох" }: { form: string; name?: string; label?: string }) {
  return (
    <input
      type="checkbox" aria-label={label} style={{ width: 18, height: 18, accentColor: "var(--pri)" }}
      onChange={(e) => {
        document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"][form="${form}"]`).forEach((c) => { c.checked = e.currentTarget.checked; });
      }}
    />
  );
}
