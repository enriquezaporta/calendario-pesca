# Cambios

## 4.1.0 · octubre 2026

- **Localidad** en cada jornada. Localidad y escenario son obligatorios; los escenarios se sugieren según la
  localidad y un escenario conocido rellena su localidad.
- **Buscador del calendario** por localidad o escenario: desplegable de dos niveles (localidad › escenario),
  búsqueda sin tildes ni mayúsculas, uso con teclado y lista de todas las jornadas del lugar elegido.
- Asignar localidad de una vez a las jornadas antiguas de un escenario.
- La localidad forma parte de los resultados que ven los amigos.

## 4.0.0 · octubre 2026

- **Modalidades**: feeder, coup, carpfishing, black bass, spinning, mosca, surfcasting, embarcación y otra,
  cada una con sus campos. Cada pescador elige las suyas al registrarse. Pieza mayor, especies y marea.
  Filtros por modalidad en registro, temporada y comparativa.
- **Chat** entre amigos, con avisos de mensajes nuevos, bloqueo y denuncias.
- **Privacidad**: los amigos ven solo resultados por defecto, jornadas privadas, descargar todos los datos,
  eliminar la cuenta, cerrar sesión borrando los datos del dispositivo, política de privacidad y condiciones de uso
  con aceptación versionada.
- **Seguridad**: PBKDF2 a 600.000 iteraciones, sesiones que caducan, código de recuperación sin correo,
  límites de intentos, validación de datos en el servidor, cuotas, CSP y cabeceras de seguridad, systemd y Docker endurecidos.
- Administración: denuncias, desactivar cuentas, responsable de la instalación.
- Docker y GitHub Actions (pruebas e imagen multiarquitectura).
- Migración automática desde la 3.x.

## 3.0.0

- Versión de escritorio: menú lateral, calendario grande con resultados en cada día y pantallas en columnas.

## 2.0.0

- Cuentas de usuario con datos independientes, amigos y comparativa de temporada y cara a cara.

## 1.0.0

- Calendario de concursos, campeonatos y entrenamientos de feeder con peso, piezas, engodo, tiempo,
  distancia y descripción. PWA sin conexión con sincronización.
