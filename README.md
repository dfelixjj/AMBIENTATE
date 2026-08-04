# AMBIENTATE

**AMBIÉNTATE · Rutas** — CRM y gestión de rutas para técnicos de aromatización ambiental.

## Estructura

- `index.html` — Aplicación frontend completa (SPA autocontenida, funciona offline)
- `logo.png` — Logo de la empresa
- `backend/` — Backend local Node.js + SQLite (desarrollo/demostración)
  - `server.mjs` — Servidor API REST (Node ≥ 22, sin dependencias externas)
  - `schema.sql` — Esquema completo de la base de datos

## Arranque rápido

```bash
# Backend (API en http://localhost:4000)
cd backend
node --experimental-sqlite server.mjs

# Frontend (abrir directamente o con cualquier servidor HTTP)
open index.html
```

## Credenciales demo

| Rol | Clave |
|---|---|
| Administrador | `0000` |
| Técnicos (Juan / Ana) | `1234` |
