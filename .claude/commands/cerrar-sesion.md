---
description: Cierra la sesión: documenta lo avanzado en el vault de Obsidian, crea las tareas pendientes, commit y push
---

Cierra la sesión de trabajo:

1. **Qué se hizo.** Lee `CatanVault/01 - Active Context.md` para sacar el «Último commit documentado» y corre:
   - `git log --reverse --format='%h %s' <ese hash>..HEAD`
   - `git status --porcelain`
   Junta eso con lo que hablamos en esta conversación (pedidos, decisiones mías, lo que se verificó y lo que no).
2. **Número de sesión.** Mira `CatanVault/Sesiones/`: la nueva es la siguiente a la más alta (`S01`, `S02`...).
3. **Nota de sesión.** Crea `CatanVault/Sesiones/S{NN} - {AAAA-MM-DD} - {título corto}.md` con el mismo formato que las anteriores:
   - frontmatter con `tags: [sesion]`, `fecha` y `commits`;
   - qué se hizo, en bloques, con el hash de cada commit;
   - decisiones que tomé yo (con mis palabras si importan);
   - verificación: tests, capturas, lo que quedó sin probar;
   - archivos tocados, solo los importantes.
   Escribe para alguien que no estuvo en la sesión: frases completas, sin jerga interna.
4. **Tareas.** En `CatanVault/02 - Tareas.md`:
   - marca como hechas (`- [x] ... ✅ fecha [[S{NN} ...]]`, movidas a «Hechas») las que se completaron;
   - crea las nuevas pendientes (`- [ ] ... ➕ fecha [[S{NN} ...]]`) de: cosas sin verificar, ideas que dejamos para después, pedidos míos que no se hicieron, bugs vistos y no arreglados. Una línea cada una, accionable. Si no hay ninguna, no inventes.
5. **Active Context.** Reescribe `CatanVault/01 - Active Context.md`: última sesión (enlace), «Último commit documentado» (el último commit de trabajo de esta sesión, antes del commit de cierre), estado en un párrafo y siguiente paso.
6. **Índice.** Si cambió la arquitectura (archivos o sistemas nuevos), actualiza la tabla de `CatanVault/00 - Index.md`.
7. **Tests.** Si hay código sin commitear, corre `npm test`. Si falla, no hagas push: deja el commit hecho y avísame.
8. **Commit y push.** `git add -A`, commit con mensaje `S{NN}: resumen` (cuerpo con viñetas por bloque; trailers `Co-Authored-By` y `Claude-Session` del system-reminder) y `git push origin main`. Ojo: el push publica el juego en GitHub Pages. Si el push falla, deja el commit y repórtalo.
9. **Reporte** (tope 120 palabras): hash del commit, nota creada, tareas cerradas y creadas, siguiente paso. Sin repetir la sesión: ya está en la nota.
