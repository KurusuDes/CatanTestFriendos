---
tags: [sesion]
fecha: 2026-09-30
commits: 7a064f3..bd695e6
---

# S00 - Historia previa (2026-09-29 → 2026-09-30)

Resumen de todo lo hecho antes de crear el vault, reconstruido desde el historial de git.

## 2026-09-29
- **Base** (`7a064f3`–`c412c65`): motor de reglas, bots, UI 2D, editor de mapas, online P2P; primera vista 3D con three.js; tests de reglas y pulido móvil.
- **Modos insignia** (`0471001`): *Blindfold* (tablero volteado en la colocación) y *Niebla de guerra* (visión por jugador y desvío si construyes sobre alguien oculto).
- **Dirección de arte** (`204e3c5`, `e645d75`): mapa 3D continuo estilo Civ VI con modelos de Blender, niebla por shader; luego maqueta realista (terreno PBR, cielo físico, agua con espuma, hierba al viento, GTAO). UI pixel art con paleta Sweetie-16.
- **Showcase** (`b74e2dd`, `46eb4fc`, `015806b`): página, video con motion graphics y chiptune, póster.
- **Online robusto** (`51a8aed`, `3f0d3ed`): hasta 8 jugadores, votación por desconexión (esperar / bot / retirar), reconexión con token, reabrir sala; pantalla online con reino, salas con PIN, sala de espera y gestión (capacidad, abrir/cerrar, expulsar, rellenar con bots).
- **Banderas** (`5ef5d93`): editor pixel estilo Gartic Phone, banderas en castillos.
- **Pulido del mapa** (`77b5867`, `c5f44d8`): 3D como única vista, barra de probabilidad en fichas, caminos con uniones, contorno visible a través del terreno, iconos de recursos renderizados desde Blender.

## 2026-09-30
- **Efectos de partida** (`474ff41`, `0c1fb81`): dados 3D que caen en el tablero, recursos que vuelan a la mano, reacciones con emojis en globitos, marcador con el botón del medio, ladrón que tiñe su casilla, puertos con pasarelas, TURN, arreglos de UI (paneles que ya no se reconstruyen en cada jugada).
- **Licencia** (`f2fb6d8`): MIT, `NOTICE.md` (proyecto de fans no oficial, marca CATAN, terceros: three.js, PeerJS, fuentes OFL) y petición de crédito no vinculante.
- **Dados con carga** (`bd695e6`): toca = tirar al momento; mantén = barra de fuerza (los dados salen de más lejos, más alto, giran más, rebote extra y golpe en la mesa; la fuerza viaja en `fx.power`, así que en online todos ven lo mismo). Reacciones desde todas las construcciones. Marcador del botón del medio convertido en banderín 3D de tu color que se desvanece.

## Verificación
`npm test`: 17 pruebas de reglas y 300 partidas sin errores. Capturas en navegador de la carga, el lanzamiento, los globitos y el banderín. Sin probar: tacto en móvil y online con otra persona.
