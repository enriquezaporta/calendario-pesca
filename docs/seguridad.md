# Seguridad

Resumen de las medidas aplicadas, para poder revisarlas. Para avisar de un fallo, mira [SECURITY.md](../SECURITY.md).

## Cuentas y sesiones

- Contraseñas con **PBKDF2-HMAC-SHA256, 600.000 iteraciones** (recomendación de OWASP) y sal aleatoria.
  Las cuentas de versiones anteriores se actualizan solas al entrar.
- Mínimo 8 caracteres, máximo 128.
- Tokens de sesión aleatorios de 256 bits; en la base de datos solo se guarda su sha256.
- Las sesiones caducan a los 90 días sin uso y al año como máximo. Cambiar o recuperar la contraseña cierra
  las demás sesiones, y hay un botón para cerrarlas a mano.
- Recuperación sin correo: código de 80 bits que se muestra una sola vez y se guarda como sha256.
- Mismo tiempo de respuesta exista o no el usuario; comparaciones en tiempo constante.

## Límites de intentos

| Acción | Límite |
|---|---|
| Entrar | 30 por IP cada 15 min; 10 fallos por usuario y conexión; a partir de 30 fallos de un usuario desde varias conexiones, cada intento se frena |
| Crear cuenta | 5 por IP y 60 en total por hora |
| Recuperar | 10 por IP, 5 por usuario y conexión y 30 por usuario por hora |
| Mensajes | 30 por minuto y 1.000 al día |
| Sincronizar | 120 por minuto |
| Amistades y bloqueos | 60 por hora |
| Denuncias | 20 al día |

Las IPv6 se agrupan por /64. Las IPs solo están en memoria y se olvidan al acabar su ventana (como mucho, una hora).
La IP real la pone Caddy en `X-Real-IP` y solo se acepta de los proxies de confianza (`trusted_proxies_strict`).
Si la app es pública, limita `PESCA_TRUSTED_PROXIES` a la IP de tu proxy.

## Autorización

- Cada consulta va filtrada por el usuario de la sesión. Un usuario no puede escribir en jornadas de otro
  aunque conozca su identificador.
- Los datos de un amigo solo se ven con amistad aceptada, sin jornadas privadas y con el nivel de detalle que él elija.
- Solo se puede escribir a amigos. Un bloqueo rompe la amistad y corta mensajes y solicitudes en los dos sentidos.
- Las cuentas desactivadas no pueden entrar y no aparecen a nadie.

## Entradas

- Consultas SQL siempre parametrizadas.
- JSON obligatorio (`Content-Type`), cuerpo máximo de 64 KB (8 MB para sincronizar), comprobado en Caddy y en el backend.
  En la sincronización se comprueba la sesión antes de leer el cuerpo.
- Validación de tipos: números donde se esperan números, valores cerrados, textos con caracteres de control eliminados y longitudes máximas.
- Cuotas por usuario: 20.000 jornadas, 50 MB y 50 solicitudes de amistad pendientes.

## Navegador

- **Content-Security-Policy** estricta: solo archivos propios, sin scripts en línea, sin `eval`, sin marcos.
- `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` y HSTS.
- Todo el texto que viene de datos se escapa al pintarlo; los mensajes del chat se pintan con `textContent`.
  Los datos que llegan del servidor o de una copia importada se limpian antes de guardarlos.
- Sin cookies, sin recursos de terceros, `fetch` sin credenciales.

## Servidor

- El backend escucha solo en `127.0.0.1`, con un usuario sin privilegios y systemd endurecido:
  `ProtectSystem=strict`, sin capacidades, `NoNewPrivileges`, `UMask=0077`, `MemoryMax`…
- Docker: usuario sin root, sistema de ficheros de solo lectura, `cap_drop: ALL`, `no-new-privileges`.
- Registros sin IPs ni nombres de usuario, solo errores.
- Copia de la base de datos antes de cada actualización.

## Pruebas

`tests/test_backend.py` comprueba, entre otras cosas, que un usuario no puede tocar datos de otro, que los
no amigos no ven nada, que «solo resultados» y «privada» se respetan en el servidor, los bloqueos, los límites
de intentos, la caducidad de sesiones, la recuperación, el borrado completo de la cuenta y que las entradas
mal formadas dan error 400 y no fallos del servidor.

Antes de publicar esta versión se hizo una revisión independiente del código; sus hallazgos están corregidos
y tienen prueba de regresión.

## Lo que no hace (todavía)

- El chat no va cifrado de extremo a extremo: el administrador del servidor puede leer la base de datos.
- No hay segundo factor de autenticación.
- No hay notificaciones push: el aviso de mensajes nuevos aparece con la app abierta.
