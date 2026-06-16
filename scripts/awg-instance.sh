#!/usr/bin/env bash
# Deploy / remove an AmneziaWG server instance from public images — no Amnezia app.
# Variants: awg2 (AmneziaWG 2.0, awg-go 2.0.0), awg (classic, awg-go 0.2.18),
#           legacy (kernel WireGuard, amnezia-wg).
# Usage:
#   awg-instance.sh create <variant> <port> [name]
#   awg-instance.sh remove <name>
#   awg-instance.sh list
set -euo pipefail

INSTANCES_DIR="${INSTANCES_DIR:-/opt/amnezia-instances}"
IMG_AWG2="${IMG_AWG2:-amneziavpn/amneziawg-go:2.0.0}"
IMG_AWG="${IMG_AWG:-amneziavpn/amneziawg-go:0.2.18}"
IMG_LEGACY="${IMG_LEGACY:-amneziavpn/amnezia-wg:latest}"

err() { echo "ERROR: $*" >&2; exit 1; }

rand() { od -An -N4 -tu4 </dev/urandom | tr -d ' '; }
rand_range() { # min max
  local min="$1"
  local max="$2"
  local span=$(( max - min + 1 ))
  echo $(( min + ($(rand) % span) ))
}
rand_magic() { # single large uint32 (AmneziaWG H header), NOT a range
  rand_range 1000000000 2147000000
}

image_for() {
  case "$1" in
    awg2)   echo "$IMG_AWG2" ;;
    awg)    echo "$IMG_AWG" ;;
    legacy) echo "$IMG_LEGACY" ;;
    *) err "unknown variant: $1 (awg2|awg|legacy)" ;;
  esac
}

# pick an unused 10.8.<N>.0/24 subnet
pick_subnet() {
  local used n c
  used="$(grep -rhoE 'Address = 10\.8\.[0-9]+\.' "$INSTANCES_DIR"/*/conf/*.conf 2>/dev/null | grep -oE '10\.8\.[0-9]+' | awk -F. '{print $3}' | sort -un || true)"
  # also subnets used by any running container (native Amnezia, etc.)
  for c in $(docker ps --format '{{.Names}}' 2>/dev/null); do
    local a
    a="$(docker exec "$c" sh -c 'cat /opt/amnezia/awg/*.conf 2>/dev/null' 2>/dev/null | grep -oE 'Address = 10\.8\.[0-9]+' | grep -oE '10\.8\.[0-9]+' | awk -F. '{print $3}' || true)"
    [[ -n "$a" ]] && used="$used"$'\n'"$a"
  done
  used="$(printf '%s\n' "$used" | sort -un)"
  # start at 20 to avoid colliding with Amnezia native default 10.8.1
  for n in $(seq 20 250); do
    if ! grep -qx "$n" <<<"$used"; then echo "$n"; return; fi
  done
  err "no free subnet"
}

cmd_create() {
  local variant="$1" port="$2" name="${3:-}"
  [[ "$port" =~ ^[0-9]+$ ]] && (( port>=1 && port<=65535 )) || err "bad port: $port"
  local img; img="$(image_for "$variant")"
  [[ -z "$name" ]] && name="amnezia-${variant}-${port}"
  # sanitize name
  name="$(echo "$name" | tr -cd 'a-zA-Z0-9_-')"
  [[ -n "$name" ]] || err "bad name"
  docker inspect "$name" >/dev/null 2>&1 && err "container $name already exists"
  # port free?
  if ss -lun 2>/dev/null | grep -qE "[:.]${port}\b"; then err "udp port $port busy"; fi

  echo "→ pulling $img"
  docker pull -q "$img" >/dev/null

  local sub; sub="$(pick_subnet)"
  local net="10.8.${sub}"
  local dir="$INSTANCES_DIR/$name/conf"
  mkdir -p "$dir"

  local conf binary iface
  if [[ "$variant" == "legacy" ]]; then binary="wg"; iface="wg0"; else binary="awg"; iface="awg0"; fi
  conf="$dir/${iface}.conf"

  # keys via the image
  local priv pub psk
  priv="$(docker run --rm "$img" "$binary" genkey | tr -d '\r\n')"
  pub="$(printf '%s' "$priv" | docker run --rm -i "$img" "$binary" pubkey | tr -d '\r\n')"
  psk="$(docker run --rm "$img" "$binary" genpsk | tr -d '\r\n')"

  # interface block
  {
    echo "[Interface]"
    echo "PrivateKey = $priv"
    echo "Address = ${net}.0/24"
    echo "ListenPort = $port"
    if [[ "$variant" != "legacy" ]]; then
      echo "Jc = $(rand_range 3 10)"
      echo "Jmin = 10"
      echo "Jmax = 50"
      echo "S1 = $(rand_range 15 60)"
      echo "S2 = $(rand_range 15 60)"
      if [[ "$variant" == "awg2" ]]; then
        echo "S3 = $(rand_range 5 40)"
        echo "S4 = $(rand_range 1 40)"
      fi
      echo "H1 = $(rand_magic)"
      echo "H2 = $(rand_magic)"
      echo "H3 = $(rand_magic)"
      echo "H4 = $(rand_magic)"
    fi
  } > "$conf"

  printf '%s\n' "$pub"  > "$dir/wireguard_server_public_key.key"
  printf '%s\n' "$priv" > "$dir/wireguard_server_private_key.key"
  printf '%s\n' "$psk"  > "$dir/wireguard_psk.key"
  printf '[]\n'         > "$dir/clientsTable"

  # start script run inside container
  local usimpl=""
  if [[ "$variant" != "legacy" ]]; then usimpl="export WG_QUICK_USERSPACE_IMPLEMENTATION=amneziawg-go"; fi
  cat > "$dir/start.sh" <<EOF
#!/bin/sh
set +e
$usimpl
${binary}-quick down /opt/amnezia/awg/${iface}.conf 2>/dev/null
[ -f /opt/amnezia/awg/${iface}.conf ] && ${binary}-quick up /opt/amnezia/awg/${iface}.conf
DEV=\$(ip route 2>/dev/null | awk '/default/ {print \$5; exit}')
[ -z "\$DEV" ] && DEV=eth0
iptables -A INPUT -i ${iface} -j ACCEPT
iptables -A FORWARD -i ${iface} -j ACCEPT
iptables -A FORWARD -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -t nat -A POSTROUTING -s ${net}.0/24 -o "\$DEV" -j MASQUERADE
exec tail -f /dev/null
EOF
  chmod +x "$dir/start.sh"

  echo "→ run container $name (port $port/udp, subnet ${net}.0/24)"
  docker run -d --name "$name" --restart unless-stopped \
    --cap-add NET_ADMIN --cap-add SYS_MODULE --privileged \
    --sysctl net.ipv4.conf.all.src_valid_mark=1 \
    -p "${port}:${port}/udp" \
    -v /lib/modules:/lib/modules:ro \
    -v "$dir:/opt/amnezia/awg" \
    "$img" sh /opt/amnezia/awg/start.sh >/dev/null

  sleep 2
  if docker exec "$name" "$binary" show "$iface" >/dev/null 2>&1; then
    echo "OK container=$name variant=$variant port=$port subnet=${net}.0/24 binary=$binary iface=$iface conf=$conf"
  else
    echo "WARN container started but '$binary show $iface' failed — check: docker logs $name"
    echo "OK_PARTIAL container=$name variant=$variant port=$port"
  fi
}

cmd_remove() {
  local name="$1"
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "${INSTANCES_DIR:?}/$name"
  echo "removed $name"
}

cmd_list() {
  docker ps --format '{{.Names}} {{.Ports}}' | grep -E '^amnezia-(awg2|awg|legacy)-|^amnezia-' || true
}

case "${1:-}" in
  create) shift; cmd_create "$@" ;;
  remove) shift; cmd_remove "$@" ;;
  list)   cmd_list ;;
  *) err "usage: $0 {create <variant> <port> [name] | remove <name> | list}" ;;
esac
