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
| `ADMIN_PASSWORD` | _(генерируется)_ | Первый пароль вместо файла |
| `SKIP_DOWNLOAD` | `0` | `1` — не качать GitHub, собрать из `INSTALL_DIR` |
| `ALLOW_DEFAULT_PASSWORD` | `0` | `1` — см. раздел «Пароль» ниже |

После установки откройте `http://IP_СЕРВЕРА:8080`.

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

Поддержать проект — поставь звезду на GitHub или донат. Связаться с автором — Telegram.

| Способ | Ссылка |
|--------|--------|
| GitHub | [репозиторий](https://github.com/andrey271192/Amnezia_web) |
| Boosty | [boosty.to/lot_andrey](https://boosty.to/lot_andrey) |
| Ozon СБП | _добавьте свою постоянную ссылку СБП сюда и при желании замените цель ссылки «Ozon СБП» в `public/index.html`_ |
| Telegram | [@lot_andrey](https://t.me/lot_andrey) |

Файл [`.github/FUNDING.yml`](.github/FUNDING.yml) задаёт кнопку **Sponsor** на GitHub (см. [документацию GitHub](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/displaying-a-sponsor-button-in-your-repository)).

Тот же блок поддержки продублирован в **футере веб-интерфейса** (как в эталонном макете: название · GitHub · Boosty · Ozon СБП · Telegram).

---

## Лицензия

MIT, см. [LICENSE](LICENSE).
