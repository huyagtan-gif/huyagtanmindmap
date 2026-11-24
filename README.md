# Хуягтан Mind Map

Хуягтан өргөөний бүртгэл, онгодын mind map. https://huyagtan.mn дээр ажиллана.
Шаардлага: «Хуягтан Mind Map систем: Шаардлага v2.0». Энэ репо Phase 1 (MVP)-ийг агуулна.

## Технологи

- Next.js 15 (App Router, standalone) + TypeScript, нэг процесс
- PostgreSQL 16: SQL миграци (`migrations/`), RLS (өргөөгөөр тусгаарлалт), audit trigger
- Auth.js: имэйлийн нэг удаагийн холбоос + Google (сешн DB-д)
- UI: prototype-ийн design system (`app/globals.css`)

## Бүтэц

| Зам | Агуулга |
|---|---|
| `migrations/*.sql` | Схем, RLS, trigger, анхдагч өгөгдөл |
| `lib/db.ts` | `withCtx` (хүсэлт бүр `huyagtan_app` role + `app.urguu_id`), `sys` (системийн) |
| `lib/viewer.ts` | Нэвтэрсэн хүн, өргөө, түвшин, эрх; «Түвшнээр харах» |
| `lib/project.ts` | **Талбарын шүүлт нэг газар**: `projectPerson(person, viewer)` |
| `lib/import.ts`, `lib/norm.ts` | Google Sheet импорт, нэр/онгод тулгах |
| `app/(app)/` | Mind map, Хүмүүс, Миний мэдээлэл, Админ самбар |
| `app/actions/` | Server actions (бүх бичих үйлдэл, эрх шалгалттай) |
| `deploy/` | Серверийн тохиргоо, нөөцлөлт: [deploy/README.md](deploy/README.md) |

## Локал дээр ажиллуулах

```bash
createdb huyagtan_dev                       # PostgreSQL 16
cp .env.example .env.local                  # DATABASE_URL, AUTH_SECRET, SUPER_ADMIN_EMAIL-ийг бөглөнө
npm install
npm run migrate                             # DATABASE_URL=... шаардана
npm run dev
```

`EMAIL_SERVER` хоосон үед нэвтрэх холбоос терминалд (`[mail:dev] ... link=`) хэвлэгдэнэ.

## Тест

```bash
npm test                                                             # нэгж тест
TEST_DATABASE_URL=postgres://.../huyagtan_test npm test              # + RLS, audit, импорт (хоосон сан дээр)
```

Хувийн мэдээлэлтэй файл (Google Sheet-ийн экспорт г.м.) энэ репод **орохгүй**. Импортыг апп дотроос хийнэ.
