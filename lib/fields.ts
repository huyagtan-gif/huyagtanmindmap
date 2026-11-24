// Талбарын эрхийн түлхүүрүүд (field_permission.field_key). Админ самбарын хүснэгтэд энэ дарааллаар гарна.
export const FIELD_KEYS = [
  { key: "phone", name: "Утас" },
  { key: "email", name: "Имэйл" },
  { key: "facebook", name: "Фэйсбүүк" },
  { key: "teacher_note", name: "Багшийн тэмдэглэл" },
  { key: "comment", name: "Сэтгэгдэл" },
  { key: "suggestion", name: "Санал" },
  { key: "ulaach", name: "Улаачийн тэнгэрийн алдар" },
  { key: "knowledge", name: "Мэдлэгийн түвшин" },
  { key: "huyag_dates", name: "Хуягийн огноо" },
  { key: "donation", name: "Хандивын дүн" },
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number]["key"];

export const PERMISSIONS = [
  { key: "person.view", name: "Хүмүүсийг харах" },
  { key: "person.edit", name: "Хүний мэдээлэл засах" },
  { key: "person.merge", name: "Нэр нэгтгэх" },
  { key: "status.change", name: "Явцын төлөв солих" },
  { key: "member.approve", name: "Бүртгэл батлах" },
  { key: "invite.send", name: "Урилга илгээх" },
  { key: "ongod.edit", name: "Онгодын мод засах" },
  { key: "settings.manage", name: "Тохиргоо удирдах" },
  { key: "export.csv", name: "CSV экспорт" },
  { key: "audit.view", name: "Өөрчлөлтийн түүх харах" },
  { key: "import.run", name: "Импорт хийх" },
  { key: "role.view_as", name: "Түвшнээр харах" },
] as const;
export type PermKey = (typeof PERMISSIONS)[number]["key"];
