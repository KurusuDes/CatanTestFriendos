import { h } from './dom.js';
import { MODES } from '../engine/config.js';
import { t } from '../i18n.js';

export const REPO_URL = 'https://github.com/KurusuDes/CatanTestFriendos';
const repoLink = () => h('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, t('código en GitHub'));

// the credit line under the main menu: copies of the game usually keep it, so the link travels with them
export function creditLine() {
  return h('div', { class: 'credits' }, t('Katanittes, por Sowtank · '), repoLink(), t(' · proyecto de fans no oficial'));
}

export function showHelp() {
  const close = () => ov.remove();
  const ov = h('div', { class: 'overlay', onclick: e => e.target === ov && close() },
    h('div', { class: 'modal help-body', style: { width: 'min(720px,100%)' } },
      h('h2', null, t('📖 Cómo se juega')),
      h('p', null, t('Construye poblados, ciudades y caminos. El primero en llegar a los puntos de victoria de la partida (10 por defecto) gana.')),
      h('h3', null, t('Turno')),
      h('ul', null,
        h('li', null, t('🎲 Tira los dados: cada casilla con ese número produce para los poblados (1) y ciudades (2) que la tocan.')),
        h('li', null, t('🏗️ Construye: camino 🌲🧱 · poblado 🌲🧱🐑🌾 · ciudad 🌾🌾⛰️⛰️⛰️ · carta 🐑🌾⛰️.')),
        h('li', null, t('🤝 Comercia con el banco (4:1, o mejor con puertos 3:1 y 2:1) o con otros jugadores.')),
        h('li', null, t('🃏 Juega una carta de desarrollo por turno (no la que compraste este turno). Los caballeros se pueden jugar antes de tirar.'))),
      h('h3', null, t('El 7 y el ladrón')),
      h('ul', null,
        h('li', null, t('Si sale 7, quien tenga más cartas del límite descarta la mitad.')),
        h('li', null, t('Luego mueves el ladrón: bloquea la casilla y robas una carta a alguien que esté al lado.'))),
      h('h3', null, t('Puntos')),
      h('ul', null,
        h('li', null, t('Poblado 1 · Ciudad 2 · Carta de punto 1 (oculta).')),
        h('li', null, t('🛣️ Camino más largo (5+ tramos seguidos): 2 puntos. ⚔️ Ejército más grande (3+ caballeros): 2 puntos.'))),
      h('h3', null, t('Modos Katanittes')),
      h('ul', null, MODES.map(m => h('li', null, h('b', null, `${m.icon} ${t(m.name)}: `), t(m.desc)))),
      h('h3', null, t('Controles')),
      h('ul', null,
        h('li', null, t('Rueda del ratón o pellizco: zoom. Arrastra: mover el mapa.')),
        h('li', null, t('🎲 Toca «Tirar dados» para tirar al momento, o mantenlo pulsado para cargar fuerza y suéltalo: los dados salen más fuerte.')),
        h('li', null, t('🖱️ Botón del medio: clava un banderín de tu color en el mapa que ven todos. 😀: reacciona con un emoji que sale de todas tus construcciones.')),
        h('li', null, t('Esc: cancelar la construcción. 💡: pedir una pista al bot difícil.'))),
      h('h3', null, t('Créditos')),
      h('ul', null,
        h('li', null, t('Katanittes es un juego de Sowtank. El '), repoLink(), t(' es libre (licencia MIT): si lo usas en otro proyecto, menciona el original y enlaza el repositorio.')),
        h('li', null, t('Proyecto de fans no oficial: no está afiliado a Catan GmbH, CATAN Studio ni Kosmos. CATAN es una marca de sus respectivos propietarios.'))),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: close }, t('¡Entendido!')))));
  document.body.append(ov);
}
