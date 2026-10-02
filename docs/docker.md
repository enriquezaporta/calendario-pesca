# Docker

Una sola imagen con la app, el backend y un Caddy interno. Corre sin root, con el sistema de ficheros en
solo lectura, sin capacidades y con comprobación de salud. Los datos van en un volumen.

## Arrancar

Descarga [`docker-compose.yml`](../docker-compose.yml), pon tus datos en `PESCA_OPERATOR_NAME` y
`PESCA_OPERATOR_CONTACT`, y:

```bash
docker compose up -d
```

La app queda en `http://<servidor>:8080`. Ponle delante un proxy con HTTPS (Caddy, Nginx Proxy Manager,
Traefik…) apuntando a ese puerto.

La imagen se publica para `amd64`, `arm64` y `arm/v7` (Raspberry Pi) en
`ghcr.io/enriquezaporta/calendario-pesca`. Para construirla tú: `docker compose build`.

## Variables

| Variable | Por defecto | Para qué |
|---|---|---|
| `PESCA_OPERATOR_NAME` | vacío | Responsable que aparece en la política de privacidad. |
| `PESCA_OPERATOR_CONTACT` | vacío | Correo o web de contacto del responsable. |
| `PESCA_ALLOW_SIGNUP` | `1` | `0` cierra el registro de cuentas desde la app. |
| `PESCA_TRUSTED_PROXIES` | redes privadas | IP de tu proxy. Si la app es pública, pon solo esa IP. |

## Administración

```bash
docker exec -it calendario-pesca pesca-admin users
docker exec -it calendario-pesca pesca-admin reports
docker exec -it calendario-pesca pesca-admin passwd <usuario>
```

Los comandos son los mismos que en [instalacion.md](instalacion.md#administración), salvo `signup` y
`operator`, que en Docker se cambian con las variables de entorno.

## Copias de seguridad

```bash
docker exec calendario-pesca python3 -c "import sqlite3; s=sqlite3.connect('/var/lib/pesca/pesca.db'); d=sqlite3.connect('/tmp/copia.db'); s.backup(d); d.close()"
docker cp calendario-pesca:/tmp/copia.db ./pesca-$(date +%F).db
```

## Actualizar

```bash
docker compose pull && docker compose up -d
```

Las migraciones de la base de datos son automáticas al arrancar.
