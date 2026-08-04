# Backend local de AMBIÉNTATE (Node + SQLite)

Backend **real y funcionando** para desarrollo/demostración, sin instalar nada
(usa el SQLite integrado de Node ≥ 22). Es el equivalente local del backend
Supabase de producción (mismo modelo que `schema.sql`).

## Arrancar

```bash
cd "ambientate-rutas/backend"
node --experimental-sqlite server.mjs
```

Queda escuchando en **http://localhost:4000**. Los datos se guardan en
`backend/ambientate.db` (SQLite) y son **compartidos**: si abres la app en dos
navegadores/dispositivos, ambos ven y escriben los mismos datos.

- Reiniciar con datos demo limpios: borra `ambientate.db*` y vuelve a arrancar.
- Parar: `Ctrl+C` (o `lsof -ti:4000 | xargs kill`).

## Credenciales demo
- Administrador → clave `0000`
- Técnicos (Juan Martín `t1`, Ana López `t2`) → clave `1234`

## API (JSON)
| Método y ruta | Qué hace |
|---|---|
| `GET /api/perfiles` | Lista de técnicos para la pantalla de acceso |
| `POST /api/login` | `{rol, tecnicoId?, clave}` → `{token}` |
| `GET /api/bootstrap` | Catálogos + maestros (técnicos, rutas, clientes, aromas, tareas) |
| `GET /api/jornada?ruta=&fecha=` | Genera/devuelve la jornada + visitas (arrastra pendientes) |
| `POST /api/visita/:id` | Actualiza estado/cobro/venta/incidencia/consumo |
| `POST /api/jornada/:id/cerrar` | Cierra + pasa pendientes + crea tarea de verificación |
| `POST /api/cliente` | Crear/actualizar cliente (+ dispositivos) |
| `POST /api/gasto` | Registrar gasto |
| `GET /api/tareas` · `POST /api/tarea/:id/resolver` | Bandeja del admin |

Todas requieren `Authorization: Bearer <token>` salvo `/api/perfiles` y `/api/login`.

## Relación con producción (Supabase)
- La **lógica** (generar jornada con herencia, cerrar + tarea) está en el servidor,
  igual que las funciones RPC de `schema.sql`.
- Al pasar a Supabase, la app usará el SDK de Supabase apuntando a las mismas
  operaciones; este servidor local sirve como **referencia de la API** y para
  desarrollar/probar sin depender de la nube.

## Siguiente paso (Fase 1 de la migración)
Cambiar en la app `S`/`localStorage` por llamadas a esta API (módulo `api.js`),
manteniendo una caché local para trabajar sin cobertura (offline-first).
