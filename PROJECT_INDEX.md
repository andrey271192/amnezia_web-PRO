# PROJECT_INDEX — amnezia_web-PRO

Указатель проекта. Обновляется в конце каждой законченной работы вместе с
заметкой `09. История решений и грабли` и пушем в GitHub.

## Где что лежит

| Что | Где |
|---|---|
| Папка проекта | `/Volumes/ssd/Мои проекты/amnezia_web-PRO/` |
| Заметки | Apple Notes → `МОИ ПРОЕКТЫ` → папка `amnezia_web-PRO` |
| GitHub (публичный) | https://github.com/andrey271192/amnezia_web-PRO |
| Ветка прода | `main` |
| Тестовая копия рядом | `/Volumes/ssd/Мои проекты/amnezia_web-PRO_test/` |

Путь `/Volumes/andrey/Мои проекты/...` из старого промпта синхронизации **не существует** —
актуальная копия только на `/Volumes/ssd`.

## Состав репозитория

| Путь | Что это |
|---|---|
| `server.js` | Бэкенд панели (Node), порт контейнера 3980 |
| `public/` | Фронтенд админки |
| `landing/` | Публичная страница для приглашённых: `index.html`, `styles.css`, `nginx.conf`, `Dockerfile`, `admin-port.js` (порт админки для кнопки, пересобирается установщиком) |
| `Dockerfile` | Образ `amnezia-admin:latest` |
| `scripts/install.sh` | Установщик: сборка образов, запуск контейнеров, диагностика AmneziaWG |
| `scripts/uninstall.sh` | Снос панели и лендинга |
| `scripts/awg-instance.sh` | Работа с инстансами AmneziaWG |
| `scripts/clients-meta.mjs` | Снимок метаданных клиентов (имена, даты) поверх `clientsTable` |
| `scripts/test-clients-meta.mjs` | Тест к нему |
| `scripts/warp-amnezia.sh` | Обвязка WARP |
| `docs/panel-guide.md` | Руководство по панели |
| `README.md` | Порты, переменные окружения, установка, обновление |

Незакоммиченные разовые скрипты разбора в корне (`audit2.py`, `audit_conf.py`,
`check_conf.py`, `check_garbage.py`, `test_create.py`) — отладочные, в git не входят.

## Установка

```bash
curl -fsSL https://raw.githubusercontent.com/andrey271192/amnezia_web-PRO/main/scripts/install.sh | sudo bash
```

Первый вход: `admin` / `admin`, пароль сменить сразу.

## Порты и ключевые переменные

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `HOST_PORT` | `8080` | Админ-панель |
| `LANDING_PORT` | `80` | Публичная страница |
| `SKIP_LANDING` | `0` | `1` — не поднимать лендинг |
| `LANDING_CONTAINER` | `amnezia-web-landing` | Имя контейнера лендинга |
| `CONTAINER_NAME` | `amnezia-admin` | Имя контейнера панели |

## Грабли, которые стоят времени

- **Контейнеры переживают переустановку.** Всё поднимается с `--restart unless-stopped`.
  `SKIP_LANDING=1` на повторной установке не отключал лендинг, пока установщик не начал
  сносить старый контейнер в ветке пропуска (`7b92bfb`, 08.09.2026). Проверка:
  `docker ps --filter name=amnezia-web-landing`.
- **Коммиты сами в контейнер не попадают** — нужна пересборка образа, см. README.
- Разбор остальных случаев — в заметке `09. История решений и грабли`.

## Состояние

- HEAD `7b92bfb` (08.09.2026), совпадает с `origin/main`.
