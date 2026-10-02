# Privacidad y RGPD

Esta guía es para quien instale y publique la app. **No es asesoramiento legal**: si vas a abrirla al público,
conviene que un profesional revise tu caso.

## Qué hace la app por sí sola

| Principio (RGPD) | Cómo lo cumple la app |
|---|---|
| Minimización (art. 5.1.c) | Sin correo, teléfono ni ubicación. Usuario, nombre visible y lo que cada uno registra. |
| Privacidad por defecto (art. 25) | Los amigos ven solo resultados; jornadas privadas; nadie que no sea amigo ve nada. |
| Información (arts. 13-14) | Política de privacidad y condiciones en la app (`/privacy.html`, `/terms.html`), aceptadas al registrarse. Si cambian, se vuelven a pedir. |
| Acceso y portabilidad (arts. 15 y 20) | Ajustes → Descargar todos mis datos (JSON con cuenta, jornadas, amigos, mensajes, denuncias y sesiones). |
| Rectificación (art. 16) | Todo se puede editar desde la app. |
| Supresión (art. 17) | Ajustes → Eliminar mi cuenta. Borra cuenta, jornadas, amistades y mensajes, con borrado seguro en SQLite. |
| Limitación de la conservación (art. 5.1.e) | Sesiones que caducan, borrados sin contenido, IPs solo en memoria, denuncias revisadas que se borran al año. |
| Seguridad (art. 32) | Ver [seguridad.md](seguridad.md). |
| Menores (art. 7 LOPDGDD) | Edad mínima de 14 años declarada al registrarse. |
| Cookies (art. 22.2 LSSI) | No hay cookies; solo almacenamiento técnico imprescindible, que no necesita banner. |

## Qué tienes que hacer tú si la publicas

1. **Identificarte como responsable**: `pesca-admin operator "Nombre" "contacto"` o las variables
   `PESCA_OPERATOR_NAME` y `PESCA_OPERATOR_CONTACT` en Docker. Aparecen en la política de privacidad.
2. **Revisar los textos** de `app/privacy.html` y `app/terms.html` y adaptarlos a tu caso (por ejemplo, si
   tu servidor está fuera de casa, menciona al proveedor de alojamiento como encargado del tratamiento).
3. **Dominio con HTTPS** válido (por ejemplo Let's Encrypt) y `PESCA_TRUSTED_PROXIES` con la IP de tu proxy.
4. **Copias de seguridad cifradas** y fuera del servidor. Indica en la política cuánto tiempo las guardas.
5. **Atender las denuncias** con `pesca-admin reports` y desactivar las cuentas que incumplan las normas.
6. **Responder a las peticiones** que lleguen al contacto (plazo general: un mes).
7. **Registro de actividades de tratamiento**: anota qué datos tratas, para qué y cuánto tiempo (puedes basarte en
   la tabla de la política). Para un proyecto personal pequeño suele bastar con ese documento.
8. **Brechas de seguridad**: si alguien accede a la base de datos, tienes 72 horas para notificarlo a la AEPD.
9. Si cambias la política, sube `POLICY_VERSION` en `backend/server.py` para que los usuarios la acepten de nuevo.

## Uso doméstico

Si solo la usáis en casa y entre conocidos, el RGPD prácticamente no aplica (excepción doméstica, art. 2.2.c),
pero todas estas medidas siguen protegiendo vuestros datos igual.
