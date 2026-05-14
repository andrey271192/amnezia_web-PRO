#!/usr/bin/env bash
# Установка Amnezia Admin WebUI одной командой (см. README).
set -euo pipefail

GITHUB_REPO="${GITHUB_REPO:-andrey271192/Amnezia_web}"
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
  TMP=$(mktemp -d)
  curl -fsSL \
    -H 'Cache-Control: no-cache' \
    -H 'Pragma: no-cache' \
    "https://github.com/${GITHUB_REPO}/archive/refs/heads/${BRANCH}.tar.gz" \
    | tar xz -C "${TMP}"
  rm -rf "${INSTALL_DIR}"
  mkdir -p "$(dirname "${INSTALL_DIR}")"
  mv "${TMP}/${REPO_SLUG}-${BRANCH}" "${INSTALL_DIR}"
  TMP=""
fi

mkdir -p "${DATA_DIR}"

# При повторном запуске не менять внешний порт панели, если не указали HOST_PORT явно (по умолчанию 8080).
PREV_HOST_PORT=""
if docker inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
  PREV_HOST_PORT="$(docker port "${CONTAINER_NAME}" 3980/tcp 2>/dev/null | head -1 | awk -F: '{print $NF}')"
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

for __warp_var in WARP_DIR WARP_CONF_PATH WARP_CLIENTS_LIST AMNEZIA_START_SCRIPT; do
  if [[ -n "${!__warp_var:-}" ]]; then
    RUN_ENV+=( -e "${__warp_var}=${!__warp_var}" )
  fi
done

for __export_var in CLIENT_CONFIG_ENDPOINT CLIENT_EXPORT_DNS1 CLIENT_EXPORT_DNS2 EXPORT_CONFIG_SECRET; do
  if [[ -n "${!__export_var:-}" ]]; then
    RUN_ENV+=( -e "${__export_var}=${!__export_var}" )
  fi
done

if [[ -n "${BOOT_PW}" ]]; then
  RUN_ENV+=( -e "ADMIN_PASSWORD=${BOOT_PW}" )
elif [[ "${ALLOW_DEFAULT_PASSWORD:-}" == "1" ]] || [[ "${ALLOW_DEFAULT_PASSWORD:-}" == "true" ]]; then
  RUN_ENV+=( -e "ALLOW_DEFAULT_PASSWORD=1" )
fi

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
    echo "→ Лендинг с блоком поддержки: http://${IP:-SERVER_IP}:${LANDING_PORT}/"
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
  echo "Страница с поддержкой проекта: http://${IP:-SERVER_IP}:${LANDING_PORT}/"
fi
if [[ -f "${PASS_FILE}" ]]; then
  echo "Первый пароль: $(cat "${PASS_FILE}")"
fi
if [[ "${ALLOW_DEFAULT_PASSWORD:-}" == "1" ]] || [[ "${ALLOW_DEFAULT_PASSWORD:-}" == "true" ]]; then
  echo "Пароль по умолчанию (смените в панели): AmneziaAdmin!ChangeMe"
fi
echo ""
echo "Удаление: curl -fsSL https://raw.githubusercontent.com/${GITHUB_REPO}/${BRANCH}/scripts/uninstall.sh | sudo bash"
