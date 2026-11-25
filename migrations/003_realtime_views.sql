-- Phase 2 (P2.1, P2.2): realtime дохио ба шинэ харагдацуудын эрх.

-- A3: NOTIFY-д зөвхөн {entity, id, urguu_id} явна. Өгөгдөл энэ сувгаар хэзээ ч явахгүй;
-- клиент дохио аваад эрхээр шүүсэн API-аас дахин татна.
CREATE FUNCTION notify_trg() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN r := to_jsonb(OLD); ELSE r := to_jsonb(NEW); END IF;
  PERFORM pg_notify('huyagtan', json_build_object(
    'entity', TG_TABLE_NAME,
    'id', coalesce(r->>'id', r->>'person_id', r->>'role_id'),
    -- urguu_id баганагүй (платформын түвшний) хүснэгтэд тухайн хүсэлтийн өргөө; байхгүй бол NULL = бүх өргөө.
    'urguu_id', coalesce(nullif(r->>'urguu_id', ''), nullif(current_setting('app.urguu_id', true), ''))
  )::text);
  RETURN NULL;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['person','person_private','person_alias','huyag','person_ongod','person_deedes','relation',
    'membership','ongod','deedes','urguu_deedes','role','permission','role_view','field_permission','status','knowledge_level',
    'huyag_type','era','relation_type','form_question','invite','import_issue','urguu']
  LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION notify_trg()', t || '_notify', t);
  END LOOP;
END $$;

-- role_view-ийн өөрчлөлт ч audit-д орно (Phase 1-д орхигдсон).
CREATE TRIGGER role_view_audit AFTER INSERT OR UPDATE OR DELETE ON role_view FOR EACH ROW EXECUTE FUNCTION audit_trg();

-- P2.2: шинэ харагдацууд анхдагчаар бүх түвшинд нээлттэй. Админ «Тохиргоо → Түвшин, эрх»-ээс хязгаарлана.
INSERT INTO role_view (role_id, urguu_id, view)
  SELECT r.id, r.urguu_id, v FROM role r CROSS JOIN unnest(ARRAY['era','net','deedes','ego']) AS v
  ON CONFLICT DO NOTHING;
