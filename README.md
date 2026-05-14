# Amnezia Admin WebUI

Веб-панель на вашем VPS для управления клиентами **AmneziaWG**: вкл/выкл, удаление, переименование, дата отключения. Работает через Docker и `docker exec` в контейнер **Amnezia** (по умолчанию `amnezia-awg2`).

**Безопасность:** контейнер с монтированием `docker.sock` эквивалентен root на хосте — используйте сложный пароль и по возможности ограничьте доступ по IP или TLS.

---

## Установка одной командой

На сервере под **root** (или через `sudo`), когда репозиторий уже опубликован на GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/andrey271192/Amnezia_web/main/scripts/install.sh | sudo bash
```

Другой репозиторий или ветка:

```bash
GITHUB_REPO=ваш/форк BRANCH=main curl -fsSL https://raw.githubusercontent.com/ваш/форк/main/scripts/install.sh | sudo bash
```

Уже скачали проект вручную в `/opt/amnezia-admin`:

```bash
cd /opt/amnezia-admin && chmod +x scripts/install.sh && sudo SKIP_DOWNLOAD=1 bash scripts/install.sh
```

Переменные установки (необязательно):

| Переменная | По умолчанию | Назначение |
|------------|--------------|------------|
| `GITHUB_REPO` | `andrey271192/Amnezia_web` | Откуда качать архив |
| `BRANCH` | `main` | Ветка |
| `INSTALL_DIR` | `/opt/amnezia-admin` | Куда распаковать исходники |
| `DATA_DIR` | `/opt/amnezia-admin-data` | Том с `password.hash` и сессией |
| `HOST_PORT` | `8080` | Порт HTTP панели на хосте |
| `AWG_CONTAINER` | `amnezia-awg2` | Имя контейнера Amnezia WG |
| `AWG_PROFILES` | _(нет)_ | JSON-массив профилей: несколько контейнеров/путей (см. ниже). Если задан — переключатель «Инстанс» в вебе |
| `SCHEDULE_DISCONNECT_MS` | `60000` | Как часто планировщик проверяет отложенное отключение из туннеля (мс) |
| `TZ` | _(часто UTC в Docker)_ | Пояс строки «Сервер» в панели (IANA, например `Europe/Berlin`). Без `TZ` берётся из образа (часто UTC) — тогда от браузера будет видна разница часов |
| `TIME_SYNC_SSH_HOST` | `172.17.0.1` | Хост для SSH root при синхронизации времени из панели (часто шлюз Docker к хосту) |
| `TIME_SYNC_DISABLED` | `0` | `1` — скрыть/отключить синхронизацию времени по SSH |
| `ADMIN_PASSWORD` | _(генерируется)_ | Первый пароль вместо файла |
| `SKIP_DOWNLOAD` | `0` | `1` — не качать GitHub, собрать из `INSTALL_DIR` |
| `ALLOW_DEFAULT_PASSWORD` | `0` | `1` — см. раздел «Пароль» ниже |
| `SKIP_LANDING` | `0` | `1` — не ставить публичную страницу с футером поддержки |
| `LANDING_PORT` | `80` | Порт nginx-лендинга (если `80` занят — например `8081`) |
| `LANDING_CONTAINER` | `amnezia-web-landing` | Имя контейнера лендинга |
| `NO_CACHE` | `0` | `1` — `docker build --no-cache` при проблемах с обновлением образа |

#### Несколько инстансов (AmneziaWG + Legacy и т.д.)

Пути и имена контейнеров на сервере могут отличаться — проверьте внутри контейнера (`docker exec … ls /opt/amnezia`). Пример **двух** профилей при запуске установщика (одна строка JSON в кавычках):

```bash
AWG_PROFILES='[{"id":"awg","label":"AmneziaWG","container":"amnezia-awg2","confPath":"/opt/amnezia/awg/awg0.conf","clientsPath":"/opt/amnezia/awg/clientsTable","iface":"awg0","wgBinary":"awg"},{"id":"legacy","label":"AmneziaWG Legacy","container":"amnezia-wg0","confPath":"/opt/amnezia/wireguard/wg0.conf","clientsPath":"/opt/amnezia/wireguard/clientsTable","iface":"wg0","wgBinary":"wg"}]' \
curl -fsSL https://raw.githubusercontent.com/andrey271192/Amnezia_web/main/scripts/install.sh | sudo -E bash
```

Для **Legacy** часто используется обычный `wg`, для новой AmneziaWG — `awg`; подставьте свои `container`, `confPath`, `clientsPath`, `iface`, `pskPath` при необходимости.

После установки: **админ-панель** `http://IP:8080` (или ваш `HOST_PORT`), **страница с поддержкой проекта** `http://IP/` на порту лендинга (по умолчанию **80**). Кнопка на лендинге ведёт на админку с тем же `HOST_PORT`.

Футер с ссылками (**Amnezia Admin WebUI**, Boosty, Ozon СБП, Telegram) в админке находится **внизу страницы** — прокрутите ниже таблицы.

### Обновление до новой версии

Коммиты на GitHub **сами не попадают** в уже запущенный контейнер: нужно заново **скачать код и пересобрать образ**.

Проще всего — та же команда, что при установке (данные в `DATA_DIR`, пароль сохранится). Скрипт **подставит прежний внешний порт** контейнера `amnezia-admin`, если вы не передавали `HOST_PORT` и в коде по умолчанию стоит `8080`:

```bash
curl -fsSL https://raw.githubusercontent.com/andrey271192/Amnezia_web/main/scripts/install.sh | sudo bash
```

Если интерфейс после этого всё ещё старый — принудительно без кэша слоёв Docker:

```bash
curl -fsSL https://raw.githubusercontent.com/andrey271192/Amnezia_web/main/scripts/install.sh | sudo NO_CACHE=1 bash
```

Если проект уже лежит в `/opt/amnezia-admin` через git и вы подтянули изменения (`git pull`), пересоберите без повторной загрузки архива:

```bash
cd /opt/amnezia-admin && chmod +x scripts/install.sh && sudo SKIP_DOWNLOAD=1 bash scripts/install.sh
```

Порт при этом возьмётся из уже работающего контейнера так же, как при установке с GitHub.

Подставьте **`HOST_PORT=ваш_порт`** перед `bash`, если нужно явно зафиксировать порт (в том числе сменить его при обновлении).

После обновления сделайте в браузере **жёсткое обновление** страницы (Ctrl+Shift+R / ⌘+Shift+R), если интерфейс всё ещё старый.

Команда на сервере для проверки, что в образ попали новые статические файлы (после установки должно быть **Amnezia Admin WebUI**, не «Kaskad»):

```bash
sudo docker run --rm amnezia-admin:latest grep -E -o 'Amnezia Admin WebUI|Kaskad' /app/public/index.html | head -1
```

---

## Удаление одной командой

```bash
curl -fsSL https://raw.githubusercontent.com/andrey271192/Amnezia_web/main/scripts/uninstall.sh | sudo bash
```

Полная очистка (контейнер, образ, данные панели и каталог `/opt/amnezia-admin`):

```bash
curl -fsSL https://raw.githubusercontent.com/andrey271192/Amnezia_web/main/scripts/uninstall.sh | sudo REMOVE_IMAGE=1 REMOVE_DATA=1 REMOVE_SRC=1 bash
```

---

## Первый вход и пароль

### Режим по умолчанию (рекомендуется)

Скрипт установки **генерирует** пароль и записывает его в файл на сервере:

```bash
sudo cat /root/amnezia-admin.initial-password
```

Войдите в панель этим паролем и сразу смените его в блоке **«Сменить пароль»**.

### Свой пароль при установке

```bash
ADMIN_PASSWORD='ВашНадёжныйПароль' curl -fsSL https://raw.githubusercontent.com/andrey271192/Amnezia_web/main/scripts/install.sh | sudo -E bash
```

После первого успешного старта переменную `ADMIN_PASSWORD` из команды `docker run` убирайте — пароль уже в томе `DATA_DIR`.

### Пароль по умолчанию из документации (только тест / лаборатория)

Если задать при установке **`ALLOW_DEFAULT_PASSWORD=1`**, контейнер создаёт пароль из README:

- **Логин в веб:** пароль по умолчанию **`AmneziaAdmin!ChangeMe`**

Его можно переопределить переменной **`DEFAULT_ADMIN_PASSWORD`** в окружении контейнера до первого создания `password.hash`.

На продакшене этот режим **не рекомендуется**.

### Ручной Docker без скрипта

Нужны том `-v /путь/данных:/data` и **один из** вариантов:

1. `-e ADMIN_PASSWORD=...` при **первом** запуске (файла `password.hash` ещё нет);
2. `-e ALLOW_DEFAULT_PASSWORD=1` — см. пароль выше;
3. готовый файл `password.hash` в томе (продвинутый сценарий).

---

## Разработка и локальный запуск

```bash
npm install
ADMIN_PASSWORD=localtest node server.js
```

Нужны Docker и контейнер Amnezia на той же машине (или проброс `DOCKER_HOST`).

---

## Support links

Как на главной странице установки (**лендинг на порту 80**): **Amnezia Admin WebUI** · GitHub · Boosty · Ozon СБП · Telegram · текст поддержки.

Поддержать проект — поставь звезду на GitHub **И донат**. Связаться с автором — Telegram.

| Способ | Ссылка |
|--------|--------|
| GitHub | [Amnezia_web](https://github.com/andrey271192/Amnezia_web) |
| Boosty | [boosty.to/andrey27/donate](https://boosty.to/andrey27/donate) |
| Ozon СБП | [Ozon СБП](https://finance.ozon.ru/apps/sbp/ozonbankpay/019dc200-2a5d-7931-a619-782d285f6798) |
| Telegram | [@lot_andrey](https://t.me/lot_andrey) |

Ссылки совпадают с блоком в репозитории [domen_hydra](https://github.com/andrey271192/domen_hydra) (Boosty / Ozon), отображаются на **публичной странице** после установки и в футере админ-панели.

Файл [`.github/FUNDING.yml`](.github/FUNDING.yml) задаёт кнопку **Sponsor** на GitHub.

Тот же блок поддержки продублирован в **футере веб-интерфейса** и на **`http://сервер:80/`** (если лендинг не отключён).

---

## Лицензия

MIT, см. [LICENSE](LICENSE).
