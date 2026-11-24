# huyagtan.mn руу deploy хийх

`main` салбар руу push хийх бүрт GitHub Actions:

1. **build** (GitHub-ийн сервер дээр): Next.js-ийг build хийж, `app.tgz` болгон хадгална. Манай VPS-ийн 1 GB RAM build хийхэд хүрэлцэхгүй тул энд хийнэ.
2. **deploy** (VPS дээр ажиллах self-hosted runner): `app.tgz`-г татаж `/var/www/huyagtan.mn/releases/<commit>` руу задлаад,
   `current` холбоосыг шилжүүлж `huyagtan` service-ийг дахин асаана. Сүүлийн 3 хувилбарыг хадгална.

Runner нь зөвхөн GitHub руу **гадагш** холбогддог тул exacloud-ийн SSH порт дамжуулагчаас хамаарахгүй.
(GitHub-ээс SSH-ээр орох арга ажиллаагүй: `ssh.exa-vps.com:22001` нь GitHub-ийн серверүүдийн холболтыг дамжуулдаггүй.)

## 1. Серверийг нэг удаа бэлдэх

VPS-ийн **Консол**-оор:

```bash
curl -fsSL https://raw.githubusercontent.com/huyagtan-gif/huyagtanmindmap/main/deploy/setup-server.sh -o setup-server.sh
sudo bash setup-server.sh таны@имэйл.mn
```

Node.js 22, Nginx, Certbot, `deploy` хэрэглэгч, systemd service, Nginx тохиргоо, HTTPS-ийг үүсгэнэ.

## 2. GitHub runner суулгах

1. GitHub → repo → **Settings → Actions → Runners → New self-hosted runner** → Linux, x64.
2. Тэнд гарах `--token XXXXX` доторх токеныг хуулна (1 цаг хүчинтэй).
3. VPS консолд:

```bash
curl -fsSL https://raw.githubusercontent.com/huyagtan-gif/huyagtanmindmap/main/deploy/setup-runner.sh -o setup-runner.sh
sudo bash setup-runner.sh ТОКЕН
```

Runners хуудсанд `huyagtan-vps` нь **Idle** гэж харагдвал бэлэн.

## 3. Deploy хийх

`main` руу push хийхэд автоматаар явна. Гараар: **Actions → Deploy to huyagtan.mn → Run workflow**.

## Phase 1: өгөгдлийн сан ба апп (нэг удаа)

Phase 1-ээс эхлэн апп PostgreSQL шаарддаг. **`main` руу merge хийхээс өмнө** VPS-ийн консолд:

```bash
curl -fsSL https://raw.githubusercontent.com/huyagtan-gif/huyagtanmindmap/claude/project-thread-apzugy/deploy/setup-db.sh -o setup-db.sh
sudo bash setup-db.sh супер-админы@имэйл.mn
```

Энэ нь PostgreSQL 16-г суулгаж (зөвхөн localhost, 1 GB RAM-д тааруулсан тохиргоо), swap-ийг 2 GB болгож,
сан ба хэрэглэгчийг үүсгээд `/var/www/huyagtan.mn/.env`-д `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `SUPER_ADMIN_EMAIL`-ийг бичнэ.
Хүснэгтүүдийг deploy бүр автоматаар үүсгэж/шинэчилнэ (`scripts/migrate.mjs`, `migrations/*.sql`).

Хэрэв үүнийг хийлгүй merge хийвэл deploy «DATABASE_URL алга» гэж зогсох ба хуучин хуудас хэвээр ажиллана.

### Имэйл (нэвтрэх холбоос, мэдэгдэл)

`/var/www/huyagtan.mn/.env`-д нэмээд `sudo systemctl restart huyagtan`:

```bash
# Сонголт А: Gmail (хамгийн хурдан). Google Account → Security → 2-Step Verification → App passwords-оос 16 оронтой нууц үг авна.
EMAIL_SERVER=smtps://таны.хаяг%40gmail.com:АППНУУЦҮГ@smtp.gmail.com:465
EMAIL_FROM="Хуягтан <таны.хаяг@gmail.com>"

# Сонголт Б: Resend (үнэгүй 3000/сар; huyagtan.mn домэйны DNS бичлэг баталгаажуулах шаардлагатай)
EMAIL_SERVER=smtps://resend:re_ТАНЫ_ТҮЛХҮҮР@smtp.resend.com:465
EMAIL_FROM="Хуягтан <no-reply@huyagtan.mn>"
```

`EMAIL_SERVER` тохируулаагүй үед имэйл явахгүй, холбоос зөвхөн серверийн логт бичигдэнэ
(анхны нэвтрэлтэд хэрэг болно): `sudo journalctl -u huyagtan | grep 'mail:dev' | tail -1`.

### Бусад орчны хувьсагч

Бүрэн жагсаалт: [`.env.example`](../.env.example).

- `SUPER_ADMIN_EMAIL`: энэ имэйлээр анх нэвтэрсэн хүн супер админ болно.
- `SUPER_ADMIN_NAME="Эцгийн-нэр Өөрийн-нэр"`: импортын мөртэй нэрээр тулгагдаж давхар бүртгэл үүсэхээс сэргийлнэ.
- `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`: Google-ээр нэвтрэх (заавал биш). Google Cloud Console → OAuth client →
  Authorized redirect URI: `https://huyagtan.mn/api/auth/callback/google`.

### Анхны өгөгдөл оруулах

1. `https://huyagtan.mn/login` → супер админы имэйлээр нэвтэрнэ.
2. Google Sheet «Дэлхийн Үрсийн Нэгдсэн бүртгэл» → File → Download → **CSV**.
3. **Импорт, нэгтгэл** → CSV-г оруулна → «Хянах зүйлс»-ийг нэг бүрчлэн шийдвэрлэнэ.
   Файл серверт хадгалагдахгүй, git-д орохгүй. Ижил файл хоёр удаа орохгүй.

## Нөөцлөлт (шөнө бүр → Google Drive «Mindmap/backups»)

Шөнө бүр 03:00 (Улаанбаатар)-д `pg_dump` → `age`-ээр шифрлэнэ → `rclone`-оор Drive руу хуулна, 30 хоногоос хуучныг устгана.
Шифрлэлт нийтийн түлхүүрээр хийгддэг тул тайлах түлхүүр сервер дээр байхгүй.

**1. Google Drive холбох** (нэг удаа). Өөрийн компьютер дээр [rclone](https://rclone.org/downloads/) суулгаад:

```bash
rclone authorize "drive" --drive-scope drive.file
```

Хөтөч нээгдэж Google-ээр зөвшөөрнө. Терминалд гарсан `{"access_token":...}` мөрийг хуулна. Дараа нь VPS консолд:

```bash
sudo mkdir -p /etc/huyagtan && sudo tee /etc/huyagtan/rclone.conf >/dev/null <<'EOF'
[gdrive]
type = drive
scope = drive.file
token = ЭНД_ХУУЛСАН_МӨРӨӨ_ТАВИНА
EOF
sudo chmod 600 /etc/huyagtan/rclone.conf
```

**2. Нөөцлөлтийг асаах:**

```bash
curl -fsSL https://raw.githubusercontent.com/huyagtan-gif/huyagtanmindmap/main/deploy/setup-backup.sh -o setup-backup.sh
curl -fsSL https://raw.githubusercontent.com/huyagtan-gif/huyagtanmindmap/main/deploy/backup.sh -o backup.sh
sudo bash setup-backup.sh
```

Дэлгэцэд гарах `AGE-SECRET-KEY-...` мөрийг **найдвартай газар хадгална** (нууц үгийн менежер). Алдвал нөөцийг сэргээх боломжгүй.

Шалгах: `systemctl list-timers huyagtan-backup.timer`, `sudo journalctl -u huyagtan-backup -n 20`.

**3. Сэргээх** (шинэ серверт, эсвэл туршилтаар тусдаа сан руу):

```bash
rclone --config /etc/huyagtan/rclone.conf copy gdrive:Mindmap/backups/huyagtan_2026-12-01_0300.dump.age .
age -d -i түлхүүр.txt huyagtan_2026-12-01_0300.dump.age > huyagtan.dump     # түлхүүр.txt = AGE-SECRET-KEY мөр
sudo -u postgres createdb -O huyagtan huyagtan_restore                       # role-ууд: setup-db.sh үүсгэдэг
sudo -u postgres pg_restore --no-owner --role=huyagtan -d huyagtan_restore huyagtan.dump
sudo -u postgres psql -d huyagtan_restore -c 'SELECT count(*) FROM person'    # шалгах
```

Жинхэнэ сэргээлтэд `.env`-ийн `DATABASE_URL`-ийг сэргээсэн сан руу зааж `sudo systemctl restart huyagtan`.
Сар бүр нэг удаа туршиж сэргээхийг зөвлөнө (N4).

## Асуудал гарвал

```bash
sudo systemctl status huyagtan
sudo journalctl -u huyagtan -n 100
sudo nginx -t
sudo /home/deploy/actions-runner/svc.sh status
curl -s http://127.0.0.1:3000/api/health          # {"ok":true} бол апп ба сан хэвийн
sudo systemctl status postgresql
```
