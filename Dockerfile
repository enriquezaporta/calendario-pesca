# Calendario de Pesca: app, backend y Caddy en una sola imagen pequeña.
FROM caddy:2-alpine

RUN apk add --no-cache python3 tini libcap \
 && setcap -r /usr/bin/caddy \
 && apk del libcap \
 && addgroup -S pesca && adduser -S -D -H -G pesca pesca \
 && mkdir -p /var/lib/pesca && chown pesca:pesca /var/lib/pesca && chmod 700 /var/lib/pesca

COPY app/ /srv/pesca/
COPY backend/server.py /opt/pesca/server.py
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY docker/entrypoint.sh /usr/local/bin/pesca-entrypoint
COPY docker/pesca-admin /usr/local/bin/pesca-admin

ENV PESCA_DB=/var/lib/pesca/pesca.db \
    PESCA_WEB_ROOT=/srv/pesca \
    PESCA_HTTP_PORT=8080 \
    PESCA_API_PORT=8000 \
    PESCA_ALLOW_SIGNUP=1 \
    PESCA_OPERATOR_NAME="" \
    PESCA_OPERATOR_CONTACT="" \
    PYTHONUNBUFFERED=1 \
    XDG_DATA_HOME=/tmp/caddy \
    XDG_CONFIG_HOME=/tmp/caddy

USER pesca
# Los datos van en /var/lib/pesca (no en /data, que la imagen de Caddy ya declara como volumen de root).
VOLUME /var/lib/pesca
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--", "pesca-entrypoint"]
