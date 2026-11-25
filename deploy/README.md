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

## Phase 2: нэмэлт тохиргоо

Phase 2-ын код `main` руу ороход хүснэгтүүд автоматаар шинэчлэгдэнэ. Сервер дээр заавал хийх шинэ алхам **байхгүй**;
доорх бүгд сонголттой бөгөөд тохируулаагүй үед тухайн хэсэг дэлгэцэд харагдахгүй.

### SMS (нэг удаагийн код)

Гарцаа сонгосны дараа `/var/www/huyagtan.mn/.env`-д гарцын API-ийн дагуу нэмээд `sudo systemctl restart huyagtan`:

```bash
# GET-ээр илгээдэг гарц
SMS_HTTP_URL="https://sms.example.mn/send?key=ТҮЛХҮҮР&from={from}&to={to}&text={text}"
SMS_FROM=Huyagtan

# эсвэл POST + JSON
SMS_HTTP_URL=https://sms.example.mn/api/send
SMS_HTTP_METHOD=POST
SMS_HTTP_HEADERS={"authorization":"Bearer ТҮЛХҮҮР"}
SMS_HTTP_BODY={"to":"{to}","text":"{text}","from":"{from}"}
SMS_TO_FORMAT=local        # local = 99112233, e164 = +97699112233
```

Тохируулсны дараа «Миний мэдээлэл»-д утас баталгаажуулах, нэвтрэх хуудсанд «Утсаар нэвтрэх» гарч ирнэ.
Код 6 оронтой, 5 минут хүчинтэй, нэг дугаарт 15 минутад 5-аас ихгүй илгээнэ.

### Captcha (Cloudflare Turnstile, үнэгүй)

[dash.cloudflare.com](https://dash.cloudflare.com) → Turnstile → Add site (`huyagtan.mn`) → хоёр түлхүүрийг `.env`-д:

```bash
TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...
```

### Алдааны хяналт

- Серверийн болон хөтчийн алдаа **Систем → Алдаа, төлөв** хэсэгт бүртгэгдэнэ. Шинэ алдаа гарвал супер админд имэйл очно
  (ижил алдаанд 24 цагт нэг удаа, цагт 5-аас ихгүй). Унтраах: `.env`-д `ERROR_ALERTS=off`.
- Сайт бүхэлдээ унасныг мэдэхийн тулд [UptimeRobot](https://uptimerobot.com) (үнэгүй) дээр монитор нэмнэ:
  Monitor type **Keyword**, URL `https://huyagtan.mn/api/health`, Keyword `"ok":true` (exists), 5 минут тутам, мэдэгдэл имэйлээр.

### Туршилтын орчин: staging.huyagtan.mn

Шинэ хувилбарыг жинхэнэ өгөгдөлд хүргэхээс өмнө ижил сервер дээр, **тусдаа сантай** орчинд туршина.

1. Домэйны DNS-д `staging` нэртэй **A бичлэг** нэмж серверийн IP руу заана.
2. VPS консолд:

```bash
curl -fsSL https://raw.githubusercontent.com/huyagtan-gif/huyagtanmindmap/main/deploy/setup-staging.sh -o setup-staging.sh
sudo bash setup-staging.sh супер-админы@имэйл.mn
```

3. GitHub → **Actions → Deploy to huyagtan.mn → Run workflow** → Branch: турших салбар, **Deploy to: staging**.
   (`staging` нэртэй салбар руу push хийхэд мөн автоматаар staging руу deploy болно.)

Staging нь хоосон сангаар эхэлнэ: зөвхөн зохиомол өгөгдөл оруулна, жинхэнэ бүртгэлийг хуулахгүй. Имэйл тохируулаагүй тул нэвтрэх холбоос,
SMS код логт бичигдэнэ: `sudo journalctl -u huyagtan-staging | grep -E 'mail:dev|sms:dev' | tail -3`.
Сервер 1 GB RAM-тай тул ашиглаагүй үедээ унтрааж болно: `sudo systemctl stop huyagtan-staging` (дараагийн deploy дахин асаана).

### Realtime (шууд шинэчлэгдэх)

Нэмэлт тохиргоо шаардахгүй: апп `/api/events` хаягаар SSE холболт нээх ба Nginx-ийн одоогийн тохиргоогоор дамжина
(хариу `X-Accel-Buffering: no` толгойтой, 25 секунд тутам дохио явуулдаг тул холболт тасрахгүй).

## Phase 3: үйл ажиллагаа, сургалт

Нэмэлт тохиргоо шаардахгүй (миграци deploy-оор автоматаар орно).

- **Үйлийн төрөл, үүрэг** болон сургалтын ангилал: **Тохиргоо → Үйл, сургалт**. Шинэ өргөө үүсгэхэд загвараас хуулагдана.
- **Нийтийн бүртгэл**: сургалтыг «Олон нийтэд нээлттэй» болговол `https://huyagtan.mn/t/<код>` холбоос гарна.
  Зочин утсаараа SMS код авч баталгаажуулна, тиймээс SMS гарц (Phase 2) тохируулсан байх хэрэгтэй.
  SMS тохируулаагүй үед код серверийн логт бичигдэнэ (`journalctl -u huyagtan | grep sms:dev`).
- **QR ирц**: сургалтын хичээл бүрийн «QR» товч дэлгэцэнд QR харуулна, 15 минут тутам шинэчлэгдэнэ.
- **Сануулга**: үйл, хичээл эхлэхээс 24 цагийн өмнө оролцогчдод имэйл (push асаасан бол push) автоматаар очно.

## Phase 4: QPay төлбөр, хандив

1. **Шифрлэх түлхүүр** (нэг удаа): `.env`-д `PAYMENT_SECRET=$(openssl rand -base64 32)` нэмж `sudo systemctl restart huyagtan`.
   Энэ утгыг **хэзээ ч солихгүй**, нөөц нууц үгийн менежерт хадгална: солибол хадгалсан QPay нууц үг тайлагдахгүй болж дахин оруулах шаардлагатай.
   (Тохируулаагүй бол `AUTH_SECRET` ашиглагдана.)
2. **QPay merchant**: QPay-ээс (qpay.mn → Merchant) гэрээ байгуулж **username, password, invoice code** авна.
3. Апп дотор **Санхүү → QPay тохиргоо** дээр гурвыг оруулж «Холболт шалгах» дарна. Өргөө бүр өөрийн merchant-тай байж болно.
   Нууц үг DB-д AES-256-GCM-ээр шифрлэгдэж хадгалагдах ба өөрчлөлтийн түүхэнд бичигдэхгүй.
4. **Callback**: апп нэхэмжлэх бүрт `https://huyagtan.mn/api/qpay/callback?...` хаягийг автоматаар өгнө (`AUTH_URL`-аас).
   Сайт HTTPS-ээр интернэтээс нээгддэг байх ёстой. Callback-д итгэхгүй: апп QPay-ээс төлбөрийг дахин шалгаж байж «Төлсөн» болгоно.
   Callback ирээгүй ч 15 минут тутам хүлээгдэж буй нэхэмжлэхийг шалгана, шөнө бүр 02:00-д өдрийн тулгалт хийнэ.
5. **Буцаалт** QPay API-аар зөвхөн картын төлбөрт боломжтой тул мөнгийг банкаар буцааж, апп дотор «Буцаасан» гэж тэмдэглэнэ.

Туршилт: staging-д `.env`-д `QPAY_MOCK=1` тавибал жинхэнэ QPay-гүйгээр төлбөрийн бүх урсгалыг туршина
(«Mock: төлсөн болгох» товч гарна). Production-д (`APP_ENV` хоосон) mock ажиллахгүй.

## Phase 5: сертификат, PWA, push, англи хэл

### Сертификат

Сургалтын оролцогчийг «Дүүргэсэн» болгоход `ХТ-2026-00001` маягийн дугаар автоматаар олгогдоно (дахин олгоход хэвээр).
Сертификатыг `https://huyagtan.mn/certificate/<код>` хаягаар хэн ч шалгаж, хэвлэж (PDF болгож) болно.
Хуудсанд нэр, сургалт, хугацаа, багш л харагдана: утас, имэйл зэрэг хувийн мэдээлэл гарахгүй.

### Апп болгон суулгах (PWA)

Тохиргоо шаардахгүй. Утасны хөтчөөр сайтыг нээгээд **Add to Home screen / Нүүр дэлгэцэнд нэмэх** дарна.
Service worker зөвхөн статик файл (JS, CSS, зураг) ба офлайн хуудсыг кэшлэнэ: хувийн мэдээлэлтэй хуудас төхөөрөмж дээр хадгалагдахгүй.

### Push мэдэгдэл

1. VAPID түлхүүр үүсгэнэ (нэг удаа, өөрийн компьютер эсвэл сервер дээр): `node scripts/vapid.mjs`
2. Гарсан гурван мөрийг `.env`-д нэмнэ:

```bash
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=https://huyagtan.mn          # эсвэл mailto:холбоо-барих@huyagtan.mn
```

3. `sudo systemctl restart huyagtan`. Гишүүд **Миний мэдээлэл → Push мэдэгдэл → Асаах** дарж зөвшөөрнө.

Push нь хоосон дохио: мэдэгдлийн агуулга Google, Apple, Mozilla-гийн push үйлчилгээгээр дамжихгүй, утас нь апп-аас өөрөө татна (A3).
iPhone дээр push зөвхөн нүүр дэлгэцэнд нэмсэн (PWA) үед ажиллана (iOS 16.4+). Түлхүүрийг солибол бүх хүн дахин асаах шаардлагатай.

### Англи хэл (D13)

Нэвтрэх, бүртгүүлэх, нийтийн сургалтын бүртгэл, QR ирц, хандив, төлбөрийн хуудас болон үндсэн цэс англиар харагдана
(хуудасны доод хэсэг эсвэл **Миний мэдээлэл → Хэл**). Удирдлагын дэлгэцүүд одоогоор монголоор үлдэнэ.
Орчуулга `lib/i18n-en.ts`-д: монгол мөр нь өөрөө түлхүүр. Шинэ хэл нэмэхдээ `lib/i18n-core.ts`-ийн `LANGS`-д нэмж,
`lib/i18n-<код>.ts` толь үүсгэнэ. Дутуу орчуулгыг `node scripts/i18n-keys.mjs --missing` харуулна, тест ч шалгана.

### Сервер өргөтгөх (2 GB+ RAM)

**Хэзээ:** `free -m`-д swap байнга 300 MB-аас их ашиглагдаж байвал, хуудас 1 секундээс удаан нээгдэж эхэлбэл, эсвэл гишүүд 1000 давбал.

1. VPS-ийн хяналтын самбараас төлөвлөгөөг 2 GB (эсвэл 4 GB) RAM руу өсгөнө (ихэнх үйлчилгээнд дахин асаахад л болно).
2. Серверт: `sudo bash setup-db.sh` дахин ажиллуулна. Скрипт RAM-ийг илрүүлж PostgreSQL-ийн санах ой
   (`shared_buffers`, `effective_cache_size`, `work_mem`, холболтын тоо), апп-ын `NODE_OPTIONS`, `PG_POOL_MAX`-ыг тааруулна.
   Гараар өөрчилсөн утгыг хөндөхгүй. Дараа нь `sudo systemctl restart huyagtan`.

| RAM | PostgreSQL shared_buffers / cache | max_connections | Апп heap | PG_POOL_MAX |
|---|---|---|---|---|
| 1 GB | 128 MB / 256 MB | 20 | 384 MB | 6 |
| 2 GB | 512 MB / 1.5 GB | 40 | 640 MB | 10 |
| 4 GB | 1 GB / 3 GB | 60 | 1 GB | 15 |

2 GB-аас дээш болсны дараа staging-ийг байнга асаалттай байлгаж болно.

**Унших реплика (read replica)**, 4 GB-аас цааш хэрэгтэй болбол: хоёр дахь VPS дээр PostgreSQL 16 суулгаж streaming replication тохируулна.

```bash
# Үндсэн сервер: реплика хэрэглэгч, сүлжээ
sudo -u postgres psql -c "CREATE ROLE replicator REPLICATION LOGIN PASSWORD 'урт-нууц-үг'"
echo "listen_addresses = 'localhost,ҮНДСЭН_ДОТООД_IP'" | sudo tee /etc/postgresql/16/main/conf.d/replica.conf
echo "host replication replicator РЕПЛИКА_IP/32 scram-sha-256" | sudo tee -a /etc/postgresql/16/main/pg_hba.conf
sudo ufw allow from РЕПЛИКА_IP to any port 5432 && sudo systemctl restart postgresql
# Реплика сервер: хоосон сан дээр үндсэнээс хуулж, standby горимоор асаана
sudo systemctl stop postgresql && sudo rm -rf /var/lib/postgresql/16/main
sudo -u postgres pg_basebackup -h ҮНДСЭН_ДОТООД_IP -U replicator -D /var/lib/postgresql/16/main -R -X stream -P
sudo systemctl start postgresql
sudo -u postgres psql -c "SELECT pg_is_in_recovery()"     # t гарвал реплика ажиллаж байна
```

Реплика зөвхөн уншина: тайлан, экспорт, BI хэрэгсэл, нөөцлөлтийг (`backup.sh`-ийн `DATABASE_URL`-ийг реплика руу) тийш шилжүүлж үндсэн серверийн ачааллыг бууруулна.
RLS, role-ууд хамт хуулагдана. Апп өөрөө одоогоор бүх хүсэлтийг үндсэн сан руу илгээдэг.
Апп-ын уншилтыг реплика руу чиглүүлэх нь тусдаа ажил: бичсэн даруйдаа уншдаг хуудсууд хоцрогдол харуулахаас сэргийлэх шаардлагатай.

**CDN (Cloudflare, үнэгүй)**: статик файлыг ойрын серверээс өгч, DDoS-оос хамгаална.

1. cloudflare.com дээр `huyagtan.mn` домэйн нэмж, домэйн бүртгэгч дээрээ nameserver-ийг Cloudflare-ийнх болгоно.
2. DNS: `huyagtan.mn`, `www`, `staging` бичлэгүүдийг **Proxied** (улбар шар үүл) болгоно.
3. **SSL/TLS → Full (strict)** (certbot-ын сертификат хэвээр ажиллана).
4. **Caching → Cache Rules**: `URI Path starts with /_next/static/` → Eligible for cache, Edge TTL 1 жил.
   Бусад бүх хаягийг кэшлэхгүй (анхдагчаар Cloudflare HTML-ийг кэшлэдэггүй). `/api/*`, `/sw.js`-ийг кэшлэхгүй.
5. Жинхэнэ IP (оролдлогын хязгаар зөв ажиллахад): серверт

```bash
curl -s https://www.cloudflare.com/ips-v4 https://www.cloudflare.com/ips-v6 | sed 's/.*/set_real_ip_from &;/' | sudo tee /etc/nginx/conf.d/cloudflare.conf
echo 'real_ip_header CF-Connecting-IP;' | sudo tee -a /etc/nginx/conf.d/cloudflare.conf
sudo nginx -t && sudo systemctl reload nginx
```

Realtime (`/api/events`) Cloudflare-аар дамжина: апп 25 секунд тутам дохио явуулдаг тул 100 секундын хязгаарт хүрэхгүй.
QPay callback ч Cloudflare-аар орно: **Security → Bots**-ийн «Bot Fight Mode»-ийг асаавал `/api/qpay/callback`-ийг үл хамаарах дүрэмд нэмнэ.

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
sudo systemctl status huyagtan-staging            # туршилтын орчин (порт 3001)
sudo systemctl status postgresql
```
