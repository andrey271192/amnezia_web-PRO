#!/usr/bin/env bash
# Удаление контейнера и опционально данных (см. README).
set -euo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-amnezia-admin}"
IMAGE_NAME="${IMAGE_NAME:-amnezia-admin:latest}"
INSTALL_DIR="${INSTALL_DIR:-/opt/amnezia-admin}"
DATA_DIR="${DATA_DIR:-/opt/amnezia-admin-data}"

need_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    echo "Запустите от root: curl ... | sudo bash"
    exit 1
  fi
}

need_root

echo "→ Останавливаю лендинг ${LANDING_CONTAINER:-amnezia-web-landing}..."
docker rm -f "${LANDING_CONTAINER:-amnezia-web-landing}" 2>/dev/null || echo "(лендинг уже отсутствует)"

echo "→ Останавливаю контейнер ${CONTAINER_NAME}..."
docker rm -f "${CONTAINER_NAME}" 2>/dev/null || echo "(контейнер уже отсутствует)"

if [[ "${REMOVE_LANDING_IMAGE:-}" == "1" ]]; then
  echo "→ Удаляю образ ${LANDING_IMAGE:-amnezia-web-landing:latest}..."
  docker rmi "${LANDING_IMAGE:-amnezia-web-landing:latest}" 2>/dev/null || true
fi

if [[ "${REMOVE_IMAGE:-}" == "1" ]]; then
  echo "→ Удаляю образ ${IMAGE_NAME}..."
  docker rmi "${IMAGE_NAME}" 2>/dev/null || true
fi

if [[ "${REMOVE_DATA:-}" == "1" ]]; then
  echo "→ Удаляю данные панели ${DATA_DIR}..."
  rm -rf "${DATA_DIR}"
fi

if [[ "${REMOVE_SRC:-}" == "1" ]]; then
  echo "→ Удаляю каталог исходников ${INSTALL_DIR}..."
  rm -rf "${INSTALL_DIR}"
fi

echo "Готово."
echo "Подсказка: REMOVE_LANDING_IMAGE=1 — удалить образ лендинга; REMOVE_DATA=1 REMOVE_SRC=1 REMOVE_IMAGE=1 curl ... | sudo bash — полная очистка."
