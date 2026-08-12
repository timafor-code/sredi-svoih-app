# «Среди Своих»: локальный запуск и ручное тестирование

Единая памятка для Windows PowerShell. Все команды выполняются из корня репозитория:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
```

Текущий локальный runtime состоит из четырёх частей:

| Контур | Команда запуска | Адрес |
| --- | --- | --- |
| Python API, PostgreSQL, MinIO и Mailpit | Docker Compose | `http://127.0.0.1:8000` |
| Web-admin | `npm run admin:dev` | `http://localhost:5173` |
| Публичная web-регистрация | `npm run web:dev` | `http://localhost:5174` |
| Мобильное приложение на физическом iPhone | `npm run mobile:iphone` | Expo Go / `http://localhost:8081` |

Supabase для текущего API-only runtime запускать не требуется. Исторические Supabase migrations остаются архивом и не являются рабочим локальным контуром приложения.

## 1. Самый частый сценарий: запустить всё

Откройте четыре окна PowerShell.

### Окно 1 — API и все Docker-сервисы

Полный ежедневный запуск, включая платную web-регистрацию. Флаг нужно задать
**до** команды Docker Compose в том же окне PowerShell:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
$env:API_PUBLIC_WEB_PAID_REGISTRATION_ENABLED="true"
docker compose -f infra/docker-compose.api.yml up -d
docker compose -f infra/docker-compose.api.yml exec api_backend alembic upgrade head
docker compose -f infra/docker-compose.api.yml exec api_backend printenv API_PUBLIC_WEB_PAID_REGISTRATION_ENABLED
docker compose -f infra/docker-compose.api.yml ps
```

Команда `printenv` должна вывести `true`. Если она выводит `false` или пустую
строку, платное событие с `internal_paid` намеренно возвращает `404`, а public
web показывает экран «Регистрация недоступна».

Переменная `$env:...` действует только в текущем окне PowerShell. Чтобы не
вводить её после каждого нового запуска, сохраните gate в корневом `.env` по
инструкции раздела 3.

Если вы переключили ветку, получили новый backend-код или изменился `apps/api`:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
$env:API_PUBLIC_WEB_PAID_REGISTRATION_ENABLED="true"
docker compose -f infra/docker-compose.api.yml up -d --build --force-recreate api_backend
docker compose -f infra/docker-compose.api.yml exec api_backend alembic upgrade head
docker compose -f infra/docker-compose.api.yml exec api_backend printenv API_PUBLIC_WEB_PAID_REGISTRATION_ENABLED
docker compose -f infra/docker-compose.api.yml ps
```

### Окно 2 — админка

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
npm run admin:dev
```

Открыть: `http://localhost:5173`.

### Окно 3 — публичная web-регистрация

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
npm run web:dev
```

Открыть ссылку, скопированную из карточки web-регистрации события в админке:

```text
http://localhost:5174/events/<public-slug>
```

Для выбора конкретной даты постоянного события:

```text
http://localhost:5174/events/<public-slug>?occurrence=<occurrence-uuid>
```

### Окно 4 — мобильное приложение с аккаунтами и внутренней регистрацией

Сначала сохраните локальный IP компьютера и account-режимы в корневом
`.env.local`, как описано в разделе 3. Затем выполните одну каноническую команду:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
npm run mobile:iphone
```

Команда сама запускает или актуализирует локальный Docker-контур и затем запускает
Expo с очищенным Metro cache. На iPhone откройте QR-код через Expo Go. iPhone и
компьютер должны находиться в одной локальной сети.

## 2. Первый запуск на компьютере

Проверьте, что установлены Git, Node.js/npm, Docker Desktop и Expo Go на iPhone. Затем:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
git switch main
git pull origin main
git status --short
npm ci
npm ci --prefix apps/admin
npm ci --prefix apps/web
$env:API_PUBLIC_WEB_PAID_REGISTRATION_ENABLED="true"
docker compose -f infra/docker-compose.api.yml up -d --build
docker compose -f infra/docker-compose.api.yml exec api_backend alembic upgrade head
docker compose -f infra/docker-compose.api.yml exec api_backend printenv API_PUBLIC_WEB_PAID_REGISTRATION_ENABLED
```

Последняя команда должна вывести `true`, если вы собираетесь проверять
`internal_paid`.

Первый Docker-запуск скачивает образы и собирает Python API, поэтому занимает больше времени. Последующие `docker compose ... up -d` используют уже скачанные образы и сохранённые build layers.

## 3. Постоянная локальная конфигурация без повторного ввода переменных

Локальные `.env` и `.env.local` игнорируются Git и не должны
коммититься. Это два разных файла:

- корневой `.env` автоматически читает Docker Compose — здесь хранится локальный
  backend-gate платной web-регистрации;
- корневой `.env.local` читает launcher мобильного приложения — здесь хранятся
  только разрешённые `EXPO_PUBLIC_*` значения.

Чтобы платная web-регистрация не отключалась после закрытия PowerShell, один раз
создайте корневой `.env`:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
if (-not (Test-Path .env)) { New-Item -ItemType File .env | Out-Null }
notepad .env
```

Добавьте и сохраните строку:

```dotenv
API_PUBLIC_WEB_PAID_REGISTRATION_ENABLED=true
```

Примените постоянное значение к уже созданному контейнеру и проверьте его:

```powershell
Remove-Item Env:API_PUBLIC_WEB_PAID_REGISTRATION_ENABLED -ErrorAction SilentlyContinue
docker compose -f infra/docker-compose.api.yml up -d --force-recreate api_backend
docker compose -f infra/docker-compose.api.yml exec api_backend printenv API_PUBLIC_WEB_PAID_REGISTRATION_ENABLED
```

Последняя команда должна вывести `true`. Docker Compose читает корневой `.env`
при каждом запуске из корня репозитория, поэтому значение сохранится и для новых
окон PowerShell.

Остальные локальные файлы создайте один раз, не перезаписывая существующие:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
if (-not (Test-Path .env.local)) { Copy-Item .env.example .env.local }
if (-not (Test-Path apps/admin/.env.local)) { Copy-Item apps/admin/.env.example apps/admin/.env.local }
if (-not (Test-Path apps/web/.env.local)) { Copy-Item apps/web/.env.example apps/web/.env.local }
notepad .env.local
```

Для тестирования мобильного приложения с аккаунтами содержимое корневого `.env.local` должно выглядеть так:

```dotenv
EXPO_PUBLIC_API_URL=http://<LAN-IP>:8000
EXPO_PUBLIC_APP_ACCESS_MODE=account
EXPO_PUBLIC_EVENT_REGISTRATION_MODE=account
```

После сохранения запускайте локальный runtime физического iPhone одной командой:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
npm run mobile:iphone
```

Launcher явно читает только эти три разрешённые mobile-переменные из корневого
`.env.local`. Для `npm run mobile:iphone` файл является источником истины: старые
одноимённые `$env:EXPO_PUBLIC_*` из PowerShell не переопределяют его значения.
Произвольные backend-переменные из файла не копируются в Expo.

Из `EXPO_PUBLIC_API_URL` launcher получает LAN hostname/IP и перед запуском Expo:

- выполняет `docker compose -f infra/docker-compose.api.yml up -d` без удаления
  PostgreSQL или MinIO volumes;
- передаёт только процессу Docker Compose
  `API_OBJECT_STORAGE_HOST_BIND=0.0.0.0`;
- передаёт backend public endpoint для presigned avatar URLs как
  `API_OBJECT_STORAGE_PUBLIC_ENDPOINT_URL=http://<LAN-IP>:59000`;
- запускает Expo с тремя значениями из `.env.local` и `--clear`.

Launcher отклонит невалидный API URL, а также `localhost` и `127.0.0.1`. Проверить
конфигурацию без запуска Docker и Expo можно так:

```powershell
npm run mobile:iphone -- --check
```

Обычный `npx expo start` не изменён. Если он нужен как ручной troubleshooting
fallback и в текущем окне PowerShell ранее задавались `$env:EXPO_PUBLIC_*`, очистить
их можно так:

```powershell
Remove-Item Env:EXPO_PUBLIC_API_URL -ErrorAction SilentlyContinue
Remove-Item Env:EXPO_PUBLIC_APP_ACCESS_MODE -ErrorAction SilentlyContinue
Remove-Item Env:EXPO_PUBLIC_EVENT_REGISTRATION_MODE -ErrorAction SilentlyContinue
```

## 4. Режимы мобильного приложения

Для канонического запуска укажите нужные значения в корневом `.env.local`, затем
выполните `npm run mobile:iphone`. Launcher передаёт значения без скрытой замены на
другой режим.

Ниже оставлены ручные команды только как troubleshooting fallback для обычного
`npx expo start`.

### Приложение с аккаунтами и внутренней регистрацией на события

```powershell
$env:EXPO_PUBLIC_API_URL="http://<LAN-IP>:8000"
$env:EXPO_PUBLIC_APP_ACCESS_MODE="account"
$env:EXPO_PUBLIC_EVENT_REGISTRATION_MODE="account"
npx expo start --clear
```

### Приложение с аккаунтами, но с переходом на публичную web-регистрацию

```powershell
$env:EXPO_PUBLIC_API_URL="http://<LAN-IP>:8000"
$env:EXPO_PUBLIC_APP_ACCESS_MODE="account"
$env:EXPO_PUBLIC_EVENT_REGISTRATION_MODE="public_web"
npx expo start --clear
```

### Гостевое приложение с переходом на публичную web-регистрацию

```powershell
$env:EXPO_PUBLIC_API_URL="http://<LAN-IP>:8000"
$env:EXPO_PUBLIC_APP_ACCESS_MODE="guest_only"
$env:EXPO_PUBLIC_EVENT_REGISTRATION_MODE="public_web"
npx expo start --clear
```

### Полностью гостевой вариант без регистрации на события

```powershell
$env:EXPO_PUBLIC_API_URL="http://<LAN-IP>:8000"
$env:EXPO_PUBLIC_APP_ACCESS_MODE="guest_only"
$env:EXPO_PUBLIC_EVENT_REGISTRATION_MODE="disabled"
npx expo start --clear
```

Неизвестные или пропущенные значения работают безопасно: приложение переходит в `guest_only`, а регистрация — в `disabled`.

## 5. Как узнать LAN IP компьютера

В PowerShell:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.AddressState -eq "Preferred" } | Select-Object InterfaceAlias,IPAddress
```

Обычно нужен IPv4 активного Wi-Fi или Ethernet, например `192.168.1.25`. Тогда:

```text
EXPO_PUBLIC_API_URL=http://192.168.1.25:8000
```

С iPhone проверьте доступность API в Safari:

```text
http://192.168.1.25:8000/health
```

Затем проверьте доступность MinIO для прямой загрузки аватара:

```text
http://192.168.1.25:59000
```

XML/S3 error или `AccessDenied` допустимы: они подтверждают, что iPhone видит
object storage. Ошибка сетевого подключения означает, что LAN-доступ всё ещё
заблокирован.

Если Windows Firewall блокирует порт `59000`, администратор компьютера может вручную
добавить правило:

```powershell
New-NetFirewallRule -DisplayName "Sredi Svoih MinIO 59000" -Direction Inbound -Protocol TCP -LocalPort 59000 -Action Allow
```

Launcher не меняет Windows Firewall и не требует запуска с повышенными правами.
Если API-адрес не открывается, проверьте общую Wi-Fi сеть и разрешение Windows
Firewall для Docker/порта `8000`. На физическом iPhone нельзя использовать
`127.0.0.1` или `localhost`: они указывают на сам телефон.

## 6. API, база, почта и object storage

### Проверка API

```powershell
curl.exe http://127.0.0.1:8000/health
curl.exe http://127.0.0.1:8000/version
```

Полезные адреса:

- API: `http://127.0.0.1:8000`;
- Swagger / FastAPI docs: `http://127.0.0.1:8000/docs`;
- Mailpit: `http://127.0.0.1:8025`;
- MinIO console: `http://127.0.0.1:59001`;
- PostgreSQL с компьютера: `localhost:55432`.

Mobile, admin и public web обращаются только к Python API. Подключать их напрямую к PostgreSQL нельзя.

### Статус контейнеров

```powershell
docker compose -f infra/docker-compose.api.yml ps
```

### Логи API

```powershell
docker compose -f infra/docker-compose.api.yml logs -f --tail=100 api_backend
```

### Логи всех Docker-сервисов

```powershell
docker compose -f infra/docker-compose.api.yml logs -f --tail=100
```

Выход из просмотра логов: `Ctrl+C`. Контейнеры при этом продолжают работать.

### Применить миграции

Если API уже запущен:

```powershell
docker compose -f infra/docker-compose.api.yml exec api_backend alembic upgrade head
```

Если контейнер API не запускается, миграцию можно выполнить временным контейнером:

```powershell
docker compose -f infra/docker-compose.api.yml run --rm api_backend alembic upgrade head
```

### Пересобрать только API после backend-изменений

Код API копируется в Docker image. Обычный `restart` новый код не подхватит — нужна пересборка:

```powershell
docker compose -f infra/docker-compose.api.yml up -d --build --force-recreate api_backend
docker compose -f infra/docker-compose.api.yml exec api_backend alembic upgrade head
docker compose -f infra/docker-compose.api.yml logs -f --tail=100 api_backend
```

### Полностью перезапустить Docker-контур без удаления данных

```powershell
docker compose -f infra/docker-compose.api.yml down
docker compose -f infra/docker-compose.api.yml up -d --build
docker compose -f infra/docker-compose.api.yml exec api_backend alembic upgrade head
```

`down` без `-v` сохраняет PostgreSQL и MinIO volumes. Не используйте `down -v`, если не хотите удалить локальную API-базу и объекты.

## 7. Публичная web-регистрация

### Обычная бесплатная регистрация

```powershell
docker compose -f infra/docker-compose.api.yml up -d
npm run web:dev
```

В админке у события должны быть:

- статус `published`;
- видимость `public`;
- режим регистрации `internal_free`;
- web-публикация `Только по ссылке` (`unlisted`) или `listed`;
- действующее согласие на регистрацию;
- сохранённый публичный slug.

Код подтверждения email приходит не во внешнюю почту, а в локальный Mailpit:

```text
http://127.0.0.1:8025
```

### Платная web-регистрация в локальном тесте

Платный backend-gate по умолчанию выключен. Если вы выполнили полный запуск из
раздела 1 или сохранили `true` в корневом `.env` по разделу 3, он уже включён.
Всегда проверяйте фактическое значение внутри контейнера:

```powershell
docker compose -f infra/docker-compose.api.yml exec api_backend printenv API_PUBLIC_WEB_PAID_REGISTRATION_ENABLED
```

Ожидаемый результат — `true`. Для одноразового включения только в текущем окне
PowerShell:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
$env:API_PUBLIC_WEB_PAID_REGISTRATION_ENABLED="true"
docker compose -f infra/docker-compose.api.yml up -d --build --force-recreate api_backend
docker compose -f infra/docker-compose.api.yml exec api_backend alembic upgrade head
docker compose -f infra/docker-compose.api.yml exec api_backend printenv API_PUBLIC_WEB_PAID_REGISTRATION_ENABLED
npm run web:dev
```

В другом окне запустите админку:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
npm run admin:dev
```

Для платного события нужен `registration_mode=internal_paid`. Текущая реализация
создаёт регистрацию со статусами `pending/pending`, но не проводит реальную оплату
и не должна показывать, что платёж завершён.

Вернуть безопасное значение gate `false`:

1. В корневом `.env` удалите строку
   `API_PUBLIC_WEB_PAID_REGISTRATION_ENABLED=true` или замените `true` на
   `false`.
2. Выполните:

```powershell
Remove-Item Env:API_PUBLIC_WEB_PAID_REGISTRATION_ENABLED -ErrorAction SilentlyContinue
docker compose -f infra/docker-compose.api.yml up -d --force-recreate api_backend
docker compose -f infra/docker-compose.api.yml exec api_backend printenv API_PUBLIC_WEB_PAID_REGISTRATION_ENABLED
```

Последняя команда должна вывести `false`.

## 8. Админка

Проверить локальные настройки:

```powershell
Get-Content apps/admin/.env.local
```

Ожидаемые значения:

```dotenv
VITE_API_URL=http://127.0.0.1:8000
VITE_ADMIN_ENV_LABEL=staging
VITE_ADMIN_BASE_PATH=/
```

Запуск:

```powershell
npm run admin:dev
```

Vite автоматически обновляет страницу после обычных изменений React/CSS. После изменения зависимостей остановите процесс через `Ctrl+C`, затем:

```powershell
npm ci --prefix apps/admin
npm run admin:dev
```

## 9. Public web

Проверить локальные настройки:

```powershell
Get-Content apps/web/.env.local
```

Ожидаемые значения:

```dotenv
VITE_WEB_API_BASE_URL=/api
VITE_WEB_API_PROXY_TARGET=http://127.0.0.1:8000
```

Запуск:

```powershell
npm run web:dev
```

Vite proxy перенаправляет `/api` на локальный Python API. После изменения зависимостей:

```powershell
npm ci --prefix apps/web
npm run web:dev
```

## 10. После переключения ветки или получения нового PR

Сначала остановите Expo, admin и public web через `Ctrl+C`. Затем:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
git status --short
git switch main
git pull origin main
npm ci
npm ci --prefix apps/admin
npm ci --prefix apps/web
docker compose -f infra/docker-compose.api.yml up -d --build
docker compose -f infra/docker-compose.api.yml exec api_backend alembic upgrade head
```

После этого снова запустите admin, public web и Expo в отдельных окнах.

Если тестируется конкретный PR через GitHub CLI:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
git status --short
gh pr checkout <PR-number>
npm ci
npm ci --prefix apps/admin
npm ci --prefix apps/web
docker compose -f infra/docker-compose.api.yml up -d --build
docker compose -f infra/docker-compose.api.yml exec api_backend alembic upgrade head
```

Не переключайте ветку при наличии неожиданных modified/staged файлов. Не добавляйте в commit локальные `.env.local`, `supabase/functions/`, `supabase/snippets/` или `500`.

## 11. Что именно перезапускать после изменений

| Что изменилось | Что сделать |
| --- | --- |
| Только admin React/CSS | Обычно ничего: Vite HMR обновит страницу |
| `apps/admin/package*.json` | `Ctrl+C`, `npm ci --prefix apps/admin`, `npm run admin:dev` |
| Только public web React/CSS | Обычно ничего: Vite HMR обновит страницу |
| `apps/web/package*.json` | `Ctrl+C`, `npm ci --prefix apps/web`, `npm run web:dev` |
| Mobile JS/TS | Expo обычно обновит приложение автоматически |
| Mobile env или странный Metro cache | `Ctrl+C`, затем `npm run mobile:iphone` |
| Python API | `docker compose ... up -d --build --force-recreate api_backend` |
| Alembic migration | Пересобрать API и выполнить `alembic upgrade head` |
| Docker Compose или backend env | Пересоздать затронутые сервисы, при сомнении — весь API-контур |

## 12. Остановка

Admin, public web и Expo останавливаются в своих окнах через:

```text
Ctrl+C
```

Остановить Docker-контур без удаления данных:

```powershell
cd F:\2026\SS-App\code\sredi-svoih-app
docker compose -f infra/docker-compose.api.yml down
```

## 13. Быстрая диагностика

### Админка или web-регистрация показывает API error

```powershell
docker compose -f infra/docker-compose.api.yml ps
curl.exe http://127.0.0.1:8000/health
docker compose -f infra/docker-compose.api.yml logs --tail=200 api_backend
```

### После merge виден старый backend-код

```powershell
docker compose -f infra/docker-compose.api.yml up -d --build --force-recreate api_backend
docker compose -f infra/docker-compose.api.yml exec api_backend alembic upgrade head
```

### Web-регистрация пишет, что email недоступен

```powershell
docker compose -f infra/docker-compose.api.yml up -d api_mailpit api_backend
docker compose -f infra/docker-compose.api.yml logs --tail=100 api_mailpit api_backend
```

Затем откройте `http://127.0.0.1:8025`.

### Публичная страница события недоступна

Сначала проверьте фактический платный gate:

```powershell
docker compose -f infra/docker-compose.api.yml exec api_backend printenv API_PUBLIC_WEB_PAID_REGISTRATION_ENABLED
```

Если платное событие `internal_paid`, а команда выводит `false` или пустую строку:

```powershell
$env:API_PUBLIC_WEB_PAID_REGISTRATION_ENABLED="true"
docker compose -f infra/docker-compose.api.yml up -d --force-recreate api_backend
docker compose -f infra/docker-compose.api.yml exec api_backend printenv API_PUBLIC_WEB_PAID_REGISTRATION_ENABLED
```

Ожидаемый результат — `true`. Затем обновите страницу; `npm run web:dev`
перезапускать не требуется.

Если gate уже `true`, проверьте в админке статус `published`, видимость
`public`, режим `internal_free` или `internal_paid`, web-публикацию, slug и
действующее согласие.

### iPhone не видит API

```powershell
curl.exe http://127.0.0.1:8000/health
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.AddressState -eq "Preferred" } | Select-Object InterfaceAlias,IPAddress
```

Проверьте `http://<LAN-IP>:8000/health` сначала в браузере компьютера, затем в Safari на iPhone.

### Avatar upload на iPhone завершается `Network request failed`

Запустите приложение через `npm run mobile:iphone`, затем откройте в Safari на
iPhone `http://<LAN-IP>:59000`. XML/S3 error или `AccessDenied` допустимы. Если
соединения нет, проверьте Windows Firewall и при необходимости добавьте описанное в
разделе 5 ручное inbound-правило для TCP `59000`.

## 14. Команды проверок перед merge

Это автоматические проверки, а не browser/Expo smoke:

```powershell
npm run typecheck
npm run admin:typecheck
npm run admin:build
npm run web:typecheck
npm run web:test
npm run web:build
git diff --check
```

Комплексная проверка parity web-регистрации:

```powershell
npm run check:web-registration-parity
```

Browser smoke и Expo/iPhone smoke выполняются владельцем вручную.

## 15. Команды, которые нельзя использовать без отдельного осознанного решения

Не запускайте для обычного тестирования:

```text
docker compose -f infra/docker-compose.api.yml down -v
npx supabase db reset
```

Первая команда удаляет локальные Docker volumes, включая API PostgreSQL и MinIO. Вторая относится к историческому Supabase-контуру и запрещена без отдельной явной команды владельца проекта.
