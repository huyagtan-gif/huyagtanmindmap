-- Phase 2 (P2.7, P2.3): мэдэгдлийн дараалал (дахин оролдлоготой) ба SMS нэг удаагийн код.

-- ---------- P2.7 Outbox ----------
-- queued: илгээхийг хүлээж буй (эсвэл дахин оролдох). sent: илгээгдсэн. failed: оролдлого дууссан / дахин оролдохгүй.
ALTER TABLE notification_outbox
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN urguu_id uuid REFERENCES urguu(id) ON DELETE SET NULL;
CREATE INDEX notification_outbox_due_idx ON notification_outbox (next_attempt_at) WHERE state = 'queued';
-- Хүлээн авагчийн хаяг агуулдаг тул зөвхөн системийн холболт уншиж, бичнэ (өргөөний RLS-гүй хүснэгт).
REVOKE ALL ON notification_outbox FROM huyagtan_app;

-- ---------- P2.3 SMS OTP ----------
-- Кодыг ил хадгалахгүй (hash). Апп-ын role-д эрх олгохгүй: зөвхөн системийн холболт.
CREATE TABLE phone_otp (
  id bigserial PRIMARY KEY,
  phone text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('verify','login')),
  person_id uuid REFERENCES person(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX phone_otp_lookup_idx ON phone_otp (phone, purpose, id DESC);

-- Баталгаажсан утас платформ даяар давхардахгүй (SMS-ээр нэвтрэхэд хүнийг нэг мөр тодорхойлно).
CREATE UNIQUE INDEX person_private_phone_verified_uq ON person_private (phone) WHERE phone_verified;

-- Утас / имэйл солигдвол баталгаажуулалт хүчингүй болно.
CREATE FUNCTION person_private_verify_reset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.phone IS DISTINCT FROM OLD.phone THEN NEW.phone_verified := false; END IF;
  IF lower(NEW.email) IS DISTINCT FROM lower(OLD.email) THEN NEW.email_verified := false; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER person_private_verify_reset BEFORE UPDATE ON person_private FOR EACH ROW EXECUTE FUNCTION person_private_verify_reset();
