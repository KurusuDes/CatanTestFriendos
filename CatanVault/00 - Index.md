---
tags: [index]
---

# Katan x Amiguites — Índice

Juego de colonos inspirado en Catan, en el navegador (sitio estático, sin build) con mapas personalizables, modos propios, bots, online P2P y mapa 3D de maqueta con UI pixel art.

- **Jugar:** https://kurusudes.github.io/CatanTestFriendos/ (GitHub Pages desde `main`: cada push publica)
- **Repo:** https://github.com/KurusuDes/CatanTestFriendos

## Notas del vault
- [[01 - Active Context]] — dónde estamos y siguiente paso (se reescribe en cada cierre)
- [[02 - Tareas]] — pendientes y hechas
- `Sesiones/` — una nota por sesión de trabajo ([[S00 - Historia previa]] resume todo lo anterior al vault)

## Mapa del código

| Área | Archivos | Qué hace |
|---|---|---|
| Motor | `js/engine/game.js`, `board.js`, `constants.js`, `config.js`, `rng.js` | Reglas puras: `applyAction(state, action)` valida y aplica; efectos visuales salen en `state.fx` |
| Bots | `js/engine/bot.js` | 3 niveles; `botAct(state, pid)` devuelve la acción; `hint` para la pista 💡 |
| App | `js/app.js`, `js/main.js` | Estado de la partida, `dispatch`, turnos de bots, reacciones (`emote`) y marcadores (`ping`) |
| Online | `js/net.js` | PeerJS/WebRTC: el anfitrión aplica todas las acciones y reenvía el estado; reconexión con token, votación por desconexión, salas |
| Partida (UI) | `js/ui/gameView.js` | Tarjetas, mano, acciones, botón de dados con carga, reacciones, efectos (`handleFx`) y cartas que vuelan entre mano, jugadores y banco (`flyCard`) |
| Mapa 3D | `js/ui/board3d.js`, `dice3d.js` | three.js: terreno, piezas, niebla, dados 3D, banderín del botón del medio, globitos; variantes de aspecto por material (`TILE_LOOKS`) |
| ADHD | `js/ui/adhd.js` | Minijuegos para la espera (Plinko, tragamonedas, moneda, cohete): saldo por jugador, desbloqueo por metas, Auto, fuegos artificiales y franja al ganar (`App.cheer`, mensaje de red `cheer`) |
| Resto UI | `js/ui/lobby.js`, `editor.js`, `flag.js`, `pixel.js`, `sfx.js`, `help.js`, `dom.js` | Menú/salas, editor de mapas, banderas, sprites pixel, sonidos sintetizados, ayuda |
| Estilos | `css/style.css`, `css/pixel.css` | Tema pixel (paleta Sweetie-16) |
| Recursos | `assets/`, `tools/blender/*.py` | Texturas, `kit.glb` e iconos generados con los scripts de Blender |
| Tests | `tests/rules.mjs`, `tests/sim.mjs` | `npm test`: reglas + 300 partidas bot contra bot con invariantes |
| Showcase y tráiler | `showcase/` | Showcase (`index.html`, `showcase.js`) y tráiler satírico ES/EN (`trailer.html`, `trailer.js`, `?lang=en`), con utilidades compartidas en `motion.js`; los MP4 se graban fotograma a fotograma |
| Flujo de trabajo | `.claude/commands/`, `.claude/hooks/session-start.mjs`, `.claude/settings.json` | `/abrir-sesion`, `/cerrar-sesion` y el hook que inyecta el Active Context y las tareas abiertas al empezar |

## Cómo trabajamos
- Local: `python -m http.server 8123` y abrir http://localhost:8123/
- Antes de subir: `npm test`
- `/abrir-sesion [tarea]` al empezar, `/cerrar-sesion` al terminar (documenta aquí, crea tareas, commit y push)
