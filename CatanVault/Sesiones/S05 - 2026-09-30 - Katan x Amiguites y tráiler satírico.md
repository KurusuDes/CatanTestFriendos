---
tags: [sesion]
fecha: 2026-09-30
commits: «S05: Katan x Amiguites y tráiler satírico en español e inglés» (5ad8e56) y «S05: README detallado en inglés»
---

# S05 - 2026-09-30 - Katan x Amiguites y tráiler satírico

El proyecto pasó a llamarse **Katan x Amiguites** y se hizo un tráiler satírico de motion graphics, en español y en inglés, centrado en la parodia de anuncio de apuestas de los minijuegos ADHD. También se volvió a grabar el vídeo del showcase con el nombre nuevo. Todo el trabajo va en el commit de cierre de esta sesión.

## Qué se hizo

### Nombre nuevo: Katan x Amiguites
- Cambiado en el logo del menú y de la partida, el título de la página, el texto al compartir una sala, la ayuda («Modos Amiguites»), el pie del menú («Hecho para los Amiguites»), el README, NOTICE.md, package.json, el showcase, el comando /abrir-sesion y el índice del vault.
- No se cambiaron las claves de guardado del navegador (`kchudites.*`), para no perder partidas ni ajustes guardados. Los nombres de los bots (Kchudo, La Kchuda…) también siguen igual.
- El repositorio y la URL de GitHub Pages siguen siendo `CatanTestFriendos`.

### Tráiler satírico (`showcase/trailer.html`)
- Unos 69 segundos en 10 escenas, con el mismo sistema que el showcase: cada fotograma depende solo del tiempo, así que se ve en vivo en el navegador o se graba fotograma a fotograma.
- Escenas: intro de «tráiler épico» («En un mundo… donde tus amigos te roban ovejas…»), logo, maqueta 3D, Blindfold, niebla de guerra, comercio con cartas volando, bots, reseñas inventadas y cierre («Gratis · Sin anuncios · Sin micropagos (solo microapuestas imaginarias)»).
- La pieza central es un anuncio de casino de unos 16 segundos para el ADHD:
  - luces de marquesina y «¡PRUEBA EL ADHD!»;
  - las cuatro máquinas funcionando (Plinko, jackpot en la tragamonedas, moneda que cae en cara, cohete que explota en x4.87);
  - testimonios falsos y la escalera de $100 a $1600 con fuegos artificiales;
  - letra pequeña leída a toda velocidad y «APUESTA RESPONSABLEMENTE*, *o sea: no apuestes. Juega al Katan».
- El aviso final dice que es un proyecto de fans no oficial, no afiliado a Catan GmbH «ni a ningún casino».
- Música chiptune y efectos sintetizados con un script de Python que se sincroniza con las escenas. Se reutiliza en los dos idiomas.
- **Versión en inglés:** mismos tiempos y música, con los chistes traducidos. Se ve con `trailer.html?lang=en` y la página tiene un botón para cambiar de idioma.
- Vídeos: `showcase/katan-x-amiguites-trailer.mp4` y `showcase/katan-x-amiguites-trailer-en.mp4`.

### Lo que va por encima siempre es el tráiler
- A petición del usuario, nada del mapa 3D puede taparlo:
  - la capa 3D va en su propio nivel, así que los números de las casillas y los carteles de puertos quedan detrás de los textos;
  - además, en cada fotograma se ocultan las etiquetas que tocan un título, sello o tarjeta, o que caen en la columna de texto de la izquierda (`clearLabels` en `showcase/motion.js`).
- Se aplicó también al showcase.
- Tras revisar ambos idiomas completos, se corrigieron también: cartas del comercio que tapaban los nombres, textos del casino que se salían de la pantalla, el 🧠 descolocado, reseñas que se pisaban y etiquetas del final que crecían de más al aparecer.

### Showcase y menú
- El showcase se volvió a grabar con el nombre nuevo (`showcase/katan-x-amiguites.mp4`, con la música del vídeo anterior). Se borró el vídeo viejo `catan-x-kchudites.mp4`, que sigue en el historial de git.
- El póster del README ahora es el cierre del tráiler.
- Las utilidades de animación compartidas (easing, títulos animados, partidas de bots) se movieron a `showcase/motion.js`, que usan el showcase y el tráiler.
- Botón «🎞️ Tráiler» en el menú del juego, junto a «🎬 Showcase». El README enlaza a los dos tráileres.

### README en inglés (después del cierre)
- A petición del usuario, el `README.md` pasó a estar en inglés y mucho más detallado: enlaces a jugar y a los tráileres, GIF del casino del tráiler, fotogramas, capturas del menú y de una partida, todas las funciones explicadas, la tecnología con la tabla de archivos, cómo ejecutarlo y la licencia.
- El README en español se conserva como `README.es.md`, con un enlace entre los dos.
- Las imágenes están en `showcase/readme/`.

## Decisiones del usuario
- Nombre: «Dejémoslo en Katan x Amiguites». Claude había advertido que «Katan» suena igual que Catan; el usuario lo asumió porque no espera que lo vea «alguien importante».
- Tráiler «de manera satírica, mencionando el tema de los minijuegos de apuestas».
- Tras verlo: «me dio mucha risa». Pidió quitar un número de casilla que tapaba un cartel y después que «todo lo que sea del tráiler siempre tenga la prioridad».
- Pidió la versión en inglés «exactamente igual pero en inglés».

## Verificación
- `npm test`: reglas y 300 partidas bot contra bot, sin errores. Sintaxis de los scripts del tráiler comprobada.
- Revisión completa de los dos idiomas con capturas cada 0,9 s en Chrome sin ventana (con GPU), y fotogramas sueltos de los tres MP4 finales. No queda nada tapando los textos.
- Menú del juego capturado con el logo nuevo, sin errores en la página.
- **Sin probar:** el tráiler reproducido en vivo en un navegador normal y en móvil, y el sonido escuchado por una persona (solo se midieron los niveles por escena).

## Archivos importantes
- `showcase/trailer.html`, `trailer.js`, `trailer.css`: el tráiler y sus textos en los dos idiomas.
- `showcase/motion.js`: utilidades compartidas y `clearLabels`.
- `showcase/showcase.js`: usa `motion.js`, nombre nuevo y etiquetas siempre detrás.
- `showcase/*.mp4`, `showcase/poster.jpg`: los vídeos y el póster nuevos.
- `index.html`, `js/main.js`, `js/ui/gameView.js`, `js/ui/lobby.js`, `js/ui/help.js`, `README.md`, `NOTICE.md`, `package.json`: el nombre nuevo.
- Scripts de grabación y música (fuera del repo, en la carpeta temporal de la sesión): `record.mjs`, `trailer_audio.py`, `trailer_peek.mjs`.
