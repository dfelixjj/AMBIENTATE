---
name: deploy-github
description: Workflow para hacer commit y push del proyecto AMBIÉNTATE a GitHub. Úsalo cuando el usuario diga "deploy", "subir a github", "commit", "push" o "publicar cambios".
---

# Deploy a GitHub — AMBIÉNTATE

Workflow paso a paso para hacer commit y push al repositorio de GitHub.
Ejecuta estos pasos **en orden** y **pide confirmación** al usuario antes del push.

## Repositorio

- **Remote**: `https://github.com/dfelixjj/AMBIENTATE.git`
- **Branch**: `main`
- **Directorio de trabajo**: `/Users/felixjimenezjurado/Desktop/ANDALMET/app andalmet/ambientate-rutas`

## Paso 1 — Verificar estado

Ejecuta `git status` para ver qué archivos han cambiado.
Muestra al usuario un resumen claro de:
- Archivos modificados
- Archivos nuevos (untracked)
- Archivos eliminados

## Paso 2 — Revisar diferencias

Ejecuta `git diff --stat` para mostrar un resumen compacto de los cambios.
Si el usuario lo pide, muestra el diff completo de archivos específicos.

## Paso 3 — Confirmar con el usuario

Presenta al usuario:
1. Lista de cambios que se van a incluir
2. Pregunta qué **mensaje de commit** quiere usar
3. Ofrece sugerencias de mensaje basadas en los archivos cambiados

**NO continúes hasta que el usuario apruebe el mensaje.**

## Paso 4 — Staging y Commit

```bash
git add -A
git commit -m "<mensaje del usuario>"
```

## Paso 5 — Push

Ejecuta el push:
```bash
git push -u origin main
```

### Si falla la autenticación

Si el push falla por autenticación:
1. Comprueba si `gh` está disponible: `which gh`
2. Si existe, ejecuta `gh auth login` y luego reintenta
3. Si no existe, pide al usuario su **Personal Access Token** (PAT) de GitHub
4. Configura el remote con el token: `git remote set-url origin https://<TOKEN>@github.com/andalmet-platform/AMBIENTATE.git`
5. Reintenta el push
6. **IMPORTANTE**: No guardes ni muestres el token en logs o artefactos

## Paso 6 — Confirmación

Tras el push exitoso:
1. Ejecuta `git log -1 --oneline` para mostrar el commit
2. Proporciona el enlace directo: `https://github.com/andalmet-platform/AMBIENTATE`
3. Muestra un resumen: nº de archivos, insertions/deletions

## Reglas

- **NUNCA** hagas push automáticamente sin aprobación explícita del usuario
- **NUNCA** hagas `git reset --hard` ni `git clean -fd` sin confirmación
- Si hay conflictos, muéstralos y pide instrucciones al usuario
- Respeta el `.gitignore` existente (excluye DB, logs, .DS_Store)
