#!/usr/bin/env bash
# Установка Amnezia Admin WebUI одной командой (см. README).
set -euo pipefail

GITHUB_REPO="${GITHUB_REPO:-andrey271192/amnezia_web-PRO}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/amnezia-admin}"
DATA_DIR="${DATA_DIR:-/opt/amnezia-admin-data}"
CONTAINER_NAME="${CONTAINER_NAME:-amnezia-admin}"
HOST_PORT="${HOST_PORT:-8080}"
LANDING_CONTAINER="${LANDING_CONTAINER:-amnezia-web-landing}"
LANDING_IMAGE="${LANDING_IMAGE:-amnezia-web-landing:latest}"
LANDING_PORT="${LANDING_PORT:-80}"

need_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Запустите от root: sudo bash или: curl ... | sudo bash"
    exit 1
  fi
}

need_docker() {
  command -v docker >/dev/null 2>&1 || {
    echo "Ошибка: нужен Docker."
    exit 1
  }
  docker info >/dev/null 2>&1 || {
    echo "Ошибка: демон Docker не отвечает."
    exit 1
  }
}

need_root
need_docker

REPO_SLUG="${GITHUB_REPO##*/}"
TMP=""
cleanup() {
  [[ -n "${TMP}" ]] && rm -rf "${TMP}"
}
trap cleanup EXIT

# Preserve current container settings before replacing source tree. This makes
# curl-based reinstall safe even when /opt/amnezia-admin is not a git checkout.
PREV_HOST_PORT=""
PREV_DATA_DIR=""
PREV_CONTAINER_ENV=""
if docker inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
  __dock_port_out=""
  __dock_port_out="$(docker port "${CONTAINER_NAME}" 3980/tcp 2>/dev/null)" || :
  if [[ -n "${__dock_port_out}" ]]; then
    PREV_HOST_PORT="$(printf '%s\n' "${__dock_port_out}" | head -n1 | awk -F: '{print $NF}')" || PREV_HOST_PORT=""
  fi
  PREV_DATA_DIR="$(docker inspect "${CONTAINER_NAME}" --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
  PREV_CONTAINER_ENV="$(docker inspect "${CONTAINER_NAME}" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null || true)"
fi
if [[ -n "${PREV_HOST_PORT}" && "${HOST_PORT}" == "8080" ]]; then
  HOST_PORT="${PREV_HOST_PORT}"
  echo "→ Уже запущен ${CONTAINER_NAME}: сохраняю внешний порт ${HOST_PORT} (укажите HOST_PORT=… чтобы сменить)."
fi
if [[ -n "${PREV_DATA_DIR}" && "${DATA_DIR}" == "/opt/amnezia-admin-data" ]]; then
  DATA_DIR="${PREV_DATA_DIR}"
  echo "→ Уже запущен ${CONTAINER_NAME}: сохраняю DATA_DIR ${DATA_DIR}."
fi

if [[ "${SKIP_DOWNLOAD:-}" != "1" ]]; then
  echo "→ Клонирование релиза ${GITHUB_REPO} (${BRANCH})..."
  echo "→ Скачивание tar.gz с GitHub (вывода может не быть 1–10 мин.; при блокировках задайте зеркало GITHUB_REPO_URL_OVERRIDE или см. CURL_MAX_TIME ниже)."
  TMP=$(mktemp -d)
  CURL_OPTS=(
    -fsSL
    -H 'Cache-Control: no-cache'
    -H 'Pragma: no-cache'
    --connect-timeout "${CURL_CONNECT_TIMEOUT:-30}"
    --max-time "${CURL_MAX_TIME:-900}"
    --retry "${CURL_RETRY:-2}"
    --retry-delay "${CURL_RETRY_DELAY:-5}"
    --retry-connrefused
  )
  if [[ "${INSTALL_SCRIPT_VERBOSE:-}" == "1" ]]; then CURL_OPTS+=(--progress-bar); fi
  CURL_URL="${GITHUB_REPO_URL_OVERRIDE:-}"
  if [[ -z "${CURL_URL}" ]]; then
    CURL_URL="https://github.com/${GITHUB_REPO}/archive/refs/heads/${BRANCH}.tar.gz"
  fi
  if ! curl "${CURL_OPTS[@]}" "${CURL_URL}" | tar xz -C "${TMP}"; then
    echo "Ошибка: не удалось скачать или распаковать архив (${CURL_URL})."
    echo "Подсказка: проверьте доступ к github.com, branch/repo, при необходимости export GITHUB_REPO_URL_OVERRIDE='…' или INSTALL_SCRIPT_VERBOSE=1."
    exit 1
  fi
  echo "→ Перенос распакованного дерева в ${INSTALL_DIR}…"
  # API-tarball распаковывается в каталог вида `<owner>-<repo>-<sha7>`,
  # archive/refs/heads — в `<repo>-<branch>`. Поэтому берём первый каталог TMP.
  __extracted_dir="$(find "${TMP}" -mindepth 1 -maxdepth 1 -type d | head -n1)"
  if [[ -z "${__extracted_dir}" ]]; then
    echo "Ошибка: распакованный архив пуст (${CURL_URL})."
    exit 1
  fi
  if [[ -d "${INSTALL_DIR}" && "${AUTO_BACKUP_INSTALL:-1}" != "0" ]]; then
    __install_backup="${INSTALL_DIR}.backup.$(date -u +%Y%m%dT%H%M%SZ)"
    cp -a "${INSTALL_DIR}" "${__install_backup}" 2>/dev/null || true
    echo "→ Backup старых исходников: ${__install_backup}"
  fi
  rm -rf "${INSTALL_DIR}"
  mkdir -p "$(dirname "${INSTALL_DIR}")"
  mv "${__extracted_dir}" "${INSTALL_DIR}"
  TMP=""
  echo "→ Источники на месте."
fi

mkdir -p "${DATA_DIR}"
mkdir -p /opt/amnezia-instances

BOOT_PW=""
PASS_FILE="/root/amnezia-admin.initial-password"
if [[ -n "${ADMIN_PASSWORD:-}" ]]; then
  BOOT_PW="${ADMIN_PASSWORD}"
  if [[ -f "${DATA_DIR}/password.hash" ]]; then
    __pw_backup="${DATA_DIR}/password.hash.bak.$(date -u +%Y%m%dT%H%M%SZ)"
    cp -p "${DATA_DIR}/password.hash" "${__pw_backup}" 2>/dev/null || true
    rm -f "${DATA_DIR}/password.hash"
    rm -f "${DATA_DIR}/session.secret"
    echo "→ ADMIN_PASSWORD задан — сбрасываю старый пароль панели (backup: ${__pw_backup})."
  else
    echo "→ Использую ADMIN_PASSWORD из окружения."
  fi
elif [[ -f "${DATA_DIR}/password.hash" ]]; then
  echo "→ В ${DATA_DIR} уже есть password.hash — контейнер поднимется с прежним паролем."
else
  BOOT_PW="admin"
  umask 077
  printf '%s\n' "${BOOT_PW}" >"${PASS_FILE}"
  echo "→ Первый вход: admin / admin. Смените пароль сразу после входа."
fi

# AWG_PROFILES: не терять при апдейте без переменной (пропадает список «Инстанс»).
AWG_PROFILE_SNAPSHOT="/root/amnezia-admin.awg-profiles.json"
if [[ -n "${AWG_PROFILES:-}" ]]; then
  umask 077
  printf '%s\n' "${AWG_PROFILES}" >"${AWG_PROFILE_SNAPSHOT}" 2>/dev/null || true
elif [[ -n "${PREV_CONTAINER_ENV}" ]]; then
  PREV_AWG_PROFILES=""
  while IFS= read -r __env_line; do
    if [[ "${__env_line}" == AWG_PROFILES=* ]]; then
      PREV_AWG_PROFILES="${__env_line#AWG_PROFILES=}"
      break
    fi
  done <<<"${PREV_CONTAINER_ENV}"
  if [[ -n "${PREV_AWG_PROFILES}" ]]; then
    AWG_PROFILES="${PREV_AWG_PROFILES}"
    echo "→ AWG_PROFILES восстановлен из предыдущего контейнера ${CONTAINER_NAME}."
    umask 077
    printf '%s\n' "${AWG_PROFILES}" >"${AWG_PROFILE_SNAPSHOT}" 2>/dev/null || true
  fi
fi
if [[ -z "${AWG_PROFILES:-}" ]] && [[ -f "${AWG_PROFILE_SNAPSHOT}" ]]; then
  AWG_PROFILES="$(tr -d '\r\n' <"${AWG_PROFILE_SNAPSHOT}" || true)"
  if [[ -n "${AWG_PROFILES}" ]]; then
    echo "→ AWG_PROFILES восстановлен из ${AWG_PROFILE_SNAPSHOT}."
  fi
fi

# Авто-определение единственного контейнера amnezia-awg* (например amnezia-awg2 —
# дефолт Amnezia для AWG 2.0), если AWG_CONTAINER и AWG_PROFILES не заданы вручную.
if [[ -z "${AWG_CONTAINER:-}" ]] && [[ -z "${AWG_PROFILES:-}" ]]; then
  __awg_names="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E '^amnezia-awg' || true)"
  __awg_names_count="$(printf '%s\n' "${__awg_names}" | grep -c . || true)"
  if [[ "${__awg_names_count}" == "1" ]]; then
    AWG_CONTAINER="$(printf '%s\n' "${__awg_names}" | head -n1)"
    echo "→ AWG_CONTAINER авто-определён: ${AWG_CONTAINER}"
  fi
fi

if [[ -z "${AWG_PROFILES:-}" ]]; then
  __awg_names="$(docker ps --format '{{.Names}}' 2>/dev/null | awk '/^amnezia-awg/ { print }' | sort || true)"
  __awg_multi_count="$(printf '%s\n' "${__awg_names}" | sed '/^$/d' | wc -l | tr -d '[:space:]')"
  if [[ "${__awg_multi_count:-0}" =~ ^[0-9]+$ ]] && [[ "${__awg_multi_count}" -eq 1 ]] && [[ -z "${AWG_CONTAINER:-}" ]]; then
    AWG_CONTAINER="$(printf '%s\n' "${__awg_names}" | sed '/^$/d' | head -n1)"
    echo "→ AWG_CONTAINER авто-выбран: ${AWG_CONTAINER}"
  elif [[ "${__awg_multi_count:-0}" =~ ^[0-9]+$ ]] && [[ "${__awg_multi_count}" -gt 1 ]]; then
    __awg_profiles="["
    __sep=""
    while IFS= read -r __awg_name; do
      [[ -z "${__awg_name}" ]] && continue
      __id="${__awg_name#amnezia-}"
      __label="AmneziaWG"
      if [[ "${__awg_name}" == "amnezia-awg2" ]]; then
        __label="AmneziaWG 2.0"
      elif [[ "${__awg_name}" != "amnezia-awg" ]]; then
        __label="AmneziaWG ${__id}"
      fi
      __awg_profiles+="${__sep}{\"id\":\"${__id}\",\"label\":\"${__label}\",\"container\":\"${__awg_name}\",\"confPath\":\"/opt/amnezia/awg/awg0.conf\",\"clientsPath\":\"/opt/amnezia/awg/clientsTable\",\"iface\":\"awg0\",\"wgBinary\":\"awg\",\"pskPath\":\"/opt/amnezia/awg/wireguard_psk.key\"}"
      __sep=","
    done <<<"${__awg_names}"
    __awg_profiles+="]"
    AWG_PROFILES="${__awg_profiles}"
    umask 077
    printf '%s\n' "${AWG_PROFILES}" >"${AWG_PROFILE_SNAPSHOT}" 2>/dev/null || true
    echo "→ AWG_PROFILES авто-собран из контейнеров amnezia-awg*: ${AWG_PROFILE_SNAPSHOT}"
  fi
fi

for __ui_var in UI_HIDE_SECTIONS UI_HIDE_USERS UI_HIDE_WARP UI_HIDE_CASCADE UI_HIDE_MTPROTO WARP_SSH_INSTALL_DIR; do
  if [[ -z "${!__ui_var:-}" ]] && [[ -n "${PREV_CONTAINER_ENV}" ]]; then
    PREV_VAL=""
    while IFS= read -r __line; do
      if [[ "${__line}" == "${__ui_var}="* ]]; then
        PREV_VAL="${__line#*=}"
        break
      fi
    done <<<"${PREV_CONTAINER_ENV}"
    if [[ -n "${PREV_VAL}" ]]; then
      printf -v "${__ui_var}" '%s' "${PREV_VAL}"
      echo "→ ${__ui_var} восстановлен из предыдущего контейнера ${CONTAINER_NAME}."
    fi
  fi
done

DOCKER_BUILD_EXTRA=()
if [[ "${NO_CACHE:-}" == "1" ]]; then
  DOCKER_BUILD_EXTRA+=(--no-cache)
  echo "→ NO_CACHE=1 — сборка без слоя кэша Docker."
fi

echo "→ Сборка образа amnezia-admin:latest ..."
docker build "${DOCKER_BUILD_EXTRA[@]}" -t amnezia-admin:latest "${INSTALL_DIR}"

docker rm -f "${CONTAINER_NAME}" 2>/dev/null || true

RUN_ENV=(
  -e AWG_CONTAINER="${AWG_CONTAINER:-amnezia-awg}"
)

if [[ -n "${AWG_PROFILES:-}" ]]; then
  RUN_ENV+=( -e "AWG_PROFILES=${AWG_PROFILES}" )
fi

if [[ -n "${TIME_SYNC_SSH_HOST:-}" ]]; then
  RUN_ENV+=( -e "TIME_SYNC_SSH_HOST=${TIME_SYNC_SSH_HOST}" )
fi

if [[ -n "${TIME_SYNC_DISABLED:-}" ]]; then
  RUN_ENV+=( -e "TIME_SYNC_DISABLED=${TIME_SYNC_DISABLED}" )
fi

if [[ -n "${TZ:-}" ]]; then
  RUN_ENV+=( -e "TZ=${TZ}" )
fi

for __warp_var in WARP_DIR WARP_CONF_PATH WARP_CLIENTS_LIST AMNEZIA_START_SCRIPT WARP_SSH_INSTALL_DIR; do
  if [[ -n "${!__warp_var:-}" ]]; then
    RUN_ENV+=( -e "${__warp_var}=${!__warp_var}" )
  fi
done

if [[ -z "${CLIENT_CONFIG_ENDPOINT:-}" ]]; then
  __pub_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  if [[ -n "${__pub_ip}" ]]; then
    CLIENT_CONFIG_ENDPOINT="${__pub_ip}"
    echo "→ CLIENT_CONFIG_ENDPOINT авто: ${CLIENT_CONFIG_ENDPOINT} (можно переопределить переменной окружения)"
  fi
fi

for __export_var in CLIENT_CONFIG_ENDPOINT CLIENT_EXPORT_DNS1 CLIENT_EXPORT_DNS2 EXPORT_CONFIG_SECRET; do
  if [[ -n "${!__export_var:-}" ]]; then
    RUN_ENV+=( -e "${__export_var}=${!__export_var}" )
  fi
done

for __ui_var in UI_HIDE_SECTIONS UI_HIDE_USERS UI_HIDE_WARP UI_HIDE_CASCADE UI_HIDE_MTPROTO WARP_SSH_INSTALL_DIR; do
  if [[ -n "${!__ui_var:-}" ]]; then
    RUN_ENV+=( -e "${__ui_var}=${!__ui_var}" )
  fi
done

for __mt_vars in MTPRO_PROXY_CONTAINER MTPRO_PROXY_IMAGE MTPRO_INTERNAL_PORT MTPRO_PUBLISH_PORT \
  MTPRO_PUBLISH_BIND MTPRO_PUBLIC_HOST; do
  if [[ -n "${!__mt_vars:-}" ]]; then
    RUN_ENV+=( -e "${__mt_vars}=${!__mt_vars}" )
  fi
done

if [[ -n "${BOOT_PW}" ]]; then
  RUN_ENV+=( -e "ADMIN_PASSWORD=${BOOT_PW}" )
fi

if [[ -n "${AMNEZIA_EDITION:-}" ]]; then
  RUN_ENV+=( -e "AMNEZIA_EDITION=${AMNEZIA_EDITION}" )
elif [[ -f "${INSTALL_DIR}/.amnezia-panel-edition" ]]; then
  __PE="$(tr -d '\r\n' <"${INSTALL_DIR}/.amnezia-panel-edition" | head -c 48)"
  if [[ -n "${__PE}" ]]; then
    RUN_ENV+=( -e "AMNEZIA_EDITION=${__PE}" )
    echo "→ AMNEZIA_EDITION из ${INSTALL_DIR}/.amnezia-panel-edition: ${__PE}"
  fi
fi
for __ce_var in COMMUNITY_UPGRADE_URL COMMUNITY_UPGRADE_PITCH; do
  if [[ -n "${!__ce_var:-}" ]]; then
    RUN_ENV+=( -e "${__ce_var}=${!__ce_var}" )
  fi
done

IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"

docker run -d --name "${CONTAINER_NAME}" --restart unless-stopped \
  -p "${HOST_PORT}:3980" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "${DATA_DIR}:/data" \
  -v /opt/amnezia-instances:/opt/amnezia-instances \
  "${RUN_ENV[@]}" \
  amnezia-admin:latest

if [[ "${SKIP_LANDING:-}" != "1" ]] && [[ -d "${INSTALL_DIR}/landing" ]]; then
  printf "window.__AMNEZIA_ADMIN_PORT__='%s';\n" "${HOST_PORT}" >"${INSTALL_DIR}/landing/admin-port.js"
  echo "→ Сборка образа ${LANDING_IMAGE} (страница на порту ${LANDING_PORT})..."
  docker build "${DOCKER_BUILD_EXTRA[@]}" -t "${LANDING_IMAGE}" "${INSTALL_DIR}/landing"
  docker rm -f "${LANDING_CONTAINER}" 2>/dev/null || true
  if docker run -d --name "${LANDING_CONTAINER}" --restart unless-stopped \
    -p "${LANDING_PORT}:80" \
    "${LANDING_IMAGE}"; then
    echo "→ Публичная страница (лендинг): http://${IP:-SERVER_IP}:${LANDING_PORT}/"
  else
    echo "⚠ Не удалось запустить лендинг (часто порт ${LANDING_PORT} занят). Поставьте LANDING_PORT=8081 или SKIP_LANDING=1."
  fi
else
  echo "→ Лендинг пропущен (SKIP_LANDING=1 или нет каталога landing)."
fi

# ── Диагностика AmneziaWG: что увидит панель ──────────────────────────────
echo ""
echo "── Проверка AmneziaWG ──"
__awg_running="$(docker ps --format '{{.Names}}' 2>/dev/null | grep -E '^amnezia-?awg|amnezia.*wg|awg' || true)"
__awg_with_conf=""
for __c in $(docker ps --format '{{.Names}}' 2>/dev/null); do
  if docker exec "${__c}" sh -c 'test -f /opt/amnezia/awg/awg0.conf || test -f /opt/amnezia/awg/wg0.conf' 2>/dev/null; then
    __awg_with_conf="${__awg_with_conf} ${__c}"
  fi
done
__awg_with_conf="$(echo "${__awg_with_conf}" | xargs 2>/dev/null || true)"

if [[ -n "${__awg_with_conf}" ]]; then
  echo "✓ Найдены контейнеры AmneziaWG: ${__awg_with_conf}"
  echo "  Панель подхватит их автоматически (рантайм-обнаружение) — ручной AWG_PROFILES не нужен."
  for __c in ${__awg_with_conf}; do
    __cnt="$(docker exec "${__c}" sh -c 'cat /opt/amnezia/awg/clientsTable 2>/dev/null' 2>/dev/null | grep -c clientId || true)"
    __prt="$(docker exec "${__c}" sh -c 'grep -h ListenPort /opt/amnezia/awg/*.conf 2>/dev/null' 2>/dev/null | grep -oE '[0-9]+' | head -1 || true)"
    echo "    • ${__c}: порт ${__prt:-?}/udp, клиентов в таблице: ${__cnt:-0}"
  done
else
  echo "⚠ Не найдено ни одного контейнера AmneziaWG (нет /opt/amnezia/awg/*.conf ни в одном контейнере)."
  echo "  Это НОРМАЛЬНО для чистого VPS. Дальше есть два пути:"
  echo "    1) Развернуть AmneziaWG прямо из панели: раздел «Протоколы / инстансы» → выбрать вариант и порт → «Развернуть инстанс»."
  echo "    2) Поставить сервер приложением Amnezia на этот VPS — панель подхватит контейнер сама."
  echo "  Пока сервера нет, список клиентов будет пустым и создание клиента вернёт ошибку «контейнер не найден» — это ожидаемо."
fi
echo "────────────────────────"

echo ""
echo "=== Готово ==="
echo "Админ-панель: http://${IP:-SERVER_IP}:${HOST_PORT}"
if [[ "${SKIP_LANDING:-}" != "1" ]]; then
  echo "Лендинг для пользователей: http://${IP:-SERVER_IP}:${LANDING_PORT}/ (ссылки доната автора — только в админ-панели)"
fi
if [[ -f "${PASS_FILE}" ]]; then
  echo "Первый пароль: $(cat "${PASS_FILE}")"
fi
echo ""
echo "Удаление: curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO}/${BRANCH}/scripts/uninstall.sh | sudo bash"
