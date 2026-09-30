# Katan x Amiguites

Un juego de colonos inspirado en Catan, en el navegador, con mapas personalizables y modos que no existen en la caja.

**Jugar:** https://kurusudes.github.io/CatanTestFriendos/ · **Tráiler:** https://kurusudes.github.io/CatanTestFriendos/showcase/trailer.html ([MP4](showcase/katan-x-amiguites-trailer.mp4)) · **Trailer (English):** https://kurusudes.github.io/CatanTestFriendos/showcase/trailer.html?lang=en ([MP4](showcase/katan-x-amiguites-trailer-en.mp4)) · **Showcase:** https://kurusudes.github.io/CatanTestFriendos/showcase/ ([MP4](showcase/katan-x-amiguites.mp4))

![Katan x Amiguites](showcase/poster.jpg)

## Qué trae
- **10 formas de mapa** (clásico, mini, extendido 5-6, grande, gigante, anillo del lago, estrella, dos reinos, archipiélago, pangea aleatoria) + **editor de mapas** con códigos para compartir.
- **Modos insignia:** *Blindfold* (tablero boca abajo durante la colocación; al terminar se voltea todo) y *Niebla de guerra* (visión propia: alrededor de tus casas y medio hexágono junto a tus caminos; si construyes sobre alguien oculto, te desvías al hueco libre más cercano).
- **Más modos combinables:** Casas secretas, Números secretos, Eventos por ronda, Tierra viva, Dados equilibrados, Ladrón amable, Sin ladrón, Ciudad inicial, Turbo.
- **Reglas ajustables:** puntos para ganar, límite de mano, rondas de colocación, bonus inicial, piezas por jugador, mazos de desarrollo, oro, puertos, desiertos.
- **Hasta 8 jugadores** (banco, mazo y mapas escalados). Cada reino pinta su **bandera** (editor pixel 12×12) y elige el **color de su castillo**; la bandera ondea en el mapa 3D.
- **Online robusto:** reconexión automática si se cae la señal (recuperas tu asiento), **votación** cuando alguien se desconecta (esperar / que lo sustituya un bot / retirarlo) y el anfitrión puede **reabrir la sala** con el mismo código si se le cae.
- **ADHD:** minijuegos para la espera (Plinko, tragamonedas, moneda y cohete) con dinero falso, que se minimizan solos cuando te toca.
- **Bots** en 3 niveles, **hotseat** con pantalla de pase, **online** P2P (WebRTC/PeerJS, sin servidor) y **mapa 3D de maqueta realista** (three.js: terreno continuo con 8 texturas PBR mezcladas, cielo físico con IBL, agua con espuma según profundidad, hierba y trigo al viento, sombras de nubes, GTAO, tilt-shift; modelos texturizados con AO horneado hechos en Blender en `tools/blender/`) con **UI pixel art**.
- Reglas completas: ladrón, descartes, puertos 3:1 y 2:1, comercio entre jugadores, cartas de desarrollo, camino más largo y ejército más grande.

## Desarrollo
Sitio estático sin build. Para probar en local:

```bash
python -m http.server 8123
```

Tests del motor (reglas + cientos de partidas bot contra bot con verificación de invariantes):

```bash
npm test
```

## Licencia

Código y recursos originales bajo licencia [MIT](LICENSE) © 2026 Sowtank. Si lo usas en otro proyecto, te agradeceremos que nos des crédito visible (detalles en [NOTICE.md](NOTICE.md)).

Proyecto de fans no oficial: no está afiliado ni aprobado por Catan GmbH, CATAN Studio ni Kosmos. *CATAN* es una marca de sus respectivos propietarios. Avisos de terceros (three.js, PeerJS, fuentes) en [NOTICE.md](NOTICE.md).
