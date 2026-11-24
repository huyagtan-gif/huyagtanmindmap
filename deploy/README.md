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

## Орчны хувьсагч (Supabase г.м.)

Сервер дээр `/var/www/huyagtan.mn/.env` файлд бичээд `sudo systemctl restart huyagtan` хийнэ.
`NEXT_PUBLIC_*` хувьсагчууд build үед хэрэгтэй тул GitHub Secrets-д нэмж workflow-ийн Build алхамд дамжуулна.

## Асуудал гарвал

```bash
sudo systemctl status huyagtan
sudo journalctl -u huyagtan -n 100
sudo nginx -t
sudo /home/deploy/actions-runner/svc.sh status
```
