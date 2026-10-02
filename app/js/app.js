// Arranque de la app: registra las pantallas y engancha la navegación.
import * as db from './db.js';
import * as auth from './auth.js';
import {
  $, state, registerScreens, render, push, pop, goTab, refreshBadge, refreshUnread, refreshMe, trySync,
} from './core.js';
import { journalScreens } from './journal.js';
import { socialScreens } from './social.js';
import { accountScreens } from './account.js';

registerScreens({ ...journalScreens, ...socialScreens, ...accountScreens });

document.querySelectorAll('.tabbar button[data-tab]').forEach(b => b.onclick = () => goTab(b.dataset.tab));
$('#fab').onclick = () => push({ kind: 'form', id: null, date: state.selDay });
$('#syncBtn').onclick = () => trySync(false);

// Escritorio: Esc vuelve atrás (cierra ficha o formulario) salvo mientras se escribe o hay un diálogo abierto.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !state.user || !state.stack.length || document.querySelector('.modal-wrap')) return;
  if (e.target.matches('input, textarea, select')) { e.target.blur(); return; }
  pop();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.user) return;
  trySync(true);
  refreshUnread();
});
// Avisos de mensajes nuevos mientras la app está abierta.
setInterval(refreshUnread, 30000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

// La sesión se recuerda en el dispositivo: si hay una guardada, se entra directamente (aunque no haya conexión).
const saved = auth.getAuth();
if (saved?.user) {
  state.user = saved.user;
  db.setUser(saved.user.id);
  render();
  refreshBadge();
  refreshMe().then(() => { trySync(true); refreshUnread(); });
} else {
  render();
}
