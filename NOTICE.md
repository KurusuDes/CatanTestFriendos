# Avisos / Notices

## Proyecto de fans, no oficial

**Katanittes** es un proyecto de fans, gratuito y sin ánimo de lucro. **No está afiliado,
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

Todo lo que hay en `public/assets/` (texturas, modelos 3D en `kit.glb`, iconos de recursos), los efectos
de sonido (sintetizados en tiempo real en `src/ui/sfx.ts`) y el material de `showcase/` son
originales de este proyecto: se generan con los scripts de `tools/blender/` y se distribuyen bajo la
misma licencia MIT que el código.

## Software y recursos de terceros

Se instalan con pnpm y se empaquetan con la página (Vite); no se cargan desde CDN.

### En tiempo de ejecución (van dentro del bundle)

| Componente | Uso | Licencia |
|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) 0.187.0 | Motor 3D del tablero y los dados | MIT |
| [meshoptimizer](https://github.com/zeux/meshoptimizer) (decodificador WASM incluido con three.js en `examples/jsm/libs/meshopt_decoder.module.js`) | Descomprime `kit.glb` (`EXT_meshopt_compression`) | MIT |
| [PeerJS](https://github.com/peers/peerjs) 1.5.4 | Conexión P2P (WebRTC) del modo online | MIT |
| [Preact](https://github.com/preactjs/preact) 11 | Interfaz | MIT |
| [@preact/signals](https://github.com/preactjs/signals) 2.11 | Estado reactivo de la interfaz | MIT |
| [Comlink](https://github.com/GoogleChromeLabs/comlink) 4.4 | Comunicación con los Web Workers | Apache-2.0 |
| Be Vietnam Pro y Baloo 2, vía [@fontsource](https://github.com/fontsource/font-files) (paquetes `@fontsource/be-vietnam-pro` y `@fontsource/baloo-2` 5.3) | Tipografías de la interfaz | SIL Open Font License 1.1 |

### Solo en tiempo de compilación (no se distribuyen)

| Componente | Uso | Licencia |
|---|---|---|
| [Vite](https://github.com/vitejs/vite), [TypeScript](https://github.com/microsoft/TypeScript), [Vitest](https://github.com/vitest-dev/vitest), [tsx](https://github.com/privatenumber/tsx), [happy-dom](https://github.com/capricorn86/happy-dom), [stats-gl](https://github.com/RenaudRohlinger/stats-gl) | Compilación, pruebas y medición | Ver la licencia de cada paquete (MIT, salvo TypeScript: Apache-2.0) |
| [gltfpack](https://github.com/zeux/meshoptimizer) 1.3 | Comprime `kit.glb` con meshopt (`pnpm assets`) | MIT |
| [sharp](https://github.com/lovell/sharp) 0.35 | Genera las texturas de baja resolución (`pnpm assets`); sus binarios incluyen libvips (LGPL-3.0-or-later) | Apache-2.0 |

El modo online usa el servidor de señalización público de PeerJS para emparejar a los jugadores;
las partidas en sí viajan directamente entre navegadores.

## Créditos (petición, no obligación)

Además de lo que exige la licencia MIT (conservar el aviso de copyright y el texto de la licencia en
las copias del código), **te pedimos amablemente** que, si usas este proyecto o parte de él en otro
proyecto, menciones el original en un lugar visible (README, créditos o pantalla "acerca de"). Por
ejemplo:

```
Basado en Katanittes de Sowtank — https://github.com/KurusuDes/CatanTestFriendos
```

Es una petición de cortesía: no modifica los términos de la licencia MIT. ¡Y si haces algo con él,
nos encantaría verlo!
