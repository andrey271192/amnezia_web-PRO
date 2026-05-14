#!/usr/bin/env bash
# Cloudflare WARP внутри контейнера AmneziaWG (wgcf → warp.conf → wg-quick).
# Запускать на хосте VPS от root: установка и обслуживание туннеля WARP для панели Amnezia Admin.
# После install управление «кто выходит через WARP» — в веб-панели (раздел WARP). Полное снятие: подкоманда uninstall.
set -euo pipefail

WGCF_VERSION="${WGCF_VERSION:-2.2.30}"
WGCF_BIN="${WGCF_BIN:-/root/wgcf}"
WGCF_ACCOUNT="${WGCF_ACCOUNT:-/root/wgcf-account.toml}"
WGCF_PROFILE="${WGCF_PROFILE:-/root/wgcf-profile.conf}"

usage() {
  echo "Использование: $0 {install|start|stop|status|rekey|uninstall} [имя_контейнера]"
  echo "Переменные: AWG_CONTAINER, WARP_DIR (по умолчанию /opt/warp), AMNEZIA_START_SCRIPT (для uninstall, по умолчанию /opt/amnezia/start.sh)"
  exit 1
}

need_root() {
  if [[ "${EUID:-0}" -ne 0 ]]; then
    echo "Запустите от root."
    exit 1
  fi
}

pick_container() {
  local c="${2:-${AWG_CONTAINER:-}}"
  if [[ -n "$c" ]] && docker exec "$c" true 2>/dev/null; then
    CONTAINER="$c"
    return 0
  fi
  local -a found=()
  while IFS= read -r n; do found+=("$n"); done < <(docker ps --format '{{.Names}}' | grep -E '^amnezia-awg2$|^amnezia-awg$' || true)
  if [[ ${#found[@]} -eq 1 ]]; then
    CONTAINER="${found[0]}"
    return 0
  fi
  if [[ ${#found[@]} -gt 1 ]]; then
    echo "Несколько контейнеров: ${found[*]}. Укажите вторым аргументом или AWG_CONTAINER="
    exit 1
  fi
  echo "Не найден контейнер amnezia-awg / amnezia-awg2."
  exit 1
}

load_paths() {
  AWG_WARP_DIR="${WARP_DIR:-/opt/warp}"
  AWG_WARP_CONF="${AWG_WARP_DIR}/warp.conf"
  AWG_VPN_CONF=""
  if docker exec "$CONTAINER" test -f /opt/amnezia/awg/awg0.conf 2>/dev/null; then
    AWG_VPN_CONF="/opt/amnezia/awg/awg0.conf"
  elif docker exec "$CONTAINER" test -f /opt/amnezia/awg/wg0.conf 2>/dev/null; then
    AWG_VPN_CONF="/opt/amnezia/awg/wg0.conf"
  else
    for f in /opt/amnezia/awg/wg0.conf /opt/amnezia/awg/awg0.conf /etc/wireguard/wg0.conf; do
      if docker exec "$CONTAINER" test -f "$f" 2>/dev/null; then
        AWG_VPN_CONF="$f"
        break
      fi
    done
  fi
  [[ -n "$AWG_VPN_CONF" ]] || {
    echo "Не найден конфиг WireGuard/AWG в контейнере."
    exit 1
  }
}

install_wgcf() {
  [[ -x "$WGCF_BIN" ]] && return 0
  local arch wa
  arch="$(uname -m)"
  case "$arch" in
    x86_64) wa="amd64" ;;
    aarch64 | arm64) wa="arm64" ;;
    armv7l) wa="armv7" ;;
    *) echo "Архитектура не поддерживается: $arch"; exit 1 ;;
  esac
  wget -q -O "$WGCF_BIN" "https://github.com/ViRb3/wgcf/releases/download/v${WGCF_VERSION}/wgcf_${WGCF_VERSION}_linux_${wa}"
  chmod +x "$WGCF_BIN"
}

ensure_account() {
  if [[ ! -f "$WGCF_ACCOUNT" ]]; then
    echo "Регистрация WARP (wgcf register)…"
    (cd /root && yes | "$WGCF_BIN" register >/dev/null 2>&1 || true)
  fi
  [[ -f "$WGCF_ACCOUNT" ]] || {
    echo "Не создан $WGCF_ACCOUNT"
    exit 1
  }
}

generate_profile() {
  (cd /root && yes | "$WGCF_BIN" generate >/dev/null 2>&1 || true)
  [[ -f "$WGCF_PROFILE" ]] || {
    echo "Не создан $WGCF_PROFILE"
    exit 1
  }
}

resolve_endpoint() {
  local ep
  ep="$(getent ahostsv4 engage.cloudflareclient.com 2>/dev/null | awk 'NR==1{print $1}')"
  [[ -n "$ep" ]] || {
    echo "Не удалось резолвить engage.cloudflareclient.com"
    exit 1
  }
  echo "$ep"
}

build_warp_conf() {
  local endpoint_ip="$1"
  local pk pub addr
  pk="$(awk -F' = ' '/^PrivateKey = /{print $2}' "$WGCF_PROFILE")"
  pub="$(awk -F' = ' '/^PublicKey = /{print $2}' "$WGCF_PROFILE")"
  addr="$(awk -F' = ' '/^Address = /{print $2}' "$WGCF_PROFILE" | cut -d',' -f1)"
  docker exec "$CONTAINER" sh -c "mkdir -p '$AWG_WARP_DIR'"
  docker cp "$WGCF_PROFILE" "${CONTAINER}:${AWG_WARP_DIR}/wgcf-profile.conf" 2>/dev/null || true
  docker exec "$CONTAINER" sh -c "cat > '$AWG_WARP_CONF' <<WARPEOF
[Interface]
PrivateKey = ${pk}
Address = ${addr}
MTU = 1280
Table = off

[Peer]
PublicKey = ${pub}
AllowedIPs = 0.0.0.0/0
Endpoint = ${endpoint_ip}:2408
PersistentKeepalive = 25
WARPEOF
chmod 600 '$AWG_WARP_CONF'"
}

warp_up() {
  docker exec "$CONTAINER" sh -c "wg-quick down '$AWG_WARP_CONF' >/dev/null 2>&1 || true"
  docker exec "$CONTAINER" sh -c "wg-quick up '$AWG_WARP_CONF'"
  docker exec "$CONTAINER" ip addr show warp >/dev/null 2>&1 || {
    echo "Интерфейс warp не поднялся."
    exit 1
  }
}

warp_down() {
  docker exec "$CONTAINER" sh -c "wg-quick down '$AWG_WARP_CONF' 2>/dev/null || true"
}

is_installed() {
  docker exec "$CONTAINER" test -f "$AWG_WARP_CONF" 2>/dev/null
}

is_running() {
  docker exec "$CONTAINER" ip addr show warp >/dev/null 2>&1
}

cmd_uninstall() {
  echo "→ Останавливаю WARP и убираю автозапуск в контейнере ${CONTAINER}…"
  warp_down || true
  local START_SCRIPT="${AMNEZIA_START_SCRIPT:-/opt/amnezia/start.sh}"
  docker exec \
    -e START_SCRIPT="$START_SCRIPT" \
    -e WARP_CONF="$AWG_WARP_CONF" \
    -e WARP_DIR="$AWG_WARP_DIR" \
    "$CONTAINER" sh -c '
set +e
ip rule | awk "/lookup 100/ {print \$1}" | sed "s/://g" | sort -rn | while read -r pr; do ip rule del priority "$pr" 2>/dev/null || true; done
iptables -t nat -S POSTROUTING 2>/dev/null | grep -- "-o warp -j MASQUERADE" | while read -r line; do
  rule=$(echo "$line" | sed "s/^-A /-D /")
  iptables -t nat $rule 2>/dev/null || true
done
ip route flush table 100 2>/dev/null || true
if [ -f "$START_SCRIPT" ] && grep -qF "# --- WARP-MANAGER BEGIN ---" "$START_SCRIPT" 2>/dev/null; then
  sed -i "/# --- WARP-MANAGER BEGIN ---/,/# --- WARP-MANAGER END ---/d" "$START_SCRIPT"
fi
rm -f "$WARP_CONF" "${WARP_DIR}/clients.list" "${WARP_DIR}/wgcf-profile.conf" 2>/dev/null || true
'
  echo "→ Перезапускаю контейнер ${CONTAINER}…"
  docker restart "$CONTAINER" >/dev/null
  echo "Готово: WARP отключён, файлы в контейнере и блок в start.sh убраны."
  echo "Учёт wgcf на хосте при желании удалите вручную: $WGCF_ACCOUNT $WGCF_PROFILE (и $WGCF_BIN, если не нужен)."
}

cmd_install() {
  echo "Бэкап конфигов в контейнере…"
  docker exec "$CONTAINER" sh -c "
    ts=\$(date +%Y%m%d-%H%M%S)
    cp '$AWG_VPN_CONF' '${AWG_VPN_CONF}.bak-warp-'\$ts 2>/dev/null || true
    cp /opt/amnezia/start.sh /opt/amnezia/start.sh.bak-warp-\$ts 2>/dev/null || true
    true
  "
  install_wgcf
  ensure_account
  generate_profile
  local ep
  ep="$(resolve_endpoint)"
  echo "Endpoint: $ep"
  build_warp_conf "$ep"
  warp_up
  echo "Готово: WARP установлен. Управление клиентами — в веб-панели (раздел WARP)."
}

cmd_status() {
  if is_installed; then
    echo "warp.conf: есть ($AWG_WARP_CONF)"
  else
    echo "warp.conf: нет — выполните: $0 install"
    exit 1
  fi
  if is_running; then
    echo "Интерфейс warp: поднят"
    docker exec "$CONTAINER" wg show warp 2>/dev/null || true
    echo -n "Внешний IP через WARP: "
    docker exec "$CONTAINER" sh -c "curl -fsS --interface warp --connect-timeout 4 https://ifconfig.me 2>/dev/null || echo '?'"
    echo
  else
    echo "Интерфейс warp: опущен ($0 start)"
  fi
}

cmd_rekey() {
  is_installed || {
    echo "Сначала install."
    exit 1
  }
  warp_down || true
  rm -f "$WGCF_ACCOUNT"
  ensure_account
  generate_profile
  local ep
  ep="$(resolve_endpoint)"
  build_warp_conf "$ep"
  warp_up
  echo "Ключ WARP перевыпущен. Заново отметьте клиентов в веб-панели и примените маршрутизацию."
}

[[ "${1:-}" ]] || usage
need_root
command -v docker >/dev/null || {
  echo "Нужен docker в PATH."
  exit 1
}

CMD="$1"
pick_container "$@"
load_paths

case "$CMD" in
  install)
    if is_installed && is_running; then
      echo "Уже установлен и работает."
      exit 0
    fi
    if is_installed && ! is_running; then
      echo "Конфиг есть — поднимаю интерфейс…"
      warp_up
      exit 0
    fi
    cmd_install
    ;;
  start)
    is_installed || {
      echo "Нет warp.conf — сначала install."
      exit 1
    }
    is_running && {
      echo "Уже работает."
      exit 0
    }
    warp_up
    echo "WARP поднят."
    ;;
  stop)
    is_installed || exit 0
    warp_down
    echo "WARP остановлен."
    ;;
  uninstall) cmd_uninstall ;;
  status) cmd_status ;;
  rekey) cmd_rekey ;;
  *) usage ;;
esac
