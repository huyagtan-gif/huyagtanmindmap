# huyagtan.mn руу deploy хийх

`main` салбар руу push хийх бүрт GitHub Actions:

1. Next.js-ийг GitHub дээр build хийнэ (серверийн 1 GB RAM build хийхэд хүрэлцэхгүй тул).
2. Бэлэн болсон файлуудыг SSH + rsync-ээр сервер рүү `/var/www/huyagtan.mn/releases/<commit>` руу хуулна.
3. `current` холбоосыг шинэ хувилбар руу шилжүүлээд `huyagtan` service-ийг дахин асаана.
4. Сүүлийн 3 хувилбарыг хадгалж, хуучныг устгана.

## 1. Серверийг нэг удаа бэлдэх

VPS-ийн **Консол** (эсвэл SSH)-оор root-оор орж:

```bash
curl -fsSL https://raw.githubusercontent.com/huyagtan-gif/huyagtanmindmap/main/deploy/setup-server.sh -o setup-server.sh
sudo bash setup-server.sh таны@имэйл.mn
```

Имэйл нь Let's Encrypt HTTPS гэрчилгээнд хэрэглэгдэнэ. Скрипт Node.js 22, Nginx, Certbot суулгаж,
`deploy` хэрэглэгч, SSH түлхүүр, systemd service, Nginx тохиргоо, HTTPS-ийг үүсгэнэ.

Төгсгөлд нь гарах командаар private key-г хараад хуулна:

```bash
sudo cat /home/deploy/.ssh/github_actions
```

## 2. GitHub Secrets нэмэх

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Нэр | Утга |
| --- | --- |
| `SSH_HOST` | Серверийн гадаад IP эсвэл `huyagtan.mn` |
| `SSH_PORT` | VPS самбарын **Порт (SSH, SQL)** табд байгаа SSH порт |
| `SSH_USER` | `deploy` |
| `SSH_PRIVATE_KEY` | Дээрх `github_actions` файлын бүх агуулга (`-----BEGIN` ... `END-----` хүртэл) |

## 3. Deploy хийх

`main` руу push хийхэд автоматаар явна. Гараар ажиллуулах бол **Actions → Deploy to huyagtan.mn → Run workflow**.

## Орчны хувьсагч (Supabase г.м.)

Сервер дээр `/var/www/huyagtan.mn/.env` файлд бичээд `sudo systemctl restart huyagtan` хийнэ.
`NEXT_PUBLIC_*` хувьсагчууд build үед хэрэгтэй тул тэдгээрийг GitHub Secrets-д нэмж workflow-ийн Build алхамд дамжуулна.

## Асуудал гарвал

```bash
sudo systemctl status huyagtan
sudo journalctl -u huyagtan -n 100
sudo nginx -t
```
