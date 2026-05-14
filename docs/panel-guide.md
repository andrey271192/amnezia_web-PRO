# Руководство по Amnezia Admin WebUI

Краткий справочник по функциям, типичным проблемам и HTTP API.

## Возможности

| Блок в интерфейсе | Назначение |
|-------------------|------------|
| **Инстанс** | Переключение между профилями из `AWG_PROFILES` (разные контейнеры AmneziaWG / Legacy). Виден только если в контейнере панели задан JSON из **двух и более** профилей. |
| **Время** | Отображение часов контейнера и браузера; синхронизация времени хоста VPS по SSH (если доступно). |
| **Cloudflare WARP** | Выбор клиентов (IPv4 `/32`), выход в интернет через интерфейс `warp` в контейнере AWG. |
| **Новый клиент под каскад** | Создание нового peer на сервере с **вашим Endpoint** (промежуточный узел); выдача готового `.conf`. |
| **Пользователи** | Вкл/выкл peer, удаление, переименование, даты отключения; экспорт `.conf` если в записи есть `userData.last_config`. |

## Переключатель «Инстанс» не отображается

1. Проверьте переменную контейнера панели:
   ```bash
   docker inspect amnezia-admin --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^AWG_PROFILES='
   ```
2. Если строки нет — один раз задайте JSON при установке (пример см. в основном [README](../README.md)) или восстановите файл **`/root/amnezia-admin.awg-profiles.json`** на VPS и снова запустите `install.sh` **без** своего `AWG_PROFILES` — установщик подставит значение из файла или из старого контейнера перед удалением.
3. После правок обновите страницу с **жёстким сбросом кэша** (Ctrl+Shift+R).

## Лендинг не поднимается (порт 80 занят)

При ошибке bind `:80` используйте при установке **`SKIP_LANDING=1`** или **`LANDING_PORT=8081`** — админка на `HOST_PORT` (например 8080) от этого не зависит.

## Конфигурации клиентов

- **Старые строки без `last_config`** — полный `.conf` с сервера собрать нельзя (нет приватного ключа). Используйте приложение Amnezia или блок **«Новый клиент под каскад»** (новый ключ на сервере).
- **Экспорт по кнопкам** — только если в `clientsTable` есть **`userData.last_config`** с полем `config` или `client_priv_key`.

## HTTP API (все маршруты под `/`, кроме статики)

Требуют cookie-сессии после **`POST /api/login`**, если не указано иное.

| Метод | Путь | Назначение |
|-------|------|------------|
| GET | `/health` | Проверка живости |
| GET | `/api/session` | Есть ли действующая сессия |
| POST | `/api/login` | `{ "password": "…" }` |
| POST | `/api/logout` | Выход |
| POST | `/api/change-password` | Смена пароля |
| GET | `/api/protocols` | Текущий профиль, список инстансов, подсказка если профиль один |
| POST | `/api/protocol` | `{ "profileId": "…" }` — смена инстанса |
| GET | `/api/clients` | Таблица клиентов и метаданные WARP |
| POST | `/api/clients/disable` | Выключить peer |
| POST | `/api/clients/enable` | Включить peer |
| POST | `/api/clients/delete` | Удалить |
| POST | `/api/clients/rename` | Переименовать |
| POST | `/api/clients/disconnect-date` | Даты отключения / расписание |
| GET/POST | `/api/clients/export-config` | Скачать `.conf`; GET — прямая ссылка (сессия); опционально `?token=…` если задан `EXPORT_CONFIG_SECRET` |
| POST | `/api/clients/create-cascade` | `{ "endpointHost", "endpointPort?", "tunnelIp?", "clientName?", "profileId?" }` — новый peer и файл `.conf` |
| POST | `/api/warp/start` | Поднять WARP |
| POST | `/api/warp/stop` | Остановить WARP |
| POST | `/api/warp/routing` | Политика по клиентам |
| GET | `/api/server-time` | Время и подсказки по поясам |
| GET | `/api/time-sync-capabilities` | Доступность синхронизации по SSH |
| POST | `/api/sync-host-time` | Запись времени на хост через SSH |

Подробности переменных окружения — в таблице установки в [README](../README.md).
