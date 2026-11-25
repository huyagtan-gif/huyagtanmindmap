-- Phase 2 (P2.9): алдааны хяналт. Серверийн, дэвсгэр ажилчны, хөтчийн алдааг давхардуулалгүй (fingerprint) хадгална.
-- Хувийн мэдээлэл хадгалахгүй: зөвхөн route-ийн загвар (жишээ /people/[id]) ба цэвэрлэсэн алдааны текст.
CREATE TABLE error_log (
  id          bigserial PRIMARY KEY,
  fingerprint text NOT NULL UNIQUE,
  source      text NOT NULL CHECK (source IN ('server','worker','client')),
  message     text NOT NULL,
  stack       text,
  route       text,
  digest      text,
  build       text,
  count       int NOT NULL DEFAULT 1,
  first_at    timestamptz NOT NULL DEFAULT now(),
  last_at     timestamptz NOT NULL DEFAULT now(),
  alerted_at  timestamptz
);
CREATE INDEX error_log_last_idx ON error_log (last_at DESC);
-- Зөвхөн системийн холболт уншиж, бичнэ (платформын супер админы хуудас).
REVOKE ALL ON error_log FROM huyagtan_app;
