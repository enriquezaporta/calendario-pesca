#!/usr/bin/env bash
# Instalación / actualización del Calendario de Pesca en un servidor Debian/Ubuntu (o un LXC de Proxmox).
# Uso, como root, desde la carpeta del repositorio:
#   bash deploy/install.sh
# Se puede relanzar en cada actualización: los datos (/var/lib/pesca) se conservan y antes de
# actualizar se hace una copia de la base de datos.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DB=/var/lib/pesca/pesca.db
WEB=/var/www/pesca

[[ $EUID -eq 0 ]] || { echo "Ejecútalo como root."; exit 1; }

CADDY_VERSION=2.10.2   # la configuración necesita Caddy 2.7 o superior (Debian 13 trae 2.6)

echo "==> Paquetes"
apt-get update -q
apt-get install -y -q python3 sqlite3 curl ca-certificates

caddy_ok() {
  command -v caddy >/dev/null || return 1
  local v; v=$(caddy version | grep -oE '^v?[0-9]+\.[0-9]+' | tr -d v)
  [[ "$(printf '%s\n' 2.7 "$v" | sort -V | head -1)" == "2.7" ]]
}
if ! caddy_ok; then
  echo "==> Caddy $CADDY_VERSION (paquete oficial de GitHub, con su suma de comprobación)"
  ARCH=$(dpkg --print-architecture)
  TMP=$(mktemp -d)
  BASE="https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}"
  DEB="caddy_${CADDY_VERSION}_linux_${ARCH}.deb"
  curl -fsSL -o "$TMP/$DEB" "$BASE/$DEB"
  curl -fsSL -o "$TMP/sums.txt" "$BASE/caddy_${CADDY_VERSION}_checksums.txt"
  (cd "$TMP" && grep " $DEB\$" sums.txt | sha512sum -c -)
  apt-get install -y -q "$TMP/$DEB"
  rm -rf "$TMP"
fi

echo "==> Usuario de servicio"
id pesca >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin pesca

if [[ -f "$DB" ]]; then
  echo "==> Copia de la base de datos antes de actualizar"
  BK="/var/lib/pesca/antes-de-actualizar-$(date +%Y%m%d-%H%M%S).db"
  sqlite3 "$DB" ".backup '$BK'"
  chown pesca:pesca "$BK"; chmod 600 "$BK"
  # Se guardan las tres últimas.
  ls -1t /var/lib/pesca/antes-de-actualizar-*.db 2>/dev/null | tail -n +4 | xargs -r rm -f
  echo "    $BK"
fi

echo "==> App en $WEB"
install -d -m 755 "$WEB"
find "$WEB" -mindepth 1 -delete
cp -r "$SRC/app/." "$WEB/"
chmod -R a+rX,go-w "$WEB"

echo "==> Backend en /opt/pesca-api"
install -d -m 755 /opt/pesca-api
install -m 755 "$SRC/backend/server.py" /opt/pesca-api/server.py
install -m 644 "$SRC/backend/pesca-api.service" /etc/systemd/system/pesca-api.service
install -m 755 "$SRC/backend/pesca-admin" /usr/local/bin/pesca-admin
touch /etc/default/pesca-api; chmod 640 /etc/default/pesca-api
systemctl daemon-reload
systemctl enable -q pesca-api
systemctl restart pesca-api
sleep 2
if ! systemctl is-active --quiet pesca-api; then
  # Algunos contenedores no permiten todas las protecciones de systemd: se relajan las que fallan.
  echo "    El servicio no arranca con todas las protecciones; probando en modo compatible…"
  install -d /etc/systemd/system/pesca-api.service.d
  printf '[Service]\nProtectKernelTunables=no\nProtectKernelModules=no\nProtectControlGroups=no\n' \
    > /etc/systemd/system/pesca-api.service.d/compat.conf
  systemctl daemon-reload
  systemctl restart pesca-api
  sleep 2
  systemctl is-active --quiet pesca-api || { journalctl -u pesca-api -n 30 --no-pager; exit 1; }
fi

echo "==> Caddy"
install -m 644 "$SRC/deploy/Caddyfile" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable -q caddy
systemctl restart caddy
sleep 1

echo
echo "==> Comprobación"
curl -s -o /dev/null -w "  App vía Caddy          -> %{http_code}\n" http://127.0.0.1/
curl -s -w "  (backend directo -> %{http_code})\n" http://127.0.0.1:8000/api/health
curl -s -w "  (backend vía Caddy -> %{http_code})\n" http://127.0.0.1/api/health
curl -sI http://127.0.0.1/ | grep -qi "content-security-policy" && echo "  Cabeceras de seguridad: OK" || echo "  AVISO: faltan las cabeceras de seguridad"
grep -q '^PESCA_OPERATOR_NAME=' /etc/default/pesca-api || \
  echo '  AVISO: falta el responsable de la política de privacidad: pesca-admin operator "Nombre" "contacto"'
echo
pesca-admin users || true
echo "Listo."
