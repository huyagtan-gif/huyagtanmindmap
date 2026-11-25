-- Phase 3 (P3.1–P3.9): үйл ажиллагаа, сургалт, урилга / RSVP, QR ирц, төгсөлт, санал асуулга, сануулга.
-- Зочин = person (is_registered = false): тусдаа guest хүснэгт байхгүй (v2 §3.5).

-- ---------- Жагсаалтууд (өргөө тус бүр, админ удирдана) ----------
CREATE TABLE event_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  urguu_id uuid NOT NULL DEFAULT app_urguu() REFERENCES urguu(id) ON DELETE CASCADE,
  name text NOT NULL, sort int NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true
);
CREATE TABLE event_role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  urguu_id uuid NOT NULL DEFAULT app_urguu() REFERENCES urguu(id) ON DELETE CASCADE,
  name text NOT NULL, sort int NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true
);
INSERT INTO event_type (urguu_id, name, sort)
  SELECT u.id, x.name, x.sort FROM urguu u CROSS JOIN (VALUES ('Тахилга', 1), ('Золгох ёслол', 2), ('Уулзалт', 3), ('Бусад', 9)) AS x(name, sort);
INSERT INTO event_role (urguu_id, name, sort)
  SELECT u.id, x.name, x.sort FROM urguu u CROSS JOIN (VALUES ('Зохион байгуулагч', 1), ('Удирдагч', 2), ('Туслах', 3), ('Оролцогч', 4)) AS x(name, sort);

-- ---------- P3.1 Үйл ----------
CREATE TABLE event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  urguu_id uuid NOT NULL REFERENCES urguu(id) ON DELETE CASCADE,
  type_id uuid REFERENCES event_type(id) ON DELETE SET NULL,
  name text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  place text, description text,
  organizer_id uuid REFERENCES person(id) ON DELETE SET NULL,
  ongod_id uuid REFERENCES ongod(id) ON DELETE SET NULL,
  deedes_id uuid REFERENCES deedes(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned','done','cancelled')),
  -- Phase 4: нийтийн хандивын хуудасны код (/e/<код>) ба хандив авах эсэх
  public_code text UNIQUE,
  donations_open boolean NOT NULL DEFAULT false,
  reminded_at timestamptz,
  created_by uuid REFERENCES person(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_urguu_idx ON event (urguu_id, starts_at);
CREATE TABLE event_participant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  urguu_id uuid NOT NULL REFERENCES urguu(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  role_id uuid REFERENCES event_role(id) ON DELETE SET NULL,
  rsvp text NOT NULL DEFAULT 'yes' CHECK (rsvp IN ('invited','yes','no','maybe')),
  attended boolean,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, person_id)
);
CREATE INDEX event_participant_person_idx ON event_participant (person_id);

-- ---------- P3.2 Сургалт ----------
-- urguu_id = тэргүүлэх (хүлээн авагч) өргөө. Хамтарсан өргөөд training_urguu-д.
CREATE TABLE training (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  urguu_id uuid NOT NULL REFERENCES urguu(id) ON DELETE CASCADE,
  name text NOT NULL,
  topic text, description text,
  place text, online_url text,
  capacity int CHECK (capacity IS NULL OR capacity > 0),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('draft','open','closed','done','cancelled')),
  scope text NOT NULL DEFAULT 'members' CHECK (scope IN ('members','public')),
  reg_mode text NOT NULL DEFAULT 'invite' CHECK (reg_mode IN ('invite','open','both')),
  fee int NOT NULL DEFAULT 0 CHECK (fee >= 0),
  is_field boolean NOT NULL DEFAULT false,     -- «Хээрийн сургалт»: төгсвөл person.field_training = true
  survey_open boolean NOT NULL DEFAULT false,
  public_code text NOT NULL UNIQUE,            -- нийтийн бүртгэлийн хуудас /t/<код>
  created_by uuid REFERENCES person(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX training_urguu_idx ON training (urguu_id, created_at DESC);
CREATE TABLE training_urguu (
  training_id uuid NOT NULL REFERENCES training(id) ON DELETE CASCADE,
  urguu_id uuid NOT NULL REFERENCES urguu(id) ON DELETE CASCADE,
  is_lead boolean NOT NULL DEFAULT false,
  share_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (share_pct >= 0 AND share_pct <= 100),
  PRIMARY KEY (training_id, urguu_id)
);
CREATE TABLE training_teacher (
  training_id uuid NOT NULL REFERENCES training(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  PRIMARY KEY (training_id, person_id)
);
CREATE TABLE training_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_id uuid NOT NULL REFERENCES training(id) ON DELETE CASCADE,
  title text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  place text,
  qr_open boolean NOT NULL DEFAULT false,      -- P3.5: QR-аар ирц авч байгаа эсэх
  reminded_at timestamptz
);
CREATE INDEX training_session_idx ON training_session (training_id, starts_at);
-- Урилга + хариу + хүлээлгийн жагсаалт + төгсөлт (шаардлагын training_invite).
CREATE TABLE training_participant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_id uuid NOT NULL REFERENCES training(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'invited' CHECK (state IN ('invited','yes','no','maybe','waitlist','cancelled')),
  source text NOT NULL DEFAULT 'admin' CHECK (source IN ('invite','self','public','admin','qr')),
  invited_by uuid REFERENCES person(id) ON DELETE SET NULL,
  responded_at timestamptz,
  completion text CHECK (completion IN ('completed','incomplete')),
  pay_state text NOT NULL DEFAULT 'none' CHECK (pay_state IN ('none','pending','paid','refunded')),
  access_hash text UNIQUE,                     -- зочин өөрийн бүртгэлээ харах холбоосын токены hash
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (training_id, person_id)
);
CREATE INDEX training_participant_person_idx ON training_participant (person_id);
CREATE TABLE training_attendance (
  session_id uuid NOT NULL REFERENCES training_session(id) ON DELETE CASCADE,
  training_id uuid NOT NULL REFERENCES training(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  method text NOT NULL DEFAULT 'manual' CHECK (method IN ('qr','manual')),
  marked_by uuid REFERENCES person(id) ON DELETE SET NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, person_id)
);
CREATE INDEX training_attendance_person_idx ON training_attendance (person_id);
-- P3.6 Санал асуулга: нэг хүн нэг сургалтад нэг үнэлгээ.
CREATE TABLE training_survey (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_id uuid NOT NULL REFERENCES training(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (training_id, person_id)
);

-- ---------- RLS ----------
-- Сургалт: зохион байгуулагч бүх өргөө уншина (F11b), зөвхөн тэргүүлэх өргөө бичнэ.
CREATE FUNCTION training_in_scope(tid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM training t WHERE t.id = tid AND t.urguu_id = app_urguu())
      OR EXISTS (SELECT 1 FROM training_urguu tu WHERE tu.training_id = tid AND tu.urguu_id = app_urguu())
$$;
CREATE FUNCTION training_is_lead(tid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM training t WHERE t.id = tid AND t.urguu_id = app_urguu())
$$;
-- Хамтарсан сургалтын оролцогч өөр өргөөний хүн байж болно: зөвхөн НЭРИЙГ нь (нууц талбаргүй) буцаана.
CREATE FUNCTION training_people(tid uuid) RETURNS TABLE (person_id uuid, father_name text, given_name text, is_registered boolean, status_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.father_name, p.given_name, p.is_registered, p.status_id FROM person p
  WHERE training_in_scope(tid)
    AND p.id IN (SELECT tp.person_id FROM training_participant tp WHERE tp.training_id = tid
                 UNION SELECT tt.person_id FROM training_teacher tt WHERE tt.training_id = tid)
$$;

ALTER TABLE training ENABLE ROW LEVEL SECURITY;
CREATE POLICY training_read ON training FOR SELECT USING (training_in_scope(id));
CREATE POLICY training_write ON training USING (urguu_id = app_urguu()) WITH CHECK (urguu_id = app_urguu());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['training_urguu','training_teacher','training_session','training_participant','training_attendance','training_survey']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (training_in_scope(training_id))', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (training_is_lead(training_id)) WITH CHECK (training_is_lead(training_id))', t || '_write', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['event_type','event_role','event','event_participant']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (urguu_id = app_urguu()) WITH CHECK (urguu_id = app_urguu())', t || '_scope', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['event_type','event_role','event','event_participant','training','training_urguu','training_teacher',
    'training_session','training_participant','training_attendance','training_survey']
  LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_trg()', t || '_audit', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION notify_trg()', t || '_notify', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO huyagtan_app', t);
  END LOOP;
END $$;
-- Хүн өөрийн оролцоог (урилга, хариу, ирц) аль ч өргөөний контекстоос харна.
CREATE POLICY training_participant_self ON training_participant FOR SELECT USING (person_id = app_person());
CREATE POLICY training_attendance_self ON training_attendance FOR SELECT USING (person_id = app_person());

-- ---------- Эрх, харагдац ----------
-- Үйл, сургалт удирдах эрх: анхдагчаар Супер админ ба тохиргоо удирддаг (Админ) түвшинд.
INSERT INTO permission (role_id, urguu_id, key)
  SELECT r.id, r.urguu_id, k FROM role r CROSS JOIN unnest(ARRAY['event.manage','training.manage']) AS k
  WHERE r.is_system OR EXISTS (SELECT 1 FROM permission p WHERE p.role_id = r.id AND p.key = 'settings.manage')
  ON CONFLICT DO NOTHING;
-- P3.8: «Үйлээр» харагдац бүх түвшинд нээлттэй (админ хязгаарлаж болно).
INSERT INTO role_view (role_id, urguu_id, view) SELECT r.id, r.urguu_id, 'event' FROM role r ON CONFLICT DO NOTHING;

-- P3.4: нийтийн бүртгэлийн хуудасны SMS код.
ALTER TABLE phone_otp DROP CONSTRAINT phone_otp_purpose_check;
ALTER TABLE phone_otp ADD CONSTRAINT phone_otp_purpose_check CHECK (purpose IN ('verify','login','public'));
