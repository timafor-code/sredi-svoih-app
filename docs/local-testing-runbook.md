# «Среди Своих»: локальный запуск и ручное тестирование

Единая памятка для Windows PowerShell.

Локальный проект:

```powershell
F:\2026\SS-App\code\sredi-svoih-app
```

Текущий локальный runtime состоит из четырёх частей:

| Контур | Команда запуска | Адрес |
| --- | --- | --- |
| Python API + PostgreSQL + MinIO + Mailpit | Docker Compose | `http://127.0.0.1:8000` |
| Web-admin | `npm run admin:dev` | `http://localhost:5173` |
| Public web registration | `npm run web:dev` | `http://localhost:5174` |
| Mobile на физическом iPhone | `npm run mobile:iphone` | Expo Go / Metro `8081` |

Supabase для текущего production-like API runtime не запускается. Mobile, admin и public web работают через Python/FastAPI API.

> **Главное правило:** четыре открытых окна PowerShell не означают, что локальный контур работает. Перед запуском admin, web и Expo обязательно должен успешно отвечать `http://127.0.0.1:8000/health`.

---

# 1. Канонический запуск после включения компьютера

Этот раздел — основной ежедневный алгоритм для сценария:

```text
Windows только что включён
→ ничего не запущено
→ нужно поднять API, admin, web и iPhone/Expo Go
```

## Шаг 0 — запустить Docker Desktop

Сначала запустите **Docker Desktop** и дождитесь, пока Docker Engine полностью загрузится.

После этого откройте PowerShell и выполните:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
docker version
docker compose version
```

`docker version` должен показать не только Client, но и Server.

Если Server недоступен, не продолжайте запуск проекта. Сначала дождитесь запуска Docker Desktop.

---

## Окно 1 — API и Docker-сервисы

Откройте первое окно PowerShell.

### 1.1. Перейдите в проект

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
```

### 1.2. Поднимите текущую версию API

Канонический cold-start использует `--build`, чтобы после merge/pull не остаться на старом Python image:

```powershell
docker compose -f infra/docker-compose.api.yml up -d --build
```

Почему это важно: содержимое `apps/api` копируется внутрь Docker image через `Dockerfile.local`. Обычный restart контейнера не подхватывает новый Python-код.

### 1.3. Примените Alembic migrations

```powershell
docker compose -f infra/docker-compose.api.yml exec api_backend alembic upgrade head
```

Если команда выполнена без ошибки — продолжайте.

### 1.4. Проверьте контейнеры

```powershell
docker compose -f infra/docker-compose.api.yml ps -a
```

Нормальное состояние:

- `api_backend` — running;
- `api_postgres` — running / healthy;
- `api_object_storage` — running;
- `api_mailpit` — running;
- `api_object_storage_init` — может быть `Exited (0)`: это нормально, он создаёт bucket и завершает работу;
- `api_privacy_erasure_worker` — при выключенном `API_PRIVACY_ERASURE_WORKER_ENABLED` может завершиться успешно; это не означает, что API сломан.

### 1.5. Обязательная проверка API

```powershell
curl.exe --fail http://127.0.0.1:8000/health
curl.exe --fail http://127.0.0.1:8000/version
```

**Не переходите к окну 2, пока `/health` не отвечает успешно.**

Дополнительно можно открыть:

```text
http://127.0.0.1:8000/docs
```

### 1.6. Если `/health` не работает

Сначала:

```powershell
docker compose -f infra/docker-compose.api.yml ps -a
docker compose -f infra/docker-compose.api.yml logs --tail=150 api_backend
```

Проверить, занят ли порт 8000:

```powershell
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
```

Если `api_backend` не запущен и `exec ... alembic` выполнить невозможно:

```powershell
docker compose -f infra/docker-compose.api.yml run --rm api_backend alembic upgrade head
docker compose -f infra/docker-compose.api.yml up -d --build --force-recreate api_backend
curl.exe --fail http://127.0.0.1:8000/health
```

Не используйте `down -v` для обычного восстановления: эта команда удаляет локальные PostgreSQL/MinIO volumes.

---

## Окно 2 — Web-admin

Открывать только после успешного `/health` в окне 1.

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
npm run admin:dev
```

Открыть:

```text
http://localhost:5173
```

Локальный admin должен обращаться к API по:

```dotenv
VITE_API_URL=http://127.0.0.1:8000
```

Проверить текущий файл:

```powershell
Get-Content apps/admin/.env.local
```

Ожидаемый локальный набор:

```dotenv
VITE_API_URL=http://127.0.0.1:8000
VITE_ADMIN_ENV_LABEL=staging
VITE_ADMIN_BASE_PATH=/
```

Важно: то, что Vite сообщил `Local: http://localhost:5173`, доказывает только запуск frontend dev server. Это **не доказывает**, что Python API работает.

---

## Окно 3 — Public web registration

Открывать только после успешного `/health` в окне 1.

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
npm run web:dev
```

Открыть:

```text
http://localhost:5174
```

Проверить env:

```powershell
Get-Content apps/web/.env.local
```

Ожидается:

```dotenv
VITE_WEB_API_BASE_URL=/api
VITE_WEB_API_PROXY_TARGET=http://127.0.0.1:8000
```

После запуска Vite отдельно проверьте proxy:

```powershell
curl.exe --fail http://localhost:5174/api/health
```

Диагностика:

- `http://127.0.0.1:8000/health` работает, но `http://localhost:5174/api/health` нет → проверять Vite proxy / `apps/web/.env.local`;
- оба адреса не работают → вернуться к окну 1 и чинить API.

Ссылка на событие:

```text
http://localhost:5174/events/<public-slug>
```

Для legacy/preselected occurrence сценария:

```text
http://localhost:5174/events/<public-slug>?occurrence=<occurrence-uuid>
```

---

## Перед окном 4 — обязательно проверить текущий LAN IP

После перезагрузки компьютера или Wi-Fi роутер может выдать компьютеру другой IPv4.

Проверьте:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.AddressState -eq "Preferred" } | Select-Object InterfaceAlias,IPAddress
```

Нужен IPv4 активного Wi-Fi/Ethernet, например:

```text
192.168.1.25
```

Проверьте корневой `.env.local`:

```powershell
Get-Content .env.local
```

Для account-режима ожидается:

```dotenv
EXPO_PUBLIC_API_URL=http://192.168.1.25:8000
EXPO_PUBLIC_APP_ACCESS_MODE=account
EXPO_PUBLIC_EVENT_REGISTRATION_MODE=account
```

IP в `EXPO_PUBLIC_API_URL` должен совпадать с **текущим** LAN IP компьютера.

---

## Окно 4 — Mobile на физическом iPhone через Expo Go

Сначала проверить конфигурацию без запуска Expo:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
npm run mobile:iphone -- --check
```

На iPhone, подключённом к той же сети, откройте Safari:

```text
http://<CURRENT-LAN-IP>:8000/health
```

Если Safari не открывает этот адрес, Expo-приложение также не сможет нормально работать с API. Сначала решите LAN/Firewall проблему.

Только после успешной проверки запускайте:

```powershell
npm run mobile:iphone
```

Launcher:

- читает `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_APP_ACCESS_MODE`, `EXPO_PUBLIC_EVENT_REGISTRATION_MODE` из корневого `.env.local`;
- вызывает `docker compose ... up -d`;
- делает MinIO доступным для LAN на `59000`;
- выставляет public avatar storage URL через текущий LAN IP;
- запускает Expo с очищенным Metro cache.

Но `npm run mobile:iphone` **не заменяет окно 1**: он не является полным API readiness gate и не должен использоваться вместо проверки Alembic + `/health`.

На физическом iPhone нельзя указывать `127.0.0.1` или `localhost`: они указывают на сам iPhone.

---

# 2. Как понять, что весь локальный контур готов

Перед ручным тестированием должны выполняться все применимые проверки:

| Проверка | Адрес |
| --- | --- |
| API health | `http://127.0.0.1:8000/health` |
| API version | `http://127.0.0.1:8000/version` |
| Swagger | `http://127.0.0.1:8000/docs` |
| Admin | `http://localhost:5173` |
| Public web | `http://localhost:5174` |
| Web → API proxy | `http://localhost:5174/api/health` |
| Mailpit | `http://127.0.0.1:8025` |
| MinIO console | `http://127.0.0.1:59001` |
| API с физического iPhone | `http://<CURRENT-LAN-IP>:8000/health` |

**Readiness-критерий — работа этих сервисов, а не количество открытых PowerShell-окон.**

---

# 3. Первый запуск проекта на новом компьютере

Это отличается от обычного ежедневного cold-start.

Нужно установить:

- Git;
- Node.js/npm;
- Docker Desktop;
- Expo Go на iPhone.

Затем:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
git switch main
git pull origin main
git status --short
npm ci
npm ci --prefix apps/admin
npm ci --prefix apps/web
```

Создать локальные env-файлы только если их ещё нет:

```powershell
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
if (-not (Test-Path apps/admin/.env.local)) { Copy-Item apps/admin/.env.example apps/admin/.env.local }
if (-not (Test-Path apps/web/.env.local)) { Copy-Item apps/web/.env.example apps/web/.env.local }
```

После этого выполнить канонический запуск из раздела 1.

Первый Docker build занимает заметно больше времени, потому что скачиваются образы и устанавливаются Python dependencies.

---

# 4. Mobile `.env.local` и режимы приложения

Корневой `.env.local` используется launcher'ом `npm run mobile:iphone`.

Для аккаунтов + internal registration:

```dotenv
EXPO_PUBLIC_API_URL=http://<LAN-IP>:8000
EXPO_PUBLIC_APP_ACCESS_MODE=account
EXPO_PUBLIC_EVENT_REGISTRATION_MODE=account
```

Account + public web registration:

```dotenv
EXPO_PUBLIC_API_URL=http://<LAN-IP>:8000
EXPO_PUBLIC_APP_ACCESS_MODE=account
EXPO_PUBLIC_EVENT_REGISTRATION_MODE=public_web
```

Guest + public web registration:

```dotenv
EXPO_PUBLIC_API_URL=http://<LAN-IP>:8000
EXPO_PUBLIC_APP_ACCESS_MODE=guest_only
EXPO_PUBLIC_EVENT_REGISTRATION_MODE=public_web
```

Guest без registration:

```dotenv
EXPO_PUBLIC_API_URL=http://<LAN-IP>:8000
EXPO_PUBLIC_APP_ACCESS_MODE=guest_only
EXPO_PUBLIC_EVENT_REGISTRATION_MODE=disabled
```

Проверка:

```powershell
npm run mobile:iphone -- --check
```

Локальные `.env.local` не коммитятся.

---

# 5. LAN, iPhone и MinIO

Проверка LAN IP:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.AddressState -eq "Preferred" } | Select-Object InterfaceAlias,IPAddress
```

С компьютера:

```text
http://<LAN-IP>:8000/health
```

Затем с iPhone Safari:

```text
http://<LAN-IP>:8000/health
```

Для аватаров после запуска `npm run mobile:iphone`:

```text
http://<LAN-IP>:59000
```

XML/S3 error или `AccessDenied` допустимы: это означает, что iPhone видит MinIO.

Если Windows Firewall блокирует MinIO:

```powershell
New-NetFirewallRule -DisplayName "Sredi Svoih MinIO 59000" -Direction Inbound -Protocol TCP -LocalPort 59000 -Action Allow
```

Для API при необходимости аналогично проверить Windows Firewall / Docker network access на port `8000`.

---

# 6. API, PostgreSQL, Mailpit и MinIO

## API

```powershell
curl.exe --fail http://127.0.0.1:8000/health
curl.exe --fail http://127.0.0.1:8000/version
```

## Контейнеры

```powershell
docker compose -f infra/docker-compose.api.yml ps -a
```

## Логи API

```powershell
docker compose -f infra/docker-compose.api.yml logs -f --tail=100 api_backend
```

Выход: `Ctrl+C`. Контейнер остаётся работать.

## Все Docker logs

```powershell
docker compose -f infra/docker-compose.api.yml logs -f --tail=100
```

## Alembic migration

Если API running:

```powershell
docker compose -f infra/docker-compose.api.yml exec api_backend alembic upgrade head
```

Если API container не стартует:

```powershell
docker compose -f infra/docker-compose.api.yml run --rm api_backend alembic upgrade head
```

## Mailpit

```text
http://127.0.0.1:8025
```

Локальные email-коды приходят сюда, а не на внешний email.

## MinIO console

```text
http://127.0.0.1:59001
```

## PostgreSQL host port

```text
localhost:55432
```

Frontend-клиенты не должны подключаться к PostgreSQL напрямую.

---

# 7. Public web registration

Сначала API должен пройти `/health`.

Затем:

```powershell
npm run web:dev
curl.exe --fail http://localhost:5174/api/health
```

Для доступного события в admin обычно должны быть корректно настроены:

- `published`;
- `public` visibility;
- `internal_free` или `internal_paid`;
- web visibility `unlisted`/`listed`;
- public slug;
- occurrence/window/capacity;
- актуальный текст согласия.

Локальный Mailpit:

```text
http://127.0.0.1:8025
```

`internal_paid` в текущем локальном runtime создаёт регистрацию со статусами `pending / pending`; реальный payment gateway не выполняется.

---

# 8. Что делать после merge / git pull

Остановите Expo/admin/web через `Ctrl+C`.

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
git status --short
git switch main
git pull origin main
npm ci
npm ci --prefix apps/admin
npm ci --prefix apps/web
```

Затем снова пройдите **канонический запуск из раздела 1**, начиная с Docker/API.

Если менялся Python backend, plain restart недостаточен: нужен build/recreate.

---

# 9. Что именно перезапускать после изменений

| Что изменилось | Что делать |
| --- | --- |
| Только mobile JS/TS | Expo обычно обновит автоматически; при проблеме restart `npm run mobile:iphone` |
| Корневой `.env.local` | остановить Expo → `npm run mobile:iphone -- --check` → `npm run mobile:iphone` |
| LAN IP изменился | обновить `EXPO_PUBLIC_API_URL` → проверить Safari `/health` → restart mobile launcher |
| Только admin React/CSS | обычно Vite HMR достаточно |
| `apps/admin/package*.json` | `Ctrl+C` → `npm ci --prefix apps/admin` → `npm run admin:dev` |
| Только public web React/CSS | обычно Vite HMR достаточно |
| `apps/web/package*.json` | `Ctrl+C` → `npm ci --prefix apps/web` → `npm run web:dev` |
| Python в `apps/api` | `docker compose -f infra/docker-compose.api.yml up -d --build --force-recreate api_backend` → Alembic → `/health` |
| Alembic migration | rebuild API при необходимости → `alembic upgrade head` → `/health` |
| Dockerfile / Python dependencies | rebuild affected image/service |
| `infra/docker-compose.api.yml` или backend env | recreate affected services; затем `/health` |

Главное backend-правило:

```text
apps/api копируется внутрь Docker image.
Простой restart контейнера не загружает изменённый Python-код.
```

---

# 10. Остановка локального контура

Admin, web и Expo:

```text
Ctrl+C
```

Docker без удаления данных:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
docker compose -f infra/docker-compose.api.yml down
```

Не добавляйте `-v`, если не хотите удалить PostgreSQL и MinIO volumes.

---

# 11. Быстрая диагностика

## Admin или web показывает API error

```powershell
docker compose -f infra/docker-compose.api.yml ps -a
curl.exe --fail http://127.0.0.1:8000/health
docker compose -f infra/docker-compose.api.yml logs --tail=200 api_backend
```

## После merge остался старый API

```powershell
docker compose -f infra/docker-compose.api.yml up -d --build --force-recreate api_backend
docker compose -f infra/docker-compose.api.yml exec api_backend alembic upgrade head
curl.exe --fail http://127.0.0.1:8000/health
```

## Web работает, но `/api/health` нет

```powershell
curl.exe --fail http://127.0.0.1:8000/health
Get-Content apps/web/.env.local
curl.exe --fail http://localhost:5174/api/health
```

Если direct API green, искать проблему в web proxy/env.

## Email code не приходит

```powershell
docker compose -f infra/docker-compose.api.yml ps -a
docker compose -f infra/docker-compose.api.yml logs --tail=100 api_mailpit api_backend
```

Открыть:

```text
http://127.0.0.1:8025
```

## iPhone не видит API

На PC:

```powershell
curl.exe --fail http://127.0.0.1:8000/health
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.AddressState -eq "Preferred" } | Select-Object InterfaceAlias,IPAddress
```

Потом:

```text
http://<LAN-IP>:8000/health
```

Сначала открыть на PC, затем на iPhone Safari.

Проверить, что `.env.local` содержит тот же LAN IP.

## Port 8000 занят

```powershell
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
```

Определите процесс, который занял порт, прежде чем перезапускать API.

---

# 12. Автоматические проверки перед merge

Это проверки кода, а не browser/Expo smoke:

```powershell
npm run typecheck
npm run admin:typecheck
npm run admin:build
npm run web:typecheck
npm run web:test
npm run web:build
git diff --check
```

Parity web-registration:

```powershell
npm run check:web-registration-parity
```

Browser smoke и Expo/iPhone smoke выполняются владельцем вручную.

---

# 13. Команды, которые нельзя использовать для обычного запуска

Не выполнять без отдельного осознанного решения владельца:

```text
docker compose -f infra/docker-compose.api.yml down -v
npx supabase db reset
```

`down -v` удаляет локальные Docker volumes, включая PostgreSQL и MinIO.

`npx supabase db reset` относится к историческому Supabase-контуру и не нужен для текущего FastAPI/PostgreSQL runtime.
