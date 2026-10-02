# Instalación en un servidor

Para Debian 12/13 o Ubuntu 22.04+ (también en un contenedor LXC de Proxmox). Para Docker, mira [docker.md](docker.md).

```
navegador ──HTTPS──> tu proxy (Caddy, Nginx Proxy Manager, Traefik…) ──HTTP──> Caddy de la app :80
                                                                                 ├─ /       → app/ (archivos estáticos)
                                                                                 └─ /api/*  → backend 127.0.0.1:8000 → SQLite
```

## 1. Preparar el servidor

Un LXC pequeño basta: 1 núcleo, 512 MB de RAM y 4 GB de disco. En Proxmox, con la plantilla de Debian:

```bash
pct create <ID> local:vztmpl/debian-13-standard_*.tar.zst \
  --hostname pesca --unprivileged 1 --features nesting=1 \
  --cores 1 --memory 512 --swap 256 --rootfs local-zfs:4 \
  --net0 name=eth0,bridge=vmbr0,ip=<IP>/24,gw=<PUERTA_DE_ENLACE> \
  --onboot 1 --password
pct start <ID> && pct enter <ID>
```

## 2. Instalar

```bash
apt-get update && apt-get install -y git
git clone https://github.com/enriquezaporta/calendario-pesca.git
cd calendario-pesca
bash deploy/install.sh
```

El script instala Python, SQLite y Caddy (si el de la distribución es anterior a la 2.7, como en Debian 13, instala el paquete oficial verificando su suma), copia la app a `/var/www/pesca`, el backend a `/opt/pesca-api`
como servicio `pesca-api` (usuario sin privilegios y endurecido con systemd) y deja la herramienta `pesca-admin`.
Al final comprueba que todo responde y que están las cabeceras de seguridad.

Después indica quién es el **responsable** de la instalación, que aparece en la política de privacidad:

```bash
pesca-admin operator "Tu nombre" "tu-correo@ejemplo.com"
```

## 3. HTTPS

Publica la app en tu proxy apuntando a `http://<IP>:80`. Con Caddy:

```
pesca.tudominio.es {
	reverse_proxy <IP>:80
}
```

Para una red local sin dominio, Caddy puede usar su CA interna (`tls internal`); entonces hay que instalar su
certificado raíz en cada dispositivo.

**Si la app va a ser pública**, di al Caddy de la app que solo se fíe de la IP de tu proxy para saber la IP
real de los clientes (los límites de intentos dependen de ello). Se configura en el servicio de Caddy:

```bash
systemctl edit caddy
# [Service]
# Environment=PESCA_TRUSTED_PROXIES=<IP_DE_TU_PROXY>
systemctl restart caddy
```

## 4. En los dispositivos

- iPhone: Safari → la dirección de la app → Compartir → Añadir a pantalla de inicio.
- Android: Chrome → menú ⋮ → Instalar aplicación.
- Ordenador: Chrome o Edge → icono de instalar de la barra de direcciones.

## Actualizar

```bash
cd calendario-pesca && git pull && bash deploy/install.sh
```

Antes de actualizar, el script hace una copia de la base de datos (`/var/lib/pesca/antes-de-actualizar-*.db`,
guarda las tres últimas). Las migraciones de la base de datos son automáticas. En los dispositivos, cierra la
app y ábrela dos veces para cargar la versión nueva.

## Administración

```bash
pesca-admin users                    # usuarios, jornadas y denuncias pendientes
pesca-admin reports [--all]          # denuncias
pesca-admin resolve <id>             # marcar una denuncia como revisada
pesca-admin disable|enable <usuario> # desactivar o reactivar una cuenta
pesca-admin passwd <usuario>         # cambiar una contraseña (cierra sus sesiones)
pesca-admin adduser <usuario> [nombre]
pesca-admin deluser <usuario>        # borrar una cuenta y todos sus datos
pesca-admin signup on|off            # abrir o cerrar el registro desde la app
pesca-admin operator "Nombre" "contacto"
pesca-admin claim <usuario>          # solo al venir de la versión 1, sin usuarios
```

Logs: `journalctl -u pesca-api -f`. Solo se registran errores, sin IPs ni nombres de usuario.

## Copias de seguridad

Todo está en `/var/lib/pesca/pesca.db`. Una copia en caliente:

```bash
sqlite3 /var/lib/pesca/pesca.db ".backup '/root/pesca-$(date +%F).db'"
```

En Proxmox basta con una copia programada del contenedor. Guarda las copias fuera del mismo disco y cífralas
si salen de tu casa: contienen datos personales.

## Problemas frecuentes

- **«Servidor no accesible» en la app**: comprueba `systemctl status pesca-api caddy` y `curl http://127.0.0.1/api/health`.
- **El servicio no arranca en un LXC**: el instalador prueba un modo compatible si el contenedor no permite
  alguna protección de systemd. Mira `journalctl -u pesca-api -n 50`.
- **No se instala en el móvil**: hace falta HTTPS válido para ese dispositivo.
