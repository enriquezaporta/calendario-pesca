# Arquitectura

## Piezas

| Carpeta | Qué hay |
|---|---|
| `app/` | La PWA: HTML, CSS y módulos de JavaScript sin frameworks ni dependencias. |
| `app/js/core.js` | Estado, navegación, diálogos y sincronización. |
| `app/js/journal.js` | Calendario, registro, ficha, formulario y temporada. |
| `app/js/social.js` | Amigos, comparativa y chat. |
| `app/js/account.js` | Acceso, recuperación, aceptación de la política y ajustes. |
| `app/js/modalities.js` | Modalidades y sus campos. Añadir una modalidad es añadir una entrada aquí (y su id en el backend). |
| `app/js/db.js` | IndexedDB: una base de datos por usuario en cada dispositivo. |
| `app/sw.js` | Service worker: la app funciona sin conexión. |
| `backend/server.py` | API en Python (solo librería estándar) y SQLite. Incluye la herramienta de administración. |
| `deploy/` | Caddyfile (cabeceras de seguridad, proxy de `/api`) e instalador para servidor. |

## Datos

- **En el dispositivo**: las jornadas se guardan en IndexedDB (`pesca-u<id>`), con una marca `dirty` cuando
  falta subirlas. La sesión (token y perfil) en `localStorage`.
- **En el servidor** (SQLite, modo WAL, `secure_delete`): `users`, `tokens` (solo el sha256 del token),
  `records` (cada jornada como JSON, con su propietario y marca del servidor), `friendships`, `blocks`,
  `messages` y `reports`.

Una jornada es un objeto JSON con campos comunes (`type`, `modality`, `date`, `venue`, `weightG`, `pieces`,
`biggestG`, `species`, `sectorRank`, tiempo, `notes`, `private`…) y los campos propios de su modalidad.
El servidor no necesita conocer cada campo: valida el identificador, la fecha, el tipo y la modalidad, que los
campos numéricos sean números y los de valores cerrados uno de sus valores, descarta claves raras y limita
tamaños (32 KB por jornada, 20.000 jornadas y 50 MB por usuario).

## Sincronización

```
POST /api/sync  { lastSyncAt, changes: { sessions: [...] } }
             -> { serverTime, changes: { sessions: [...] }, rejected, more }
```

- *Last-write-wins* por `updatedAt` del cliente, siempre dentro de los datos del propio usuario.
- Cada cambio recibe una marca del servidor (`server_ts`) creciente. El cliente pide lo posterior a su última
  marca, así el reloj del móvil no influye. La escritura y su confirmación van bajo un mismo candado, de modo
  que ningún cliente recibe una marca de un cambio aún sin guardar.
- Las respuestas grandes van por páginas de 2.000 (`more: true`).
- Un borrado viaja como `{id, updatedAt, deleted: true}`, sin el contenido.

## Amigos y privacidad

`GET /api/friends/<usuario>/sessions` solo responde si hay amistad aceptada en los dos sentidos, nunca
incluye las jornadas `private` y, si el dueño comparte «solo resultados», filtra los campos con una lista
blanca (`RESULT_FIELDS`). El filtrado se hace en el servidor: la app de un amigo nunca recibe lo que no debe ver.

## Chat

Mensajes de texto entre amigos, guardados en el servidor. La app consulta los nuevos cada 4 segundos con la
conversación abierta y el contador de no leídos cada 30 segundos. Se pintan siempre como texto
(`textContent`), nunca como HTML.

## API

Lista completa al principio de [`backend/server.py`](../backend/server.py). Todo salvo `health`, `legal`,
`register`, `login` y `recover` necesita `Authorization: Bearer <token>`.

## Decisiones

- **Sin dependencias** en la app y en el backend: nada que actualizar por seguridad salvo Python y Caddy,
  y cualquiera puede leer todo el código.
- **Offline-first**: el diario se usa en el agua, donde a menudo no hay cobertura.
- **Sin correo**: menos datos personales. La recuperación se hace con un código que solo tiene el usuario.
- **Caddy delante**: HTTPS, compresión y cabeceras de seguridad en un único sitio, igual en servidor y en Docker.
