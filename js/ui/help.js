import { h } from './dom.js';
import { MODES } from '../engine/config.js';

export const REPO_URL = 'https://github.com/KurusuDes/CatanTestFriendos';
const repoLink = () => h('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, 'código en GitHub');

// the credit line under the main menu: copies of the game usually keep it, so the link travels with them
export function creditLine() {
  return h('div', { class: 'credits' }, 'Katanittes, por Sowtank · ', repoLink(), ' · proyecto de fans no oficial');
}

export function showHelp() {
  const close = () => ov.remove();
  const ov = h('div', { class: 'overlay', onclick: e => e.target === ov && close() },
    h('div', { class: 'modal help-body', style: { width: 'min(720px,100%)' } },
      h('h2', null, '📖 Cómo se juega'),
      h('p', null, 'Construye poblados, ciudades y caminos. El primero en llegar a los puntos de victoria de la partida (10 por defecto) gana.'),
      h('h3', null, 'Turno'),
      h('ul', null,
        h('li', null, '🎲 Tira los dados: cada casilla con ese número produce para los poblados (1) y ciudades (2) que la tocan.'),
        h('li', null, '🏗️ Construye: camino 🌲🧱 · poblado 🌲🧱🐑🌾 · ciudad 🌾🌾⛰️⛰️⛰️ · carta 🐑🌾⛰️.'),
        h('li', null, '🤝 Comercia con el banco (4:1, o mejor con puertos 3:1 y 2:1) o con otros jugadores.'),
        h('li', null, '🃏 Juega una carta de desarrollo por turno (no la que compraste este turno). Los caballeros se pueden jugar antes de tirar.')),
      h('h3', null, 'El 7 y el ladrón'),
      h('ul', null,
        h('li', null, 'Si sale 7, quien tenga más cartas del límite descarta la mitad.'),
        h('li', null, 'Luego mueves el ladrón: bloquea la casilla y robas una carta a alguien que esté al lado.')),
      h('h3', null, 'Puntos'),
      h('ul', null,
        h('li', null, 'Poblado 1 · Ciudad 2 · Carta de punto 1 (oculta).'),
        h('li', null, '🛣️ Camino más largo (5+ tramos seguidos): 2 puntos. ⚔️ Ejército más grande (3+ caballeros): 2 puntos.')),
      h('h3', null, 'Modos Katanittes'),
      h('ul', null, MODES.map(m => h('li', null, h('b', null, `${m.icon} ${m.name}: `), m.desc))),
      h('h3', null, 'Controles'),
      h('ul', null,
        h('li', null, 'Rueda del ratón o pellizco: zoom. Arrastra: mover el mapa.'),
        h('li', null, '🎲 Toca «Tirar dados» para tirar al momento, o mantenlo pulsado para cargar fuerza y suéltalo: los dados salen más fuerte.'),
        h('li', null, '🖱️ Botón del medio: clava un banderín de tu color en el mapa que ven todos. 😀: reacciona con un emoji que sale de todas tus construcciones.'),
        h('li', null, 'Esc: cancelar la construcción. 💡: pedir una pista al bot difícil.')),
      h('h3', null, 'Créditos'),
      h('ul', null,
        h('li', null, 'Katanittes es un juego de Sowtank. El ', repoLink(), ' es libre (licencia MIT): si lo usas en otro proyecto, menciona el original y enlaza el repositorio.'),
        h('li', null, 'Proyecto de fans no oficial: no está afiliado a Catan GmbH, CATAN Studio ni Kosmos. CATAN es una marca de sus respectivos propietarios.')),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: close }, '¡Entendido!'))));
  document.body.append(ov);
}
