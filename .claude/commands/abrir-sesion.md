---
description: Abre sesión de trabajo en Katan x Amiguites (estado, pendientes y plan del día)
argument-hint: "[tarea opcional]"
---

Abre la sesión de trabajo:

1. **Estado.** Usa el Active Context y las tareas abiertas que inyectó el hook SessionStart. Si no están en contexto, lee `CatanVault/01 - Active Context.md` y `CatanVault/02 - Tareas.md`.
2. **Lo que quedó suelto.** Corre `git status -sb` y `git log origin/main..HEAD --oneline`. Si hay cambios sin commitear o commits sin subir de una sesión anterior, dilo primero.
3. **Resumen para mí** (tope 150 palabras):
   - estado actual en 2-3 líneas;
   - tareas pendientes de `02 - Tareas.md`, las más importantes primero (máximo 6; si hay más, di cuántas);
   - lo suelto del paso 2, si hay.
4. **Tarea de hoy:** $ARGUMENTS
   - Si hay tarea: con `CatanVault/00 - Index.md` identifica qué archivos toca y propón un plan corto (qué haces, qué decido yo).
   - Si no hay: sugiere 2-3 tareas pendientes para empezar y pregúntame cuál.
5. No edites código hasta que confirme el plan.
