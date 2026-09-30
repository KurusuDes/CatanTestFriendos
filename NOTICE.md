# Avisos / Notices

## Proyecto de fans, no oficial

**Katan x Amiguites** es un proyecto de fans, gratuito y sin ánimo de lucro. **No está afiliado,
patrocinado ni aprobado** por Catan GmbH, CATAN Studio ni Kosmos. *CATAN* y los nombres, logotipos
y elementos asociados son marcas registradas de sus respectivos propietarios; aquí se mencionan
solo para describir el juego en el que se inspira.

La licencia MIT de este repositorio cubre **únicamente el código y los recursos originales de este
proyecto**. No concede ningún derecho sobre la marca *CATAN* ni sobre material de terceros. Si
publicas un fork, te recomendamos **cambiarle el nombre** y no presentarlo como producto oficial.

> *Unofficial fan project. Not affiliated with, sponsored or endorsed by Catan GmbH, CATAN Studio
> or Kosmos. CATAN is a trademark of its respective owners. The MIT license covers only this
> project's original code and assets and grants no rights to the CATAN trademark.*

## Recursos propios

Todo lo que hay en `assets/` (texturas, modelos 3D en `kit.glb`, iconos de recursos), los efectos
de sonido (sintetizados en tiempo real en `js/ui/sfx.js`) y el material de `showcase/` son
originales de este proyecto: se generan con los scripts de `tools/blender/` y se distribuyen bajo la
misma licencia MIT que el código.

## Software y recursos de terceros

No se incluyen en el repositorio; se cargan desde CDN en tiempo de ejecución.

| Componente | Uso | Licencia |
|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) 0.170.0 | Motor 3D del tablero y los dados | MIT |
| [PeerJS](https://github.com/peers/peerjs) 1.5.4 | Conexión P2P (WebRTC) del modo online | MIT |
| [Fredoka](https://fonts.google.com/specimen/Fredoka), [Nunito](https://fonts.google.com/specimen/Nunito), [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans), [Silkscreen](https://fonts.google.com/specimen/Silkscreen) (Google Fonts) | Tipografías de la interfaz | SIL Open Font License 1.1 |

El modo online usa el servidor de señalización público de PeerJS para emparejar a los jugadores;
las partidas en sí viajan directamente entre navegadores.

## Créditos (petición, no obligación)

Además de lo que exige la licencia MIT (conservar el aviso de copyright y el texto de la licencia en
las copias del código), **te pedimos amablemente** que, si usas este proyecto o parte de él en otro
proyecto, menciones el original en un lugar visible (README, créditos o pantalla "acerca de"). Por
ejemplo:

```
Basado en Katan x Amiguites de Sowtank — https://github.com/KurusuDes/CatanTestFriendos
```

Es una petición de cortesía: no modifica los términos de la licencia MIT. ¡Y si haces algo con él,
nos encantaría verlo!
