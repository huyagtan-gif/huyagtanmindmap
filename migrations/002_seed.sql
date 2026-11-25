-- Анхдагч өгөгдөл (P1.2). Хувийн мэдээлэл агуулаагүй.
INSERT INTO status (name, pal, shape, description, sort) VALUES
  ('Waiting list', 0, 'dash',  'Сургалт, уулзалтаас ирсэн шинэ хүн', 1),
  ('Золгуулах',    1, 'clock', 'Багштай золгохоор хүлээж буй', 2),
  ('Тодлох',       2, 'half',  'Хуяглахад бэлтгэж буй', 3),
  ('Хуягласан',    3, 'check', 'Жинхэлсэн гишүүд', 4);

INSERT INTO knowledge_level (name, sort) VALUES
  ('Одоогоор сайн мэдлэггүй байгаа', 1),
  ('Сүүлийн үеэс эхлэн сонирхон судалж байгаа', 2),
  ('Олон жилийн туршлага мэдлэг, туршлагатай', 3);

INSERT INTO huyag_type (name, sort) VALUES ('Биет хуяг', 1), ('Хий хуяг', 2);

INSERT INTO era (name, sort, color) VALUES
  ('Хүннү', 1, '#0E7490'), ('Их Монгол', 2, '#1E4FA0'), ('Их Юань', 3, '#6E3FB0'),
  ('Бага хаад', 4, '#B06A08'), ('Эртний', 5, '#19794E'), ('Тодорхой бус', 6, '#6B7585');

INSERT INTO relation_type (key, name, sort) VALUES
  ('teacher', 'Багш–шавь', 1), ('introducer', 'Танилцуулсан', 2), ('supporter', 'Түшсэн', 3), ('informant', 'Мэдээлэл өгдөг', 4);

DO $$
DECLARE
  u uuid; r_super uuid; r_admin uuid; r_teacher uuid; r_member uuid; d uuid;
  all_perms text[] := ARRAY['person.view','person.edit','person.merge','member.approve','invite.send','settings.manage',
    'ongod.edit','status.change','export.csv','audit.view','import.run','role.view_as'];
  k text; rid uuid; f text;
BEGIN
  INSERT INTO urguu (name, description) VALUES ('Хуягтан өргөө', 'Эхний өргөө') RETURNING id INTO u;
  INSERT INTO role (urguu_id, name, sort, is_system) VALUES (u, 'Супер админ', 1, true) RETURNING id INTO r_super;
  INSERT INTO role (urguu_id, name, sort) VALUES (u, 'Админ', 2) RETURNING id INTO r_admin;
  INSERT INTO role (urguu_id, name, sort) VALUES (u, 'Багш', 3) RETURNING id INTO r_teacher;
  INSERT INTO role (urguu_id, name, sort) VALUES (u, 'Гишүүн', 4) RETURNING id INTO r_member;

  FOREACH k IN ARRAY all_perms LOOP
    INSERT INTO permission (role_id, urguu_id, key) VALUES (r_super, u, k), (r_admin, u, k);
  END LOOP;
  INSERT INTO permission (role_id, urguu_id, key) VALUES
    (r_teacher, u, 'person.view'), (r_teacher, u, 'person.edit'), (r_teacher, u, 'status.change'),
    (r_member, u, 'person.view');

  FOREACH rid IN ARRAY ARRAY[r_super, r_admin, r_teacher, r_member] LOOP
    INSERT INTO role_view (role_id, urguu_id, view) VALUES (rid, u, 'tree'), (rid, u, 'kanban');
  END LOOP;

  -- Талбарын эрх (шаардлага §4)
  FOREACH f IN ARRAY ARRAY['phone','email','facebook','donation'] LOOP
    INSERT INTO field_permission (urguu_id, field_key, role_id) VALUES (u, f, r_super), (u, f, r_admin);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['teacher_note','comment','suggestion'] LOOP
    INSERT INTO field_permission (urguu_id, field_key, role_id) VALUES (u, f, r_super), (u, f, r_admin), (u, f, r_teacher);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['ulaach','knowledge','huyag_dates'] LOOP
    INSERT INTO field_permission (urguu_id, field_key, role_id) VALUES (u, f, r_super), (u, f, r_admin), (u, f, r_teacher), (u, f, r_member);
  END LOOP;

  INSERT INTO deedes (name) VALUES ('Хөхүдэй Мөргүн Дээдэс') RETURNING id INTO d;
  INSERT INTO urguu_deedes (urguu_id, deedes_id) VALUES (u, d);

  -- Онгодын лавлах мод (prototype-ийн мод; админ самбараас засна)
  CREATE TEMP TABLE _o (k text PRIMARY KEY, pk text, name text, era text, kind text, sort serial, id uuid DEFAULT gen_random_uuid());
  INSERT INTO _o (k, pk, name, era, kind) VALUES
    ('k1', NULL, 'Их Монгол Улс · Чингис хаан', 'Их Монгол', 'group'),
    ('g1', 'k1', 'Хатад', NULL, 'group'), ('o1', 'g1', 'Бялхавч хатан', NULL, 'ongod'), ('o2', 'g1', 'Урбатун хатан', NULL, 'ongod'),
    ('g2', 'k1', 'Ураг төрөл', NULL, 'group'), ('o3', 'g2', 'Тэмүлүн хатан', NULL, 'ongod'), ('o4', 'g2', 'Түмэн-Өлзийт', NULL, 'ongod'),
    ('g3', 'k1', 'Өрлөг, жанжид', NULL, 'group'), ('o5', 'g3', 'Наяа жанжин', NULL, 'ongod'), ('o6', 'g3', 'Дүүлэгч', NULL, 'ongod'),
    ('o7', 'g3', 'Боорчи', NULL, 'ongod'), ('o8', 'g3', 'Мухулай', NULL, 'ongod'), ('o23', 'g3', 'Зэв', NULL, 'ongod'),
    ('g4', 'k1', 'Мэргэд', NULL, 'group'), ('o9', 'g4', 'Шоолоо мэргэн', NULL, 'ongod'),
    ('k2', NULL, 'Их Юань · Хубилай хаан', 'Их Юань', 'group'),
    ('g5', 'k2', 'Хаад', NULL, 'group'), ('o11', 'g5', 'Хубилай сэцэн хаан', NULL, 'ongod'), ('o12', 'g5', 'Есөнтөмөр хаан', NULL, 'ongod'),
    ('g6', 'k2', 'Хатад', NULL, 'group'), ('o13', 'g6', 'Чаби хатан', NULL, 'ongod'),
    ('g7', 'k2', 'Жанжид', NULL, 'group'), ('o14', 'g7', 'Адхай жанжин', NULL, 'ongod'), ('o15', 'g7', 'Сорхон жанжин', NULL, 'ongod'),
    ('g8', 'k2', 'Мэргэд', NULL, 'group'), ('o16', 'g8', 'Зургуудай мэргэн', NULL, 'ongod'),
    ('k3', NULL, 'Бага хаадын үе', 'Бага хаад', 'group'),
    ('o17', 'k3', 'Мандухай сэцэн хатан', NULL, 'ongod'), ('o18', 'k3', 'Бэсүдэй хатан', NULL, 'ongod'), ('o19', 'k3', 'Даян хаан', NULL, 'ongod'),
    ('k4', NULL, 'Хүннү гүрэн', 'Хүннү', 'group'), ('o20', 'k4', 'Модун шаньюй', NULL, 'ongod'),
    ('k5', NULL, 'Эртний цаг үе', 'Эртний', 'group'), ('o21', 'k5', 'Алунгоо эх', NULL, 'ongod'),
    ('k6', NULL, 'Цаг үе тодорхойгүй', 'Тодорхой бус', 'group'), ('o22', 'k6', 'Хорол мэргэн', NULL, 'ongod');
  INSERT INTO ongod (id, urguu_id, name, era_id, kind, sort)
    SELECT o.id, u, o.name, (SELECT e.id FROM era e WHERE e.name = o.era), o.kind, o.sort FROM _o o ORDER BY o.sort;
  UPDATE ongod g SET parent_id = p.id FROM _o c JOIN _o p ON p.k = c.pk WHERE g.id = c.id;
  DROP TABLE _o;
END $$;
