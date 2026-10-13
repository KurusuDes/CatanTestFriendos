---
tags: [sesion]
fecha: 2026-10-13
commits: «S07: Katanittes: nombre oficial, bots nuevos, ADHD transparente con 2 minijuegos y tráilers regrabados» (c78ddde) y «S07: el juego en seis idiomas (selector en el menú) y GIFs del tráiler para Reddit» (fb08408)
---

# S07 - 2026-10-13 - Katanittes, seis idiomas y kit de Reddit

El juego pasó a llamarse **Katanittes**, se quitó todo lo relacionado con «Kchudites», el ADHD dejó de minimizarse y ganó dos minijuegos, y se regrabaron los dos tráilers y el showcase con el nombre nuevo. Después se preparó el lanzamiento en Reddit (textos por comunidad y GIFs del tráiler) y, al final, se tradujo el juego entero a seis idiomas con un selector en el menú principal.

## Qué se hizo

### Nombre, bots y ADHD (c78ddde)
- **Nombre oficial Katanittes** en el menú (logo de una sola palabra: KATAN en dorado, ITTES en blanco), la barra de la partida, el título de la pestaña, el tráiler, el showcase, los README y el NOTICE.
- **Bots sin Kchudites:** Kchudo → Leñadora, La Kchuda → Sir Ladrillo, Chuchito → El Banquero. Las claves guardadas en el navegador pasan de `kchudites.*` a `katanittes.*` con una migración automática que también renombra esos bots dentro de las partidas guardadas, para que los testers no pierdan nada.
- **ADHD transparente:** cuando es tu turno o hay una oferta de intercambio, la ventana se queda en pantalla pero transparente y no responde (los clics pasan al mapa). Al volverse transparente se cobra lo que estaba en el aire (el cohete se retira, la carrera termina) y se apagan los Auto.
- **Dos minijuegos nuevos:** la **carrera de ovejas** (apuestas a una de cuatro ovejas; la favorita paga x2.6 y la menos probable x10; tiene Auto) y **la mina** (16 piedras, 3 esconden al ladrón; cada mineral sube el premio y cobras cuando quieras; sin Auto). Ahora son 6 máquinas que se desbloquean en $150, $250, $400, $650 y $1000; la meta sigue en $1600 y el cohete sigue siendo la última.
- **Tráilers ES/EN y showcase regrabados** con el nombre nuevo. El casino del tráiler tiene un momento nuevo, «¡Nuevas máquinas!», con las dos máquinas; la música es la misma, alargada 8 compases para que la explosión del cohete caiga justo cuando sale el ladrón de la mina. Duran 72 s. Los MP4 se llaman ahora `katanittes-trailer.mp4`, `katanittes-trailer-en.mp4` y `katanittes.mp4`.
- **Crédito visible en el juego:** al pie del menú («Katanittes, por Sowtank · código en GitHub · proyecto de fans no oficial») y una sección «Créditos» en la ayuda que pide mencionar y enlazar el repo.
- Imágenes del README rehechas (menú, partida, reseñas, escalera, GIF del casino y póster) y `launch.json` usa `py`.

### Seis idiomas (fb08408)
- **Selector de idioma** arriba a la derecha del menú principal: español, inglés, portugués, francés, alemán e italiano. La primera vez usa el idioma del navegador (inglés si no es ninguno de los seis); la elección se guarda.
- **Cómo funciona:** el español sigue siendo el texto fuente. `js/i18n.js` tiene `t()` (busca el texto en el diccionario del idioma) y cada idioma tiene su archivo en `js/i18n/`. Los términos del juego usan los nombres oficiales de Catan de cada país.
- **El historial y los errores del motor** se guardan como plantilla con valores (no como frase hecha), así que en online cada jugador los ve en su propio idioma aunque los demás hayan elegido otro.
- **Nombres por defecto** («Tú», «Jugador 2», «Amigo 1») salen en el idioma de quien los crea; los nombres de los bots no se traducen.
- **`tools/i18n.mjs`:** `node tools/i18n.mjs check` lista los textos que faltan en cada idioma (hoy 663 de 663 en todos).

### Lanzamiento en Reddit
- **Kit de Reddit** como artifact privado (https://claude.ai/artifact/DmAJ51KFAawAdmCBdnWvuZ): plan de una comunidad al día (r/Catan, r/WebGames, r/ClaudeAI, r/ClaudeCode, r/vibecoding, r/playmygame, r/SideProject, r/Peru, r/juegosdemesa), título y cuerpo listos para copiar en cada una, y comunidades que mejor evitar (r/ADHD, r/boardgames, r/gamedev). Los textos ya dicen que el juego está en seis idiomas.
- **GIFs del tráiler** de 13 s (unos 5 MB) en `showcase/reddit/katanittes-en.gif` y `katanittes-es.gif`, porque los subs no dejaban subir videos.

## Decisiones del usuario
- Nombre oficial **Katanittes**; quitar «todo lo relacionado a kachudites en los nombres de los bots»; los temas del tráiler se mantienen igual.
- ADHD: «en lugar de que se minimice cuando es tu turno o llega una oferta se pone como transparente y no puedes interactuar con él», y más minijuegos.
- Hosting: se queda en **GitHub Pages** con el repo público. Vercel no protegería el código (un juego web siempre se descarga entero en el navegador). Sobre la licencia MIT: «no me molesta que lo utilicen si ponen créditos o mandan mi repo»; por eso el crédito visible en el juego.
- Promoción: solo el tráiler que ya existe («en todos usaré el tráiler»), en GIF porque no le dejaban subir videos.
- Idiomas: «los idiomas más comunes»; se eligieron los seis de alfabeto latino, que caben en las fuentes pixel del juego.
- Al cerrar: «con esta pequeña update estamos listos» para lanzar.

## Verificación
- `npm test`: 19 pruebas de reglas sin fallos y 300 partidas bot contra bot terminadas (antes de cada commit).
- La web publicada tras c78ddde: título Katanittes, los MP4 nuevos responden y el tráiler en inglés carga con 72,5 s.
- ADHD en el navegador: se vuelve transparente en tu turno y con las ofertas y vuelve a responder al terminar; el cohete en vuelo se cobra al volverse transparente; la carrera de ovejas y la mina funcionan (también se grabó una partida real con la ventana jugando sola).
- Migración de claves: una clave `kchudites.*` con bots viejos pasa a `katanittes.*` con los nombres nuevos.
- Idiomas: capturas sin errores de menú, sala, partida y ADHD en alemán, inglés, francés y portugués; el historial sale traducido mensaje a mensaje y los textos largos caben en escritorio.
- **Sin probar:** el italiano en pantalla; los idiomas en móvil; una partida online con dos personas en idiomas distintos; el ADHD transparente y los minijuegos nuevos en móvil y online; los tráilers con sonido en un navegador normal y en móvil.

## Archivos importantes
- `js/i18n.js`, `js/i18n/*.js`, `tools/i18n.mjs`: traducciones, diccionarios y extractor.
- `js/engine/game.js`: historial y errores como plantilla + valores (`msg`).
- `js/ui/adhd.js`, `css/pixel.css`: modo transparente, carrera de ovejas y la mina.
- `js/ui/dom.js`: migración de claves `kchudites.*` → `katanittes.*`.
- `js/main.js`, `js/ui/help.js`: selector de idioma y créditos.
- `showcase/trailer.js`, `trailer.css`, `motion.js`, `showcase.js`: nombre nuevo y momento «¡Nuevas máquinas!»; `showcase/*.mp4` y `showcase/reddit/*.gif`.
