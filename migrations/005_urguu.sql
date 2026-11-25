-- Phase 2 (P2.4, P2.5): олон өргөөний удирдлага, өргөө хоорондын харах эрх.

-- owner_urguu нь өөрийн хүмүүсийг grantee_urguu-ийн («Дэлхийн үрс харах» эрхтэй) гишүүдэд харуулахыг зөвшөөрнө.
-- Зөвхөн нийтэд нээлттэй талбар (нэр, төлөв, онгод); нууц талбар өргөө дамжиж хэзээ ч харагдахгүй.
CREATE TABLE cross_urguu_grant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_urguu_id uuid NOT NULL REFERENCES urguu(id) ON DELETE CASCADE,
  grantee_urguu_id uuid NOT NULL REFERENCES urguu(id) ON DELETE CASCADE,
  created_by uuid REFERENCES person(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_urguu_id, grantee_urguu_id),
  CHECK (owner_urguu_id <> grantee_urguu_id)
);
ALTER TABLE cross_urguu_grant ENABLE ROW LEVEL SECURITY;
CREATE POLICY cross_urguu_grant_read ON cross_urguu_grant FOR SELECT USING (owner_urguu_id = app_urguu() OR grantee_urguu_id = app_urguu());
CREATE POLICY cross_urguu_grant_write ON cross_urguu_grant USING (owner_urguu_id = app_urguu()) WITH CHECK (owner_urguu_id = app_urguu());
GRANT SELECT, INSERT, DELETE ON cross_urguu_grant TO huyagtan_app;
CREATE TRIGGER cross_urguu_grant_audit AFTER INSERT OR UPDATE OR DELETE ON cross_urguu_grant FOR EACH ROW EXECUTE FUNCTION audit_trg();
CREATE TRIGGER cross_urguu_grant_notify AFTER INSERT OR UPDATE OR DELETE ON cross_urguu_grant FOR EACH ROW EXECUTE FUNCTION notify_trg();

-- «Дэлхийн үрс» харагдацын эрх: анхдагчаар Супер админ ба бүх үйлдлийн эрхтэй (Админ) түвшинд.
INSERT INTO permission (role_id, urguu_id, key)
  SELECT r.id, r.urguu_id, 'world.view' FROM role r
  WHERE r.is_system OR EXISTS (SELECT 1 FROM permission p WHERE p.role_id = r.id AND p.key = 'settings.manage')
  ON CONFLICT DO NOTHING;
