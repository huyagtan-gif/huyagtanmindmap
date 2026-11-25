-- Phase 5: сертификат, push мэдэгдэл.

-- Сертификат: «Дүүргэсэн» болсон оролцогчид дугаар ба шалгах код олгоно (/certificate/<код>).
CREATE SEQUENCE certificate_seq;
ALTER TABLE training_participant
  ADD COLUMN certificate_no text UNIQUE,
  ADD COLUMN certificate_code text UNIQUE,
  ADD COLUMN certificate_at timestamptz;
GRANT USAGE ON SEQUENCE certificate_seq TO huyagtan_app;

-- Сургалт дүүргэхэд сертификатыг автоматаар олгоно (дугаар нэг л удаа, дахин «Дүүргэсэн» болгоход хэвээр).
CREATE FUNCTION certificate_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.completion = 'completed' AND NEW.certificate_no IS NULL THEN
    NEW.certificate_no := 'ХТ-' || to_char(now() AT TIME ZONE 'Asia/Ulaanbaatar', 'YYYY') || '-' || lpad(nextval('certificate_seq')::text, 5, '0');
    NEW.certificate_code := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
    NEW.certificate_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER training_participant_certificate BEFORE INSERT OR UPDATE OF completion ON training_participant
  FOR EACH ROW EXECUTE FUNCTION certificate_trg();
UPDATE training_participant SET completion = completion WHERE completion = 'completed';

-- Web Push (VAPID). Мэдэгдлийн агуулгыг push үйлчилгээгээр дамжуулахгүй (payload-гүй): service worker
-- нэвтэрсэн хэрэглэгчийн хүлээгдэж буй мессежийг өөрөө татна (A3: өгөгдөл гуравдагч сувгаар явахгүй).
CREATE TABLE push_subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_ok_at timestamptz,
  failures int NOT NULL DEFAULT 0
);
CREATE INDEX push_subscription_person_idx ON push_subscription (person_id);
CREATE TABLE push_message (
  id bigserial PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  title text NOT NULL, body text NOT NULL, url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX push_message_pending_idx ON push_message (person_id, id) WHERE delivered_at IS NULL;
REVOKE ALL ON push_subscription, push_message FROM huyagtan_app;
