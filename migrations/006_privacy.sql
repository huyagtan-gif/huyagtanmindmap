-- Phase 2 (P2.8): хувийн мэдээллээ устгуулах хүсэлт (админ батална).

CREATE TABLE data_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Хүн устгагдсаны дараа ч хүсэлтийн бүртгэл үлдэнэ (хэн, хэзээ шийдвэрлэсэн): person_id NULL болно.
  person_id uuid REFERENCES person(id) ON DELETE SET NULL,
  urguu_id uuid NOT NULL REFERENCES urguu(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'delete' CHECK (kind IN ('delete')),
  note text,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','cancelled')),
  decided_by uuid REFERENCES person(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX data_request_one_pending ON data_request (person_id) WHERE state = 'pending';
ALTER TABLE data_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY data_request_scope ON data_request USING (urguu_id = app_urguu() OR person_id = app_person())
  WITH CHECK (urguu_id = app_urguu());
GRANT SELECT, INSERT, UPDATE ON data_request TO huyagtan_app;
CREATE TRIGGER data_request_notify AFTER INSERT OR UPDATE OR DELETE ON data_request FOR EACH ROW EXECUTE FUNCTION notify_trg();

-- Устгах хүсэлт шийдвэрлэх эрх: анхдагчаар Супер админ ба тохиргоо удирддаг (Админ) түвшинд.
INSERT INTO permission (role_id, urguu_id, key)
  SELECT r.id, r.urguu_id, 'data.request' FROM role r
  WHERE r.is_system OR EXISTS (SELECT 1 FROM permission p WHERE p.role_id = r.id AND p.key = 'settings.manage')
  ON CONFLICT DO NOTHING;

-- Хүнийг устгахад саад болдог (ON DELETE заагаагүй) гадаад түлхүүрүүдийг SET NULL болгоно:
-- шийдвэр гаргасан / үүсгэсэн хүн устсан ч бусад хүний бүртгэл хэвээр үлдэнэ.
ALTER TABLE membership DROP CONSTRAINT membership_decided_by_fkey, ADD CONSTRAINT membership_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES person(id) ON DELETE SET NULL;
ALTER TABLE invite DROP CONSTRAINT invite_created_by_fkey, ADD CONSTRAINT invite_created_by_fkey FOREIGN KEY (created_by) REFERENCES person(id) ON DELETE SET NULL;
ALTER TABLE status_history DROP CONSTRAINT status_history_changed_by_fkey, ADD CONSTRAINT status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES person(id) ON DELETE SET NULL;
ALTER TABLE import_batch DROP CONSTRAINT import_batch_created_by_fkey, ADD CONSTRAINT import_batch_created_by_fkey FOREIGN KEY (created_by) REFERENCES person(id) ON DELETE SET NULL;
ALTER TABLE import_issue DROP CONSTRAINT import_issue_resolved_by_fkey, ADD CONSTRAINT import_issue_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES person(id) ON DELETE SET NULL;
ALTER TABLE cross_urguu_grant DROP CONSTRAINT cross_urguu_grant_created_by_fkey, ADD CONSTRAINT cross_urguu_grant_created_by_fkey FOREIGN KEY (created_by) REFERENCES person(id) ON DELETE SET NULL;
ALTER TABLE person DROP CONSTRAINT person_merged_into_id_fkey, ADD CONSTRAINT person_merged_into_id_fkey FOREIGN KEY (merged_into_id) REFERENCES person(id) ON DELETE CASCADE;
