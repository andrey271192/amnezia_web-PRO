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
  # Поддержка GITHUB_TOKEN / GH_TOKEN: для приватных репозиториев публичный
  # URL /archive/refs/heads/<branch>.tar.gz отдаёт 404 без авторизации.
  GH_AUTH_TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  if [[ -n "${GH_AUTH_TOKEN}" ]]; then
    CURL_OPTS+=(-H "Authorization: Bearer ${GH_AUTH_TOKEN}")
    CURL_OPTS+=(-H "X-GitHub-Api-Version: 2022-11-28")
  fi
  CURL_URL="${GITHUB_REPO_URL_OVERRIDE:-}"
  if [[ -z "${CURL_URL}" ]]; then
    if [[ -n "${GH_AUTH_TOKEN}" ]]; then
      # API-tarball работает и для приватных репо, и для публичных.
      CURL_URL="https://api.github.com/repos/${GITHUB_REPO}/tarball/${BRANCH}"
    else
      CURL_URL="https://github.com/${GITHUB_REPO}/archive/refs/heads/${BRANCH}.tar.gz"
    fi
  fi
  if ! curl "${CURL_OPTS[@]}" "${CURL_URL}" | tar xz -C "${TMP}"; then
    echo "Ошибка: не удалось скачать или распаковать архив (${CURL_URL})."
    echo "Подсказка: проверьте токен (для приватного репо нужен GITHUB_TOKEN/GH_TOKEN с правом Contents:Read), ping/curl до github.com, при необходимости export GITHUB_REPO_URL_OVERRIDE='…' или INSTALL_SCRIPT_VERBOSE=1."
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
  rm -rf "${INSTALL_DIR}"
  mkdir -p "$(dirname "${INSTALL_DIR}")"
  mv "${__extracted_dir}" "${INSTALL_DIR}"
  TMP=""
  echo "→ Источники на месте."
fi

mkdir -p "${DATA_DIR}"

# При повторном запуске не менять внешний порт панели, если не указали HOST_PORT явно (по умолчанию 8080).
PREV_HOST_PORT=""
if docker inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
  # Контейнер может быть остановлен — `docker port` тогда код ≠ 0; при pipefail без этого блока скрипт выходит молча.
  __dock_port_out=""
  __dock_port_out="$(docker port "${CONTAINER_NAME}" 3980/tcp 2>/dev/null)" || :
  if [[ -n "${__dock_port_out}" ]]; then
    PREV_HOST_PORT="$(printf '%s\n' "${__dock_port_out}" | head -n1 | awk -F: '{print $NF}')" || PREV_HOST_PORT=""
  fi
  if [[ -n "${PREV_HOST_PORT}" && "${HOST_PORT}" == "8080" ]]; then
    HOST_PORT="${PREV_HOST_PORT}"
    echo "→ Уже запущен ${CONTAINER_NAME}: сохраняю внешний порт ${HOST_PORT} (укажите HOST_PORT=… чтобы сменить)."
  fi
fi

BOOT_PW=""
PASS_FILE="/root/amnezia-admin.initial-password"
if [[ -f "${DATA_DIR}/password.hash" ]]; then
  echo "→ В ${DATA_DIR} уже есть password.hash — контейнер поднимется с прежним паролем."
elif [[ -n "${ADMIN_PASSWORD:-}" ]]; then
  BOOT_PW="${ADMIN_PASSWORD}"
  echo "→ Использую ADMIN_PASSWORD из окружения."
elif [[ "${ALLOW_DEFAULT_PASSWORD:-}" == "1" ]] || [[ "${ALLOW_DEFAULT_PASSWORD:-}" == "true" ]]; then
  echo "→ ALLOW_DEFAULT_PASSWORD=1 — см. README, пароль по умолчанию для входа."
else
  BOOT_PW="$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 22 || openssl rand -hex 16)"
  umask 077
  printf '%s\n' "${BOOT_PW}" >"${PASS_FILE}"
  echo "→ Первый пароль записан в ${PASS_FILE}"
fi

# AWG_PROFILES: не терять при апдейте без переменной (пропадает список «Инстанс»).
AWG_PROFILE_SNAPSHOT="/root/amnezia-admin.awg-profiles.json"
if [[ -n "${AWG_PROFILES:-}" ]]; then
  umask 077
  printf '%s\n' "${AWG_PROFILES}" >"${AWG_PROFILE_SNAPSHOT}" 2>/dev/null || true
elif docker inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
  PREV_AWG_PROFILES=""
  while IFS= read -r __env_line; do
    if [[ "${__env_line}" == AWG_PROFILES=* ]]; then
      PREV_AWG_PROFILES="${__env_line#AWG_PROFILES=}"
      break
    fi
  done < <(docker inspect "${CONTAINER_NAME}" --format '{{range .Config.Env}}{{println .}}{{end}}')
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

if [[ -z "${AWG_PROFILES:-}" ]]; then
  __awg_multi_count="$(
    docker ps --format '{{.Names}}' 2>/dev/null | awk '/^amnezia-awg/ { c++ } END { print c + 0 }' | tr -d '[:space:]'
  )"
  if [[ "${__awg_multi_count:-0}" =~ ^[0-9]+$ ]] && [[ "${__awg_multi_count}" -gt 1 ]]; then
    echo "⚠ Запущено ${__awg_multi_count} контейнеров с именами amnezia-awg*, но AWG_PROFILES не задан."
    echo "  Переключатель «Инстанс» в панели не появится: см. README, раздел «Несколько инстансов» и «Переменные окружения и sudo»."
    echo "  Без sudo -E: запишите JSON одной строкой в ${AWG_PROFILE_SNAPSHOT} и снова запустите этот установщик."
  fi
fi

PREV_CONTAINER_ENV=""
if docker inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
  PREV_CONTAINER_ENV="$(docker inspect "${CONTAINER_NAME}" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null || true)"
fi
for __ui_var in UI_HIDE_SECTIONS UI_HIDE_USERS UI_HIDE_WARP UI_HIDE_CASCADE WARP_SSH_INSTALL_DIR; do
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
  -e AWG_CONTAINER="${AWG_CONTAINER:-amnezia-awg2}"
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

for __export_var in CLIENT_CONFIG_ENDPOINT CLIENT_EXPORT_DNS1 CLIENT_EXPORT_DNS2 EXPORT_CONFIG_SECRET; do
  if [[ -n "${!__export_var:-}" ]]; then
    RUN_ENV+=( -e "${__export_var}=${!__export_var}" )
  fi
done

for __ui_var in UI_HIDE_SECTIONS UI_HIDE_USERS UI_HIDE_WARP UI_HIDE_CASCADE WARP_SSH_INSTALL_DIR; do
  if [[ -n "${!__ui_var:-}" ]]; then
    RUN_ENV+=( -e "${__ui_var}=${!__ui_var}" )
  fi
done

if [[ -n "${BOOT_PW}" ]]; then
  RUN_ENV+=( -e "ADMIN_PASSWORD=${BOOT_PW}" )
elif [[ "${ALLOW_DEFAULT_PASSWORD:-}" == "1" ]] || [[ "${ALLOW_DEFAULT_PASSWORD:-}" == "true" ]]; then
  RUN_ENV+=( -e "ALLOW_DEFAULT_PASSWORD=1" )
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

echo ""
echo "=== Готово ==="
echo "Админ-панель: http://${IP:-SERVER_IP}:${HOST_PORT}"
if [[ "${SKIP_LANDING:-}" != "1" ]]; then
  echo "Лендинг для пользователей: http://${IP:-SERVER_IP}:${LANDING_PORT}/ (ссылки доната автора — только в админ-панели)"
fi
if [[ -f "${PASS_FILE}" ]]; then
  echo "Первый пароль: $(cat "${PASS_FILE}")"
fi
if [[ "${ALLOW_DEFAULT_PASSWORD:-}" == "1" ]] || [[ "${ALLOW_DEFAULT_PASSWORD:-}" == "true" ]]; then
  echo "Пароль по умолчанию (смените в панели): AmneziaAdmin!ChangeMe"
fi
echo ""
echo "Удаление: curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO}/${BRANCH}/scripts/uninstall.sh | sudo bash"
