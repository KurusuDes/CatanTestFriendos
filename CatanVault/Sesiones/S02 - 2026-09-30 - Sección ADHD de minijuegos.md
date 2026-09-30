---
tags: [sesion]
fecha: 2026-09-30
commits: un solo commit, el de cierre «S02: sección ADHD de minijuegos»
---

# S02 - 2026-09-30 - Sección ADHD de minijuegos

Se añadió «ADHD», una sección de minijuegos independiente de la partida para entretenerse mientras juegan los demás. Todo el trabajo va en el commit de cierre de esta sesión.

## Qué se hizo

### La ventana ADHD
- Botón 🧠 en la barra de abajo, al lado del selector de emojis 😀. Abre una ventanita en la esquina inferior izquierda del mapa con una cuadrícula de 2×2 espacios.
- Los espacios que faltan por desbloquear se ven vacíos, rayados y sin texto, para que sea sorpresa qué va ahí. Cada máquina nueva aparece en su espacio con una animación y un sonido.
- **En tu turno** (o cuando te toca actuar, por ejemplo descartar), la ventana se minimiza sola y vuelve al terminar. Si la abres a mano durante tu turno, se queda abierta.
- **Si llega una oferta de comercio**, la ventana queda detrás de la oferta, apagada y sin poder tocarse.
- **Al cerrarla o minimizarla** se resuelve lo que esté en juego: las bolas del Plinko caen, los rodillos paran, la moneda cae y el cohete cobra en el multiplicador del momento.
- Cada jugador tiene su propio saldo (también en hotseat), guardado en el navegador mientras dura esa partida. Una partida nueva empieza de cero.

### Las máquinas y el saldo
- Un solo saldo que empieza en $100. Todas las máquinas desbloqueadas se usan a la vez.
- Orden y metas: **Plinko** (al inicio) → **Tragamonedas** a los $200 → **Moneda** a los $400 → **Cohete** a los $800 → **victoria** a los $1600.
  - **Plinko:** $1 por bola, 9 casillas con multiplicadores de x0,4 a x25.
  - **Tragamonedas:** tres rodillos, apuesta de $5 a $100; par x2, trío de x5 a x30.
  - **Moneda:** slider para decidir cuánto apostar, botones Cara o Cruz; doble o nada.
  - **Cohete:** el multiplicador sube desde x0,00 y explota en un punto al azar entre x0 y x5; hay que retirarse antes.
- **Auto:** una máquina gana un botón Auto cuando ya la superaste (se desbloqueó la siguiente). El Plinko suelta unas 4 bolas por segundo, las tragamonedas vuelven a girar con la apuesta actual y la moneda repite el último lado elegido con la apuesta del slider. El cohete, que es el juego final, no tiene Auto. El Auto se apaga solo cuando no alcanza el dinero o al minimizar.
- **Quebrar:** si te quedas con menos de $1 y no hay nada en juego, vuelves al Plinko con $100.
- **Ganar:** salen fuegos artificiales pixel desde todas las casas y ciudades del ganador y una franja «¡X venció el ADHD!». En online lo ven todos: viaja por la red como un mensaje nuevo (`cheer`), limitado a uno cada 15 segundos por jugador. Después el saldo vuelve a $100 y se suma un 🏆 al contador.

## Decisiones del usuario
- La sección se llama ADHD y es «independiente al juego, para hacer algo mientras esperas tu turno»: se minimiza en tu turno y se pone detrás de las ofertas de comercio.
- Todo «super sencillo», en una pantalla más chica que la principal, con la sensación de «pequeñas secciones que se van añadiendo una después de otra».
- Las secciones que faltan no se ven, «para que sea sorpresa», pero los espacios vacíos dan la sensación de que algo va ahí.
- El cohete empieza en x0,0 y explota en cualquier número hasta x5.
- Todas las máquinas se usan a la vez; avanzar solo da más opciones.
- Los fuegos artificiales son solo visuales, salen «de tus casitas» y hay una franja para todos con el nombre del ganador.
- Cada jugador tiene su propio minijuego.
- Tras probar la primera versión: el Cohete pasa a ser el juego final (antes era el tercero, antes de la Moneda) y se añade Auto a cada máquina ya superada, menos al Cohete.
- Las metas de $800 y $1600 las propuso Claude (seguir duplicando); el usuario no las cambió.

## Verificación
- `npm test`: reglas y 300 partidas bot contra bot, sin errores.
- En Chrome, con una partida local contra bots (primera versión, con el orden anterior):
  - funcionaron el Plinko con Auto, el desbloqueo de tragamonedas y cohete, la retirada del cohete, la victoria (franja, vuelta a $100 y 🏆1) y quebrar (vuelta al Plinko);
  - también la minimización en tu turno, la vuelta sola al terminar y ponerse detrás de una oferta;
  - sin errores en consola.
- Los fuegos artificiales se comprobaron solo en parte: los cohetes salen desde el poblado del jugador y suben. La explosión no se llegó a ver porque la pestaña de prueba estaba en segundo plano y el navegador congela las animaciones.
- **Sin probar en el navegador:** el orden nuevo y los botones Auto (la extensión de Chrome se desconectó; se revisó el código y la sintaxis), la animación completa de la moneda, el online con otra persona, el hotseat con dos humanos y el móvil.

## Archivos importantes
- `js/ui/adhd.js` (nuevo): la ventana, el saldo, las cuatro máquinas, los fuegos artificiales y la franja.
- `js/ui/gameView.js`: el botón 🧠, la ventana montada sobre el mapa y su estado en cada render (turno y oferta).
- `js/app.js` y `js/net.js`: `App.cheer` y el mensaje de red `cheer` para avisar a todos de la victoria.
- `js/ui/sfx.js`: sonidos de desbloqueo, explosión del cohete y fuegos artificiales.
- `css/pixel.css`: estilos de la ventana, los fuegos y la franja.
