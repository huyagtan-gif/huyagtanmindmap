-- Хуягтан: анхны схем (шаардлага v2 §3.1–3.5). Олон өргөөтэй, RLS, audit trigger.

-- Апп-ын хүсэлт бүр энэ role-оор (SET LOCAL ROLE) ажиллаж, RLS үйлчилнэ.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huyagtan_app') THEN
    CREATE ROLE huyagtan_app NOLOGIN;
  END IF;
END $$;
DO $$ BEGIN
  EXECUTE format('GRANT huyagtan_app TO %I', current_user);
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE FUNCTION app_urguu() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.urguu_id', true), '')::uuid $$;
CREATE FUNCTION app_person() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.person_id', true), '')::uuid $$;

-- ---------- Платформын түвшний жагсаалтууд (D37, D44) ----------
CREATE TABLE status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  pal int NOT NULL DEFAULT 0,
  shape text NOT NULL DEFAULT 'dot',
  description text,
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE knowledge_level (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, sort int NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true
);
CREATE TABLE huyag_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, sort int NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true
);
CREATE TABLE era (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, sort int NOT NULL DEFAULT 0, color text, active boolean NOT NULL DEFAULT true
);
CREATE TABLE relation_type (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE, name text NOT NULL, sort int NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true
);
CREATE TABLE deedes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, description text, sort int NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true
);

-- ---------- Өргөө, хүн, гишүүнчлэл ----------
CREATE TABLE urguu (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, description text,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE person (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clan_name text, father_name text, given_name text NOT NULL,
  ongod_nickname text, ulaach_name text,
  status_id uuid REFERENCES status(id),
  knowledge_level_id uuid REFERENCES knowledge_level(id),
  field_training boolean, sutra boolean,
  info_source text, comment text, suggestion text, teacher_note text,
  huyag_today text,
  is_registered boolean NOT NULL DEFAULT true,
  merged_into_id uuid REFERENCES person(id),
  created_urguu_id uuid REFERENCES urguu(id),
  form_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE person_private (
  person_id uuid PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE,
  phone text, email text, facebook text,
  phone_verified boolean NOT NULL DEFAULT false,
  email_verified boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX person_private_email_uq ON person_private (lower(email)) WHERE email IS NOT NULL;
CREATE TABLE person_alias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  alias text NOT NULL, norm text NOT NULL,
  UNIQUE (person_id, norm)
);
CREATE INDEX person_alias_norm_idx ON person_alias (norm);

-- Auth.js (pg adapter) хүснэгтүүд. users = шаардлагын app_user.
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255), email VARCHAR(255), "emailVerified" TIMESTAMPTZ, image TEXT,
  person_id uuid UNIQUE REFERENCES person(id) ON DELETE SET NULL,
  is_platform_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE TABLE accounts (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(255) NOT NULL, provider VARCHAR(255) NOT NULL, "providerAccountId" VARCHAR(255) NOT NULL,
  refresh_token TEXT, access_token TEXT, expires_at BIGINT, id_token TEXT, scope TEXT, session_state TEXT, token_type TEXT
);
CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires TIMESTAMPTZ NOT NULL, "sessionToken" VARCHAR(255) NOT NULL UNIQUE
);
CREATE TABLE verification_token (
  identifier TEXT NOT NULL, expires TIMESTAMPTZ NOT NULL, token TEXT NOT NULL,
  PRIMARY KEY (identifier, token)
);

CREATE TABLE role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  urguu_id uuid NOT NULL REFERENCES urguu(id) ON DELETE CASCADE,
  name text NOT NULL, sort int NOT NULL DEFAULT 0,
  is_system boolean NOT NULL DEFAULT false
);
CREATE TABLE permission (
  role_id uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  urguu_id uuid NOT NULL REFERENCES urguu(id) ON DELETE CASCADE,
  key text NOT NULL,
  PRIMARY KEY (role_id, key)
);
CREATE TABLE role_view (
  role_id uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  urguu_id uuid NOT NULL REFERENCES urguu(id) ON DELETE CASCADE,
  view text NOT NULL,
  PRIMARY KEY (role_id, view)
);
CREATE TABLE field_permission (
  urguu_id uuid NOT NULL REFERENCES urguu(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  role_id uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  PRIMARY KEY (urguu_id, field_key, role_id)
);

CREATE TABLE membership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  urguu_id uuid NOT NULL REFERENCES urguu(id) ON DELETE CASCADE,
  role_id uuid REFERENCES role(id),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','closed')),
  decided_by uuid REFERENCES person(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, urguu_id)
);

-- ---------- Онгод, дээдэс, хуяг ----------
CREATE TABLE ongod (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  urguu_id uuid NOT NULL REFERENCES urguu(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES ongod(id),
  name text NOT NULL,
  era_id uuid REFERENCES era(id),
  title text, note text,
  kind text NOT NULL DEFAULT 'ongod' CHECK (kind IN ('group','ongod')),
  needs_review boolean NOT NULL DEFAULT false,
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ongod_urguu_idx ON ongod (urguu_id, parent_id);
CREATE TABLE person_ongod (
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  ongod_id uuid NOT NULL REFERENCES ongod(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false, sort int NOT NULL DEFAULT 0,
  PRIMARY KEY (person_id, ongod_id)
);
CREATE TABLE urguu_deedes (
  urguu_id uuid NOT NULL REFERENCES urguu(id) ON DELETE CASCADE,
  deedes_id uuid NOT NULL REFERENCES deedes(id) ON DELETE CASCADE,
  PRIMARY KEY (urguu_id, deedes_id)
);
CREATE TABLE person_deedes (
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  deedes_id uuid NOT NULL REFERENCES deedes(id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, deedes_id)
);
CREATE TABLE huyag (
  person_id uuid PRIMARY KEY REFERENCES person(id) ON DELETE CASCADE,
  met_teacher_on date, huyag_on date,
  huyag_type_id uuid REFERENCES huyag_type(id),
  note text
);

-- ---------- Хүн хоорондын холбоо (D38) ----------
-- from_person = тухайн хүн, to_person = түүний багш / танилцуулсан / түшсэн / мэдээлэл өгдөг хүн
CREATE TABLE relation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  to_person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  type_id uuid NOT NULL REFERENCES relation_type(id),
  note text,
  UNIQUE (from_person_id, to_person_id, type_id)
);
CREATE INDEX relation_to_idx ON relation (to_person_id);

-- ---------- Форм ----------
CREATE TABLE form_question (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  urguu_id uuid REFERENCES urguu(id) ON DELETE CASCADE,  -- NULL = үндсэн (нийтлэг)
  text text NOT NULL,
  type text NOT NULL DEFAULT 'text' CHECK (type IN ('text','longtext','yesno','choice','date')),
  options jsonb,
  required boolean NOT NULL DEFAULT false,
  sort int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE form_answer (
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES form_question(id) ON DELETE CASCADE,
  urguu_id uuid NOT NULL REFERENCES urguu(id) ON DELETE CASCADE,
  value text,
  PRIMARY KEY (person_id, question_id)
);

CREATE TABLE invite (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  urguu_id uuid NOT NULL REFERENCES urguu(id) ON DELETE CASCADE,
  email text NOT NULL,
  role_id uuid NOT NULL REFERENCES role(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_by uuid REFERENCES person(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Систем ----------
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor_user_id int, actor_person_id uuid, urguu_id uuid,
  entity text NOT NULL, entity_id text, action text NOT NULL,
  before jsonb, after jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_urguu_at_idx ON audit_log (urguu_id, at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);

CREATE TABLE status_history (
  id bigserial PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  old_status_id uuid REFERENCES status(id),
  new_status_id uuid REFERENCES status(id),
  changed_by uuid REFERENCES person(id),
  note text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notification_outbox (
  id bigserial PRIMARY KEY,
  channel text NOT NULL DEFAULT 'email',
  recipient text NOT NULL, template text NOT NULL, payload jsonb,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','sent','failed')),
  attempts int NOT NULL DEFAULT 0, last_error text,
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz
);
CREATE TABLE import_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  urguu_id uuid NOT NULL REFERENCES urguu(id) ON DELETE CASCADE,
  source text NOT NULL, checksum text NOT NULL,
  row_count int NOT NULL DEFAULT 0, created_count int NOT NULL DEFAULT 0,
  created_by uuid REFERENCES person(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE import_issue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES import_batch(id) ON DELETE CASCADE,
  urguu_id uuid NOT NULL REFERENCES urguu(id) ON DELETE CASCADE,
  person_id uuid REFERENCES person(id) ON DELETE CASCADE,
  kind text NOT NULL, message text NOT NULL, data jsonb,
  resolved_at timestamptz, resolved_by uuid REFERENCES person(id), resolution text
);
CREATE TABLE consent (
  id bigserial PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  version text NOT NULL, at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Триггерүүд ----------
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER person_touch BEFORE UPDATE ON person FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- A4: бүх өөрчлөлт audit_log-д. SECURITY DEFINER: апп-ын role audit_log руу шууд бичих эрхгүй.
CREATE FUNCTION audit_trg() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b jsonb; a jsonb; eid text; uid uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN b := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN a := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND (a - 'updated_at') = (b - 'updated_at') THEN RETURN NEW; END IF;
  eid := coalesce(coalesce(a, b)->>'id', coalesce(a, b)->>'person_id', coalesce(a, b)->>'role_id');
  uid := coalesce(nullif(coalesce(a, b)->>'urguu_id', '')::uuid, app_urguu());
  INSERT INTO audit_log (actor_user_id, actor_person_id, urguu_id, entity, entity_id, action, before, after)
  VALUES (nullif(current_setting('app.user_id', true), '')::int, app_person(), uid, TG_TABLE_NAME, eid, lower(TG_OP), b, a);
  RETURN coalesce(NEW, OLD);
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['person','person_private','person_alias','huyag','person_ongod','person_deedes','relation',
    'membership','ongod','deedes','urguu_deedes','role','permission','field_permission','status','knowledge_level',
    'huyag_type','era','relation_type','form_question','form_answer','invite','urguu']
  LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_trg()', t || '_audit', t);
  END LOOP;
END $$;

CREATE FUNCTION status_history_trg() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status_id IS NOT NULL THEN
      INSERT INTO status_history (person_id, old_status_id, new_status_id, changed_by) VALUES (NEW.id, NULL, NEW.status_id, app_person());
    END IF;
  ELSIF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    INSERT INTO status_history (person_id, old_status_id, new_status_id, changed_by) VALUES (NEW.id, OLD.status_id, NEW.status_id, app_person());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER person_status_history AFTER INSERT OR UPDATE OF status_id ON person FOR EACH ROW EXECUTE FUNCTION status_history_trg();

-- ---------- RLS (A2: хоёр дахь хамгаалалт) ----------
-- Хүн платформ даяар нэг (D37) тул өргөөнд харагдах нөхцөл: тухайн өргөөнд гишүүнчлэлтэй, эсвэл тэнд үүссэн, эсвэл өөрөө.
-- SECURITY DEFINER туслах функцууд: policy доторх дэд хүсэлт RLS-ийн рекурс үүсгэхээс сэргийлнэ.
CREATE FUNCTION person_is_member(pid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM membership m WHERE m.person_id = pid AND m.urguu_id = app_urguu())
$$;
CREATE FUNCTION person_in_scope(pid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pid = app_person()
      OR EXISTS (SELECT 1 FROM person p WHERE p.id = pid AND p.created_urguu_id = app_urguu())
      OR person_is_member(pid)
$$;

ALTER TABLE person ENABLE ROW LEVEL SECURITY;
CREATE POLICY person_scope ON person
  USING (id = app_person() OR created_urguu_id = app_urguu() OR person_is_member(id))
  WITH CHECK (id = app_person() OR created_urguu_id = app_urguu() OR person_is_member(id));

DO $$
DECLARE t text;
BEGIN
  -- person-д харьяалагдах хүснэгтүүд
  FOREACH t IN ARRAY ARRAY['person_private','person_alias','huyag','person_ongod','person_deedes','status_history','consent']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (person_in_scope(person_id)) WITH CHECK (person_in_scope(person_id))', t || '_scope', t);
  END LOOP;
  -- urguu_id баганатай хүснэгтүүд
  FOREACH t IN ARRAY ARRAY['ongod','role','permission','role_view','field_permission','form_answer','invite','import_batch','import_issue','urguu_deedes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (urguu_id = app_urguu()) WITH CHECK (urguu_id = app_urguu())', t || '_scope', t);
  END LOOP;
END $$;

ALTER TABLE relation ENABLE ROW LEVEL SECURITY;
CREATE POLICY relation_scope ON relation USING (person_in_scope(from_person_id)) WITH CHECK (person_in_scope(from_person_id));

ALTER TABLE membership ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_scope ON membership USING (urguu_id = app_urguu() OR person_id = app_person())
  WITH CHECK (urguu_id = app_urguu());

ALTER TABLE urguu ENABLE ROW LEVEL SECURITY;
CREATE POLICY urguu_scope ON urguu USING (id = app_urguu());

ALTER TABLE form_question ENABLE ROW LEVEL SECURITY;
CREATE POLICY form_question_scope ON form_question USING (urguu_id IS NULL OR urguu_id = app_urguu())
  WITH CHECK (urguu_id = app_urguu());

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_scope ON audit_log FOR SELECT USING (urguu_id = app_urguu());

-- ---------- Апп-ын role-ийн эрх ----------
GRANT USAGE ON SCHEMA public TO huyagtan_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  person, person_private, person_alias, membership, ongod, person_ongod, urguu_deedes, person_deedes, huyag, relation,
  role, permission, role_view, field_permission, form_question, form_answer, invite, import_batch, import_issue,
  status, knowledge_level, huyag_type, era, relation_type, deedes
  TO huyagtan_app;
GRANT SELECT ON urguu, audit_log, status_history TO huyagtan_app;
GRANT SELECT, INSERT ON consent, notification_outbox TO huyagtan_app;
GRANT UPDATE ON notification_outbox TO huyagtan_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO huyagtan_app;
-- users / accounts / sessions / verification_token: апп-ын role-д эрх олгохгүй (зөвхөн системийн холболт).
