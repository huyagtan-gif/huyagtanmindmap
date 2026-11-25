-- Phase 4: төлбөр (QPay), хандив, буцаалт, тулгалт.
-- Мөнгөтэй холбоотой бүх бичилт системийн транзакцаар (сервер талын шалгалтын дараа) явна:
-- апп-ын role төлбөрийн мөрийг зөвхөн УНШИНА, тохиргооны (нууц түлхүүр) хүснэгтэд огт хүрэхгүй.

-- P4.1 Өргөө бүрийн QPay merchant тохиргоо. Нууц үг AES-256-GCM-ээр шифрлэгдсэн (lib/secret.ts).
CREATE TABLE urguu_payment_config (
  urguu_id uuid PRIMARY KEY REFERENCES urguu(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'qpay' CHECK (provider IN ('qpay')),
  base_url text NOT NULL DEFAULT 'https://merchant.qpay.mn',
  username text,
  password_enc text,
  invoice_code text,
  enabled boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES person(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON urguu_payment_config FROM huyagtan_app;

-- P4.2 / P4.4 Төлбөр ба хандив нэг хүснэгтэд.
CREATE TABLE payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  urguu_id uuid NOT NULL REFERENCES urguu(id),              -- хүлээн авагч өргөө (хамтарсан сургалтад тэргүүлэх өргөө)
  kind text NOT NULL CHECK (kind IN ('training','donation')),
  method text NOT NULL DEFAULT 'qpay' CHECK (method IN ('qpay','manual')),
  amount int NOT NULL CHECK (amount > 0),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','paid','refunded','cancelled','expired')),
  payer_person_id uuid REFERENCES person(id) ON DELETE SET NULL,
  payer_name text,                                          -- гишүүн бус хандивлагч (заавал биш)
  anonymous boolean NOT NULL DEFAULT false,                 -- «нэрээ нууцлах»
  message text,
  training_id uuid REFERENCES training(id) ON DELETE SET NULL,
  participant_id uuid REFERENCES training_participant(id) ON DELETE SET NULL,
  event_id uuid REFERENCES event(id) ON DELETE SET NULL,
  sender_invoice_no text NOT NULL UNIQUE,                   -- манай талын давтагдашгүй дугаар (idempotency)
  qpay_invoice_id text UNIQUE,
  qpay_payment_id text,
  qr_text text, short_url text, deeplinks jsonb,
  access_hash text UNIQUE,                                  -- нэвтрээгүй төлөгчийн нууц холбоос (hash)
  paid_at timestamptz, verified_at timestamptz,
  refunded_at timestamptz, refund_note text, refunded_by uuid REFERENCES person(id) ON DELETE SET NULL,
  note text,
  created_by uuid REFERENCES person(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'training' OR training_id IS NOT NULL OR state <> 'pending')
);
-- Нэг оролцогчид нэг л хүлээгдэж буй нэхэмжлэх (давхар дарахад шинэ нэхэмжлэх үүсэхгүй).
CREATE UNIQUE INDEX payment_one_pending_uq ON payment (participant_id) WHERE state = 'pending' AND participant_id IS NOT NULL;
CREATE INDEX payment_urguu_idx ON payment (urguu_id, created_at DESC);
CREATE INDEX payment_pending_idx ON payment (created_at) WHERE state = 'pending';
CREATE INDEX payment_event_idx ON payment (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX payment_training_idx ON payment (training_id) WHERE training_id IS NOT NULL;

ALTER TABLE payment ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_read ON payment FOR SELECT USING (urguu_id = app_urguu() OR payer_person_id = app_person());
GRANT SELECT ON payment TO huyagtan_app;
CREATE TRIGGER payment_audit AFTER INSERT OR UPDATE OR DELETE ON payment FOR EACH ROW EXECUTE FUNCTION audit_trg();
CREATE TRIGGER payment_notify AFTER INSERT OR UPDATE OR DELETE ON payment FOR EACH ROW EXECUTE FUNCTION notify_trg();
CREATE TRIGGER payment_touch BEFORE UPDATE ON payment FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
-- Тохиргооны өөрчлөлтийг (нууц утгагүйгээр) апп өөрөө audit_log-д бичнэ.

-- P4.3 Өдөр бүрийн тулгалтын тайлан.
CREATE TABLE payment_recon (
  id serial PRIMARY KEY,
  day date NOT NULL UNIQUE,
  checked int NOT NULL DEFAULT 0,
  fixed int NOT NULL DEFAULT 0,
  mismatches jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON payment_recon FROM huyagtan_app;

-- P4.6 Хамтрагч өргөө тэргүүлэх өргөөний төлбөрийн мөрийг уншихгүй: зөвхөн нэгтгэсэн дүн ба өөрийн хувийг энэ функцээр авна.
CREATE FUNCTION training_share_report(d_from timestamptz, d_to timestamptz)
RETURNS TABLE (training_id uuid, training_name text, lead_urguu text, share_pct numeric, paid_count int, gross bigint, refunded bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.name, u.name, tu.share_pct,
    count(*) FILTER (WHERE p.state = 'paid')::int,
    coalesce(sum(p.amount) FILTER (WHERE p.state = 'paid'), 0)::bigint,
    coalesce(sum(p.amount) FILTER (WHERE p.state = 'refunded'), 0)::bigint
  FROM training_urguu tu JOIN training t ON t.id = tu.training_id JOIN urguu u ON u.id = t.urguu_id
  LEFT JOIN payment p ON p.training_id = t.id AND p.kind = 'training' AND p.state IN ('paid','refunded') AND p.created_at >= d_from AND p.created_at < d_to
  WHERE tu.urguu_id = app_urguu() AND NOT tu.is_lead
  GROUP BY t.id, t.name, u.name, tu.share_pct
$$;
GRANT EXECUTE ON FUNCTION training_share_report(timestamptz, timestamptz) TO huyagtan_app;

-- Өргөөний нэр нууц биш: тайланд хамтрагч өргөөний нэрийг харуулахад хэрэглэнэ.
CREATE FUNCTION urguu_names() RETURNS TABLE (id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT id, name FROM urguu $$;
GRANT EXECUTE ON FUNCTION urguu_names() TO huyagtan_app;

-- Эрх: санхүүгийн тайлан, төлбөрийн тохиргоо — Супер админ ба тохиргоо удирддаг түвшинд.
INSERT INTO permission (role_id, urguu_id, key)
  SELECT r.id, r.urguu_id, k FROM role r CROSS JOIN unnest(ARRAY['finance.view','payment.manage']) AS k
  WHERE r.is_system OR EXISTS (SELECT 1 FROM permission p WHERE p.role_id = r.id AND p.key = 'settings.manage')
  ON CONFLICT DO NOTHING;
