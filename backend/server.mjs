// ============================================================================
// AMBIÉNTATE · Backend local (Node + SQLite integrado, sin dependencias)
// Equivalente en local del backend Supabase (mismo modelo que schema.sql).
// Arranque:  node --experimental-sqlite server.mjs   (Node >= 22)
// Sirve una API JSON en http://localhost:4000 con datos COMPARTIDOS: varios
// navegadores/dispositivos ven y escriben los mismos datos.
// También sirve los archivos estáticos (index.html, logo.png, etc.).
// ============================================================================
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const DIR = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = join(DIR, ".."); // raíz del proyecto (donde está index.html)
const db = new DatabaseSync(join(DIR, "ambientate.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

// MIME types para archivos estáticos
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".webmanifest": "application/manifest+json",
};

const uid = () => Math.random().toString(36).slice(2, 9);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---------------------------------------------------------------------------
// ESQUEMA (SQLite) + SEED (solo la primera vez)
// ---------------------------------------------------------------------------
function migrate() {
  db.exec(`
  -- Tablas originales
  create table if not exists ajustes (clave text primary key, valor text);
  create table if not exists aromas (nombre text primary key);
  create table if not exists dispositivos_tipo (id text primary key, label text, unidad text, cantidad real, bacterio integer, precio real default 0);
  create table if not exists tecnicos (id text primary key, nombre text, telefono text, rol text, clave text, activo integer default 1);
  create table if not exists rutas (id text primary key, nombre text, tecnico_id text, fecha_ancla text, frecuencia_dias integer default 28, municipio text default '', activa integer default 1);
  create table if not exists clientes (id text primary key, negocio text, sector text, direccion text, cp text, municipio text, provincia text,
      lat real, lng real, email text, telefono text, importe real, descuento_pct real default 0, nota_trabajo integer default 0,
      forma_habitual text, aroma text, ruta_id text, activo integer default 1, contrato_estado text default 'nuevo',
      banco_titular text, banco_iban text, fecha_alta text);
  create table if not exists cliente_dispositivos (id text primary key, cliente_id text, dispositivo_tipo text, cantidad integer default 1);
  create table if not exists reprogramaciones (id text primary key, ruta_id text, fecha_original text, fecha_nueva text);
  create table if not exists jornadas (id text primary key, fecha text, ruta_id text, tecnico_id text, cerrada integer default 0, unique(fecha, ruta_id));
  create table if not exists visitas (id text primary key, jornada_id text, cliente_id text, orden integer default 0,
      estado text default 'programada', heredada integer default 0, anadida integer default 0, motivo_anadido text,
      servicio_ok integer, cambio_aroma text, hora text,
      cobro_importe real, cobro_forma text, venta_producto text, venta_importe real, incidencia_tipo text, incidencia_nota text,
      incidencia_json text,
      unique(jornada_id, cliente_id));
  create table if not exists consumos (id text primary key, visita_id text, dispositivo_tipo text, producto text, unidad text, cantidad real);
  create table if not exists gastos (id text primary key, tecnico_id text, ruta_id text, negocio text, concepto text, importe real, foto_url text, fecha text, categoria text, proveedor_id text, vehiculo_id text);
  create table if not exists tareas (id text primary key, tipo text, estado text default 'pendiente', fecha text, ruta_id text, tecnico_id text, datos text, resultado text);

  -- Tablas nuevas (Fase 1)
  create table if not exists documentos (id text primary key, numero text, tipo text, cliente_id text, cliente_nombre text,
      producto text, importe real, total real, fecha text, estado text default 'emitida',
      cobrado real default 0, firma text, adjuntos text);
  create table if not exists fichajes (id text primary key, tecnico_id text, fecha text, hora_inicio text, hora_fin text);
  create table if not exists proveedores (id text primary key, nombre text, cif text, telefono text, email text, categoria text);
  create table if not exists vehiculos (id text primary key, matricula text, modelo text, tecnico_id text, itv text, seguro_vence text, ultima_revision text);
  create table if not exists eventos (id text primary key, fecha text, titulo text, nota text);
  create table if not exists solicitudes (id text primary key, tecnico_id text, tipo text, fecha_inicio text, fecha_fin text, nota text, estado text default 'pendiente', creada text);
  create table if not exists stock_difusores (dispositivo_tipo text primary key, cantidad integer default 0);
  create table if not exists numeracion (tipo text primary key, prefijo text, siguiente integer default 1);
  `);

  const seeded = db.prepare("select count(*) c from tecnicos").get().c;
  if (seeded) return;

  const hoy = todayISO(), ayer = addDays(hoy, -1);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  run("insert or ignore into ajustes values('cierre_automatico','true'),('meses_adelanto','3')");
  ["Skull", "Canela", "Mango", "Infantil", "Azahar"].forEach(a => run("insert or ignore into aromas values(?)", a));
  [["HIDRO 1", "Hidro 1", "bote", 1, 0, 13], ["NEBU 1", "Nebu 1", "ml", 100, 0, 18], ["NEBU 1.5", "Nebu 1,5", "ml", 150, 0, 25],
   ["NEBU 2", "Nebu 2", "ml", 200, 0, 30], ["NEBU 5", "Nebu 5", "ml", 500, 0, 60], ["BACTERIOSTATICO 1", "Bacteriostático 1", "bote", 1, 1, 0]]
    .forEach(d => run("insert or ignore into dispositivos_tipo values(?,?,?,?,?,?)", ...d));

  run("insert or ignore into tecnicos values('t1','Técnico 1','600 111 222','tecnico','1234',1)");
  run("insert or ignore into tecnicos values('t2','Técnico 2','600 333 444','tecnico','1234',1)");
  run("insert or ignore into ajustes values('admin_clave','\"0000\"')");

  run("insert into rutas(id,nombre,tecnico_id,fecha_ancla,activa) values('r1','Ruta Utrera','t1',?,1)", hoy);
  run("insert into rutas(id,nombre,tecnico_id,fecha_ancla,activa) values('r2','Ruta Dos Hermanas','t2',?,1)", hoy);
  run("insert into rutas(id,nombre,tecnico_id,fecha_ancla,activa) values('r3','Ruta Sevilla Centro','t1',?,1)", addDays(hoy, 1));

  const cli = [
    ["Clínica Dental Sonrisa", "Clínica dental", "Av. Andalucía 14", 48, "domiciliacion", "Azahar", "r1", ["NEBU 1.5", "BACTERIOSTATICO 1"]],
    ["Bar El Rincón", "Bar", "C/ Nueva 3", 32, "efectivo", "Canela", "r1", ["HIDRO 1"]],
    ["Boutique Alma", "Boutique", "C/ Mayor 22", 40, "efectivo", "Mango", "r1", ["NEBU 1"]],
    ["Papelería Luna", "Papelería", "Pza. España 5", 28, "domiciliacion", "Infantil", "r1", ["BACTERIOSTATICO 1"]],
    ["Gimnasio Pulse", "Gimnasio", "Pol. Ind. 8", 55, "efectivo", "Skull", "r1", ["NEBU 2", "NEBU 2"]],
    ["Estética Belle", "Estética", "C/ Sol 9", 45, "domiciliacion", "Azahar", "r1", ["NEBU 1.5"]],
    ["Despacho Ruiz & Co", "Despacho", "Av. Constitución 40", 38, "domiciliacion", "Canela", "r1", ["NEBU 2"]],
    ["Óptica Vega", "Óptica", "C/ Ancha 12", 30, "efectivo", "Mango", "r2", ["NEBU 1"]],
    ["Restaurante Sabores", "Restaurante", "C/ Real 55", 60, "efectivo", "Canela", "r2", ["NEBU 5"]],
    ["Peluquería Estilo", "Peluquería", "C/ Larga 7", 35, "domiciliacion", "Azahar", "r2", ["NEBU 1.5"]],
    ["Tienda Moda Viva", "Ropa", "C.C. Local 21", 42, "efectivo", "Infantil", "r2", ["NEBU 2"]],
    ["Farmacia Central", "Farmacia", "Pza. Mayor 1", 33, "domiciliacion", "Skull", "r3", ["BACTERIOSTATICO 1"]],
    ["Café Aroma", "Cafetería", "C/ Sierpes 30", 36, "efectivo", "Canela", "r3", ["NEBU 1"]],
    ["Joyería Oro", "Joyería", "C/ Tetuán 8", 50, "domiciliacion", "Mango", "r3", ["NEBU 5"]],
  ];
  cli.forEach(c => {
    const id = uid();
    run("insert into clientes(id,negocio,sector,direccion,importe,forma_habitual,aroma,ruta_id) values(?,?,?,?,?,?,?,?)",
      id, c[0], c[1], c[2], c[3], c[4], c[5], c[6]);
    c[7].forEach(dt => run("insert into cliente_dispositivos values(?,?,?,1)", uid(), id, dt));
  });

  // jornada de ayer cerrada en r1 (5 realizadas, 2 pendientes) + tarea de verificación
  const jid = uid();
  run("insert into jornadas values(?,?,?,?,1)", jid, ayer, "r1", "t1");
  const r1 = db.prepare("select id,importe,forma_habitual from clientes where ruta_id='r1'").all();
  r1.forEach((c, i) => {
    const estado = i === 5 ? "cerrado" : i === 6 ? "ausente" : "realizada";
    const done = estado === "realizada";
    run("insert into visitas(id,jornada_id,cliente_id,orden,estado,servicio_ok,cobro_importe,cobro_forma) values(?,?,?,?,?,?,?,?)",
      uid(), jid, c.id, i, estado, done ? 1 : 0, done ? c.importe : null, done ? c.forma_habitual : null);
  });
  run("insert into tareas(id,tipo,estado,fecha,ruta_id,tecnico_id,datos) values(?,?,?,?,?,?,?)",
    uid(), "cierre", "pendiente", ayer, "r1", "t1",
    JSON.stringify({ realizadas: 5, cobradoEf: 127, cobradoBanco: 76, gastos: 0, aEntregar: 127, pendientes: ["Estética Belle", "Despacho Ruiz & Co"] }));

  console.log("✔ Base de datos sembrada con datos demo");
}

// ---------------------------------------------------------------------------
// LÓGICA DE NEGOCIO (equivalente a las RPC de Postgres)
// ---------------------------------------------------------------------------
function disp(id) { return db.prepare("select * from dispositivos_tipo where id=?").get(id) || { unidad: "ml", cantidad: 200, bacterio: 0 }; }

// genera (o devuelve) la jornada de una ruta/fecha, arrastrando pendientes
function generarJornada(rutaId, fecha) {
  let j = db.prepare("select * from jornadas where ruta_id=? and fecha=?").get(rutaId, fecha);
  if (j) return j.id;
  const ruta = db.prepare("select * from rutas where id=?").get(rutaId);
  const jid = uid();
  db.prepare("insert into jornadas values(?,?,?,?,0)").run(jid, fecha, rutaId, ruta ? ruta.tecnico_id : null);
  let orden = 0;
  // pendientes heredados de la última jornada cerrada de la ruta
  const hered = db.prepare(`
    select distinct v.cliente_id from visitas v join jornadas jj on jj.id=v.jornada_id
    where jj.ruta_id=? and jj.cerrada=1 and jj.fecha<? and v.estado<>'realizada'`).all(rutaId, fecha);
  const heredSet = new Set();
  hered.forEach(h => {
    const c = db.prepare("select * from clientes where id=? and activo=1 and ruta_id=?").get(h.cliente_id, rutaId);
    if (!c) return; heredSet.add(h.cliente_id);
    db.prepare("insert into visitas(id,jornada_id,cliente_id,orden,estado,heredada) values(?,?,?,?,'pendiente',1)").run(uid(), jid, h.cliente_id, orden++);
  });
  // programados
  db.prepare("select id from clientes where ruta_id=? and activo=1").all(rutaId).forEach(c => {
    if (heredSet.has(c.id)) return;
    db.prepare("insert into visitas(id,jornada_id,cliente_id,orden,estado) values(?,?,?,?,'programada')").run(uid(), jid, c.id, orden++);
  });
  return jid;
}

// cierra una jornada: pendientes + crea tarea de verificación para el admin
function cerrarJornada(jid) {
  const j = db.prepare("select * from jornadas where id=?").get(jid); if (!j) return;
  db.prepare("update visitas set estado='pendiente' where jornada_id=? and estado in ('programada','ausente')").run(jid);
  db.prepare("update jornadas set cerrada=1 where id=?").run(jid);
  const agg = db.prepare(`select
      coalesce(sum(case when cobro_forma='efectivo' then cobro_importe else 0 end),0) ef,
      coalesce(sum(case when cobro_forma='domiciliacion' then cobro_importe else 0 end),0) ba,
      sum(case when estado='realizada' then 1 else 0 end) realizadas
    from visitas where jornada_id=?`).get(jid);
  const gastos = db.prepare("select coalesce(sum(importe),0) g from gastos where fecha=? and tecnico_id=?").get(j.fecha, j.tecnico_id).g;
  const pend = db.prepare(`select cl.negocio from visitas v join clientes cl on cl.id=v.cliente_id where v.jornada_id=? and v.estado<>'realizada'`).all(jid).map(r => r.negocio);
  db.prepare("insert into tareas(id,tipo,estado,fecha,ruta_id,tecnico_id,datos) values(?,?,?,?,?,?,?)").run(
    uid(), "cierre", "pendiente", j.fecha, j.ruta_id, j.tecnico_id,
    JSON.stringify({ realizadas: agg.realizadas, cobradoEf: agg.ef, cobradoBanco: agg.ba, gastos, aEntregar: agg.ef - gastos, pendientes: pend }));
}

function jornadaConVisitas(jid) {
  const j = db.prepare("select * from jornadas where id=?").get(jid);
  const visitas = db.prepare("select * from visitas where jornada_id=? order by orden").all(jid).map(v => ({
    ...v, consumo: db.prepare("select * from consumos where visita_id=?").all(v.id)
  }));
  return { ...j, visitas };
}

// ---------------------------------------------------------------------------
// API HTTP (JSON)  ·  auth por token sencillo (demo)
// ---------------------------------------------------------------------------
function auth(req) {
  const h = req.headers.authorization || "";
  const tok = h.replace("Bearer ", "");
  try { return JSON.parse(Buffer.from(tok, "base64").toString()); } catch { return null; }
}

const routes = {
  "POST /api/login": (body) => {
    if (body.rol === "admin") {
      const clave = JSON.parse(db.prepare("select valor from ajustes where clave='admin_clave'").get().valor);
      if (body.clave !== clave) return [401, { error: "Clave incorrecta" }];
      return [200, { token: Buffer.from(JSON.stringify({ rol: "admin" })).toString("base64"), perfil: { rol: "admin" } }];
    }
    const t = db.prepare("select * from tecnicos where id=?").get(body.tecnicoId);
    if (!t || body.clave !== t.clave) return [401, { error: "Clave incorrecta" }];
    return [200, { token: Buffer.from(JSON.stringify({ rol: "tecnico", tecnicoId: t.id })).toString("base64"), perfil: { rol: "tecnico", id: t.id, nombre: t.nombre } }];
  },

  // datos base (catálogos + maestros). Sin auth para el listado de perfiles del login.
  "GET /api/perfiles": () => [200, { tecnicos: db.prepare("select id,nombre from tecnicos where activo=1").all() }],

  "GET /api/bootstrap": (_b, _q, sess) => {
    if (!sess) return [401, { error: "no auth" }];
    const clientes = db.prepare("select * from clientes where activo=1").all().map(c => ({
      ...c, dispositivos: db.prepare("select dispositivo_tipo,cantidad from cliente_dispositivos where cliente_id=?").all(c.id)
    }));
    return [200, {
      tecnicos: db.prepare("select id,nombre,telefono,rol from tecnicos").all(),
      rutas: db.prepare("select * from rutas").all(),
      clientes,
      aromas: db.prepare("select nombre from aromas").all().map(a => a.nombre),
      dispositivos_tipo: db.prepare("select * from dispositivos_tipo").all(),
      tareas: db.prepare("select * from tareas where estado='pendiente'").all().map(t => ({ ...t, datos: JSON.parse(t.datos) })),
      fecha: todayISO(),
    }];
  },

  "GET /api/jornada": (_b, q, sess) => {
    if (!sess) return [401, {}];
    const jid = generarJornada(q.ruta, q.fecha);
    return [200, jornadaConVisitas(jid)];
  },

  "POST /api/visita/:id": (body, _q, sess, id) => {
    if (!sess) return [401, {}];
    const sets = [], vals = [];
    const map = { estado: "estado", orden: "orden", heredada: "heredada", anadida: "anadida", motivoAnadido: "motivo_anadido",
      servicioOk: "servicio_ok", cambioAroma: "cambio_aroma", hora: "hora" };
    for (const k in map) if (k in body) { sets.push(`${map[k]}=?`); vals.push(typeof body[k] === "boolean" ? (body[k] ? 1 : 0) : body[k]); }
    if (body.cobro) { sets.push("cobro_importe=?", "cobro_forma=?"); vals.push(body.cobro.importe, body.cobro.forma); }
    if (body.ventaAdic) { sets.push("venta_producto=?", "venta_importe=?"); vals.push(body.ventaAdic.producto, body.ventaAdic.importe); }
    if (body.incidencia) { sets.push("incidencia_tipo=?", "incidencia_nota=?"); vals.push(body.incidencia.tipo, body.incidencia.nota); }
    if (sets.length) { vals.push(id); db.prepare(`update visitas set ${sets.join(",")} where id=?`).run(...vals); }
    // consumo (reemplaza)
    if (Array.isArray(body.consumo)) {
      db.prepare("delete from consumos where visita_id=?").run(id);
      body.consumo.forEach(co => db.prepare("insert into consumos values(?,?,?,?,?,?)").run(uid(), id, co.dispositivo, co.producto, co.unidad, co.cantidad));
    }
    const v = db.prepare("select jornada_id from visitas where id=?").get(id);
    return [200, jornadaConVisitas(v.jornada_id)];
  },

  "POST /api/jornada/:id/cerrar": (_b, _q, sess, id) => {
    if (!sess) return [401, {}];
    cerrarJornada(id);
    return [200, { ok: true }];
  },

  "POST /api/cliente": (body, _q, sess) => {
    if (!sess) return [401, {}];
    let id = body.id;
    if (id && db.prepare("select 1 from clientes where id=?").get(id)) {
      db.prepare("update clientes set negocio=?,sector=?,direccion=?,importe=?,forma_habitual=?,aroma=?,ruta_id=? where id=?")
        .run(body.negocio, body.sector, body.direccion, body.importe, body.formaHabitual, body.aroma, body.rutaId, id);
    } else {
      id = uid();
      db.prepare("insert into clientes(id,negocio,sector,direccion,importe,forma_habitual,aroma,ruta_id,contrato_estado) values(?,?,?,?,?,?,?,?, 'nuevo')")
        .run(id, body.negocio, body.sector, body.direccion, body.importe, body.formaHabitual, body.aroma, body.rutaId);
    }
    db.prepare("delete from cliente_dispositivos where cliente_id=?").run(id);
    (body.dispositivos || []).forEach(dt => db.prepare("insert into cliente_dispositivos values(?,?,?,1)").run(uid(), id, dt));
    return [200, { id }];
  },

  "POST /api/gasto": (body, _q, sess) => {
    if (!sess) return [401, {}];
    const id = uid();
    db.prepare("insert into gastos values(?,?,?,?,?,?,?)").run(id, sess.tecnicoId || body.tecnicoId, body.negocio, body.concepto, body.importe, body.fotoUrl || null, body.fecha);
    return [200, { id }];
  },

  "GET /api/tareas": (_b, _q, sess) => {
    if (!sess) return [401, {}];
    return [200, db.prepare("select * from tareas where estado='pendiente'").all().map(t => ({ ...t, datos: JSON.parse(t.datos) }))];
  },

  "POST /api/tarea/:id/resolver": (body, _q, sess, id) => {
    if (!sess || sess.rol !== "admin") return [403, { error: "solo admin" }];
    db.prepare("update tareas set estado='hecha', resultado=? where id=?").run(body.resultado || "ok", id);
    return [200, { ok: true }];
  },

  // ===========================================================================
  // ESTADO COMPLETO (sincronización full-state con el frontend)
  // ===========================================================================
  "GET /api/state": (_b, _q, _sess) => {
    return [200, buildFullState()];
  },

  "POST /api/state": (body, _q, _sess) => {
    saveFullState(body);
    return [200, { ok: true }];
  },
};

// enrutador con soporte para :id
function match(method, path) {
  for (const key in routes) {
    const [m, pat] = key.split(" ");
    if (m !== method) continue;
    const parts = pat.split("/"), segs = path.split("/");
    if (parts.length !== segs.length) continue;
    const params = {}; let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(":")) params[parts[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (parts[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) return { handler: routes[key], params };
  }
  return null;
}

// ---------------------------------------------------------------------------
// FULL-STATE: lee todo SQLite → objeto S del frontend
// ---------------------------------------------------------------------------
function buildFullState() {
  const tecnicos = db.prepare("select * from tecnicos").all().map(t => ({
    id: t.id, nombre: t.nombre, tel: t.telefono, clave: t.clave, rol: t.rol || "tecnico",
    activo: !!t.activo
  }));
  const rutas = db.prepare("select * from rutas").all().map(r => ({
    id: r.id, nombre: r.nombre, tecnicoId: r.tecnico_id, fechaAncla: r.fecha_ancla,
    frecuenciaDias: r.frecuencia_dias || 28, municipio: r.municipio || "", activa: !!r.activa
  }));
  const clientesRaw = db.prepare("select * from clientes where activo=1").all();
  const clientes = clientesRaw.map(c => {
    const disps = db.prepare("select dispositivo_tipo from cliente_dispositivos where cliente_id=?").all(c.id).map(d => d.dispositivo_tipo);
    const obj = {
      id: c.id, negocio: c.negocio, sector: c.sector, direccion: c.direccion,
      cp: c.cp || "", municipio: c.municipio || "", provincia: c.provincia || "",
      lat: c.lat, lng: c.lng, email: c.email || "", telefono: c.telefono || "",
      importe: c.importe || 0, descuentoPct: c.descuento_pct || 0,
      notaTrabajo: !!c.nota_trabajo,
      formaHabitual: c.forma_habitual || "efectivo", aroma: c.aroma || "",
      rutaId: c.ruta_id, activo: true,
      dispositivos: disps.length ? disps : ["NEBU 2"],
      fechaAlta: c.fecha_alta || todayISO(),
      contrato: { estado: c.contrato_estado || "nuevo" }
    };
    if (c.banco_iban) obj.banco = { titular: c.banco_titular || "", iban: c.banco_iban };
    return obj;
  });

  // Jornadas: convertir a mapa {"fecha__rutaId": {visitas: [...]}}
  const jornadas = {};
  db.prepare("select * from jornadas").all().forEach(j => {
    const key = j.fecha + "__" + j.ruta_id;
    const visitas = db.prepare("select * from visitas where jornada_id=? order by orden").all(j.id).map(v => {
      const vis = {
        clienteId: v.cliente_id, estado: v.estado, heredada: !!v.heredada,
        anadida: !!v.anadida, motivoAnadido: v.motivo_anadido,
        orden: v.orden, servicioOk: v.servicio_ok == null ? null : !!v.servicio_ok,
        cobro: v.cobro_importe != null ? { importe: v.cobro_importe, forma: v.cobro_forma } : null,
        ventaAdic: v.venta_producto ? { producto: v.venta_producto, importe: v.venta_importe } : null,
        cambioAroma: v.cambio_aroma,
        incidencia: v.incidencia_tipo ? { tipo: v.incidencia_tipo, nota: v.incidencia_nota || "" } : null,
        hora: v.hora,
        consumo: db.prepare("select * from consumos where visita_id=?").all(v.id).map(co => ({
          dispositivo: co.dispositivo_tipo, producto: co.producto, unidad: co.unidad, cantidad: co.cantidad
        }))
      };
      // si hay JSON de incidencia extendido, úsalo
      if (v.incidencia_json) try { vis.incidencia = JSON.parse(v.incidencia_json); } catch {}
      return vis;
    });
    jornadas[key] = { cerrada: !!j.cerrada, visitas };
  });

  const gastos = db.prepare("select * from gastos").all().map(g => ({
    id: g.id, tecnicoId: g.tecnico_id, rutaId: g.ruta_id || "",
    negocio: g.negocio, concepto: g.concepto, importe: g.importe,
    foto: g.foto_url, fecha: g.fecha, categoria: g.categoria || "",
    proveedorId: g.proveedor_id || "", vehiculoId: g.vehiculo_id || ""
  }));

  const tareas = db.prepare("select * from tareas where estado='pendiente'").all().map(t => {
    let datos = {}; try { datos = JSON.parse(t.datos); } catch {}
    return { id: t.id, tipo: t.tipo, estado: t.estado, fecha: t.fecha, rutaId: t.ruta_id, tecnicoId: t.tecnico_id, datos };
  });

  const aromas = db.prepare("select nombre from aromas").all().map(a => a.nombre);

  const documentos = db.prepare("select * from documentos").all().map(d => {
    const obj = { id: d.id, numero: d.numero, tipo: d.tipo, clienteId: d.cliente_id,
      clienteNombre: d.cliente_nombre, producto: d.producto, importe: d.importe,
      total: d.total, fecha: d.fecha, estado: d.estado || "emitida", cobrado: d.cobrado || 0 };
    if (d.firma) obj.firma = d.firma;
    if (d.adjuntos) try { obj.adjuntos = JSON.parse(d.adjuntos); } catch {}
    return obj;
  });

  const fichajes = db.prepare("select * from fichajes").all().map(f => ({
    id: f.id, tecnicoId: f.tecnico_id, fecha: f.fecha, horaInicio: f.hora_inicio, horaFin: f.hora_fin
  }));

  const proveedores = db.prepare("select * from proveedores").all();
  const vehiculos = db.prepare("select * from vehiculos").all().map(v => ({
    id: v.id, matricula: v.matricula, modelo: v.modelo, tecnicoId: v.tecnico_id,
    itv: v.itv, seguroVence: v.seguro_vence, ultimaRevision: v.ultima_revision
  }));
  const eventos = db.prepare("select * from eventos").all();
  const solicitudes = db.prepare("select * from solicitudes").all().map(s => ({
    id: s.id, tecnicoId: s.tecnico_id, tipo: s.tipo, fechaInicio: s.fecha_inicio,
    fechaFin: s.fecha_fin, nota: s.nota, estado: s.estado, creada: s.creada
  }));

  // Stock de difusores
  const stockDifusores = {};
  db.prepare("select * from stock_difusores").all().forEach(s => { stockDifusores[s.dispositivo_tipo] = s.cantidad; });

  // Dispositivos (catálogo)
  const dispositivos = db.prepare("select * from dispositivos_tipo").all().map(d => ({
    id: d.id, label: d.label, unidad: d.unidad, cantidad: d.cantidad,
    bacterio: !!d.bacterio, precio: d.precio || 0
  }));

  // Numeración
  const numeracion = {};
  db.prepare("select * from numeracion").all().forEach(n => { numeracion[n.tipo] = { prefijo: n.prefijo, siguiente: n.siguiente }; });
  if (!numeracion.factura) numeracion.factura = { prefijo: "FAC-", siguiente: 1 };
  if (!numeracion.presupuesto) numeracion.presupuesto = { prefijo: "PRE-", siguiente: 1 };
  if (!numeracion.albaran) numeracion.albaran = { prefijo: "ALB-", siguiente: 1 };

  // Ajustes (empresa, adminClave, etc.)
  let empresa = null, adminClave = "0000", autoClose = false, ivaPct = 21;
  let aromaCoste = {}, aromaCategoria = {}, aromaProveedor = {}, aromaCompra = {}, formatoVenta = {};
  let sectores = null;
  db.prepare("select * from ajustes").all().forEach(a => {
    try {
      const v = JSON.parse(a.valor);
      if (a.clave === "empresa") empresa = v;
      else if (a.clave === "admin_clave") adminClave = v;
      else if (a.clave === "cierre_automatico") autoClose = v === true || v === "true";
      else if (a.clave === "iva_pct") ivaPct = v;
      else if (a.clave === "aroma_coste") aromaCoste = v;
      else if (a.clave === "aroma_categoria") aromaCategoria = v;
      else if (a.clave === "aroma_proveedor") aromaProveedor = v;
      else if (a.clave === "aroma_compra") aromaCompra = v;
      else if (a.clave === "formato_venta") formatoVenta = v;
      else if (a.clave === "sectores") sectores = v;
    } catch {}
  });

  const reprogram = {};
  db.prepare("select * from reprogramaciones").all().forEach(r => {
    reprogram[r.ruta_id] = reprogram[r.ruta_id] || {};
    reprogram[r.ruta_id][r.fecha_original] = r.fecha_nueva;
  });

  return {
    tecnicos, rutas, clientes, jornadas, gastos, tareas, reprogram,
    fecha: todayISO(), session: null,
    adminClave: adminClave,
    autoClose,
    aromas: aromas.length ? aromas : ["Skull","Canela","Mango","Infantil","Azahar"],
    sectores: sectores || ["Hostelería","Tienda/Comercio","Oficina","Clínica/Sanitario","Peluquería/Estética","Gimnasio/Deporte","Educación","Industria/Almacén","Otros"],
    aromaCoste, aromaCategoria, aromaProveedor, aromaCompra,
    formatoVenta: Object.keys(formatoVenta).length ? formatoVenta : {"Litro nebulización":150,"Bote hidroalcohólico":13,"Bacteriostático":0},
    fichajes, documentos, solicitudes, eventos: eventos.map(e => ({id: e.id, fecha: e.fecha, titulo: e.titulo, nota: e.nota})),
    empresa, proveedores, vehiculos, dispositivos, stockDifusores,
    ivaPct, numeracion
  };
}

// ---------------------------------------------------------------------------
// FULL-STATE: escribe objeto S del frontend → SQLite
// ---------------------------------------------------------------------------
function saveFullState(S) {
  // Uso de transacción para atomicidad
  db.exec("BEGIN");
  try {
    // --- Técnicos ---
    db.exec("DELETE FROM tecnicos");
    const insTec = db.prepare("INSERT INTO tecnicos(id,nombre,telefono,rol,clave,activo) VALUES(?,?,?,?,?,?)");
    (S.tecnicos || []).forEach(t => insTec.run(t.id, t.nombre, t.tel || t.telefono || "", t.rol || "tecnico", t.clave || "1234", t.activo === false ? 0 : 1));

    // --- Rutas ---
    db.exec("DELETE FROM rutas");
    const insRuta = db.prepare("INSERT INTO rutas(id,nombre,tecnico_id,fecha_ancla,frecuencia_dias,municipio,activa) VALUES(?,?,?,?,?,?,?)");
    (S.rutas || []).forEach(r => insRuta.run(r.id, r.nombre, r.tecnicoId, r.fechaAncla, r.frecuenciaDias || 28, r.municipio || "", 1));

    // --- Aromas ---
    db.exec("DELETE FROM aromas");
    const insAroma = db.prepare("INSERT OR IGNORE INTO aromas(nombre) VALUES(?)");
    (S.aromas || []).forEach(a => insAroma.run(a));

    // --- Dispositivos tipo ---
    db.exec("DELETE FROM dispositivos_tipo");
    const insDisp = db.prepare("INSERT INTO dispositivos_tipo(id,label,unidad,cantidad,bacterio,precio) VALUES(?,?,?,?,?,?)");
    (S.dispositivos || []).forEach(d => insDisp.run(d.id, d.label, d.unidad, d.cantidad, d.bacterio ? 1 : 0, d.precio || 0));

    // --- Clientes ---
    db.exec("DELETE FROM cliente_dispositivos");
    db.exec("DELETE FROM clientes");
    const insCli = db.prepare(`INSERT INTO clientes(id,negocio,sector,direccion,cp,municipio,provincia,lat,lng,email,telefono,
      importe,descuento_pct,nota_trabajo,forma_habitual,aroma,ruta_id,activo,contrato_estado,banco_titular,banco_iban,fecha_alta)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insCD = db.prepare("INSERT INTO cliente_dispositivos(id,cliente_id,dispositivo_tipo,cantidad) VALUES(?,?,?,1)");
    (S.clientes || []).forEach(c => {
      insCli.run(c.id, c.negocio, c.sector, c.direccion || "", c.cp || "", c.municipio || "", c.provincia || "",
        c.lat || null, c.lng || null, c.email || "", c.telefono || "",
        c.importe || 0, c.descuentoPct || 0, c.notaTrabajo ? 1 : 0,
        c.formaHabitual || "efectivo", c.aroma || "", c.rutaId || "", c.activo === false ? 0 : 1,
        (c.contrato && c.contrato.estado) || "nuevo",
        (c.banco && c.banco.titular) || null, (c.banco && c.banco.iban) || null,
        c.fechaAlta || todayISO());
      (c.dispositivos || []).forEach(dt => insCD.run(uid(), c.id, dt));
    });

    // --- Jornadas y visitas ---
    db.exec("DELETE FROM consumos");
    db.exec("DELETE FROM visitas");
    db.exec("DELETE FROM jornadas");
    const insJor = db.prepare("INSERT INTO jornadas(id,fecha,ruta_id,tecnico_id,cerrada) VALUES(?,?,?,?,?)");
    const insVis = db.prepare(`INSERT INTO visitas(id,jornada_id,cliente_id,orden,estado,heredada,anadida,motivo_anadido,
      servicio_ok,cambio_aroma,hora,cobro_importe,cobro_forma,venta_producto,venta_importe,incidencia_tipo,incidencia_nota,incidencia_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insCons = db.prepare("INSERT INTO consumos(id,visita_id,dispositivo_tipo,producto,unidad,cantidad) VALUES(?,?,?,?,?,?)");
    for (const [key, j] of Object.entries(S.jornadas || {})) {
      const [fecha, rutaId] = key.split("__");
      if (!fecha || !rutaId) continue;
      const ruta = (S.rutas || []).find(r => r.id === rutaId);
      const jid = uid();
      insJor.run(jid, fecha, rutaId, ruta ? ruta.tecnicoId : null, j.cerrada ? 1 : 0);
      (j.visitas || []).forEach((v, i) => {
        const vid = uid();
        const incJson = v.incidencia && (v.incidencia.estado || v.incidencia.notas) ? JSON.stringify(v.incidencia) : null;
        insVis.run(vid, jid, v.clienteId, v.orden != null ? v.orden : i,
          v.estado || "programada", v.heredada ? 1 : 0, v.anadida ? 1 : 0, v.motivoAnadido || null,
          v.servicioOk == null ? null : (v.servicioOk ? 1 : 0),
          v.cambioAroma || null, v.hora || null,
          v.cobro ? v.cobro.importe : null, v.cobro ? v.cobro.forma : null,
          v.ventaAdic ? v.ventaAdic.producto : null, v.ventaAdic ? v.ventaAdic.importe : null,
          v.incidencia ? v.incidencia.tipo : null, v.incidencia ? v.incidencia.nota : null,
          incJson);
        (v.consumo || []).forEach(co => insCons.run(uid(), vid, co.dispositivo, co.producto, co.unidad, co.cantidad));
      });
    }

    // --- Gastos ---
    db.exec("DELETE FROM gastos");
    const insGas = db.prepare("INSERT INTO gastos(id,tecnico_id,ruta_id,negocio,concepto,importe,foto_url,fecha,categoria,proveedor_id,vehiculo_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
    (S.gastos || []).forEach(g => insGas.run(g.id, g.tecnicoId, g.rutaId || "", g.negocio, g.concepto, g.importe, g.foto || null, g.fecha, g.categoria || "", g.proveedorId || "", g.vehiculoId || ""));

    // --- Tareas ---
    db.exec("DELETE FROM tareas");
    const insTar = db.prepare("INSERT INTO tareas(id,tipo,estado,fecha,ruta_id,tecnico_id,datos) VALUES(?,?,?,?,?,?,?)");
    (S.tareas || []).forEach(t => insTar.run(t.id, t.tipo, t.estado, t.fecha, t.rutaId, t.tecnicoId, JSON.stringify(t.datos || {})));

    // --- Documentos ---
    db.exec("DELETE FROM documentos");
    const insDoc = db.prepare("INSERT INTO documentos(id,numero,tipo,cliente_id,cliente_nombre,producto,importe,total,fecha,estado,cobrado,firma,adjuntos) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
    (S.documentos || []).forEach(d => insDoc.run(d.id, d.numero || "", d.tipo, d.clienteId, d.clienteNombre || "",
      d.producto || "", d.importe, d.total != null ? d.total : d.importe, d.fecha, d.estado || "emitida",
      d.cobrado || 0, d.firma || null, d.adjuntos ? JSON.stringify(d.adjuntos) : null));

    // --- Fichajes ---
    db.exec("DELETE FROM fichajes");
    const insFic = db.prepare("INSERT INTO fichajes(id,tecnico_id,fecha,hora_inicio,hora_fin) VALUES(?,?,?,?,?)");
    (S.fichajes || []).forEach(f => insFic.run(f.id, f.tecnicoId, f.fecha, f.horaInicio, f.horaFin || null));

    // --- Proveedores ---
    db.exec("DELETE FROM proveedores");
    const insProv = db.prepare("INSERT INTO proveedores(id,nombre,cif,telefono,email,categoria) VALUES(?,?,?,?,?,?)");
    (S.proveedores || []).forEach(p => insProv.run(p.id, p.nombre, p.cif || "", p.telefono || "", p.email || "", p.categoria || ""));

    // --- Vehículos ---
    db.exec("DELETE FROM vehiculos");
    const insVeh = db.prepare("INSERT INTO vehiculos(id,matricula,modelo,tecnico_id,itv,seguro_vence,ultima_revision) VALUES(?,?,?,?,?,?,?)");
    (S.vehiculos || []).forEach(v => insVeh.run(v.id, v.matricula, v.modelo, v.tecnicoId, v.itv || null, v.seguroVence || null, v.ultimaRevision || null));

    // --- Eventos ---
    db.exec("DELETE FROM eventos");
    const insEv = db.prepare("INSERT INTO eventos(id,fecha,titulo,nota) VALUES(?,?,?,?)");
    (S.eventos || []).forEach(e => insEv.run(e.id, e.fecha, e.titulo, e.nota || ""));

    // --- Solicitudes ---
    db.exec("DELETE FROM solicitudes");
    const insSol = db.prepare("INSERT INTO solicitudes(id,tecnico_id,tipo,fecha_inicio,fecha_fin,nota,estado,creada) VALUES(?,?,?,?,?,?,?,?)");
    (S.solicitudes || []).forEach(s => insSol.run(s.id, s.tecnicoId, s.tipo, s.fechaInicio, s.fechaFin, s.nota || "", s.estado, s.creada || todayISO()));

    // --- Stock de difusores ---
    db.exec("DELETE FROM stock_difusores");
    const insStock = db.prepare("INSERT OR REPLACE INTO stock_difusores(dispositivo_tipo,cantidad) VALUES(?,?)");
    for (const [dt, qty] of Object.entries(S.stockDifusores || {})) insStock.run(dt, qty);

    // --- Numeración ---
    db.exec("DELETE FROM numeracion");
    const insNum = db.prepare("INSERT INTO numeracion(tipo,prefijo,siguiente) VALUES(?,?,?)");
    for (const [tipo, cfg] of Object.entries(S.numeracion || {})) insNum.run(tipo, cfg.prefijo || "", cfg.siguiente || 1);

    // --- Reprogramaciones ---
    db.exec("DELETE FROM reprogramaciones");
    const insRepr = db.prepare("INSERT INTO reprogramaciones(id,ruta_id,fecha_original,fecha_nueva) VALUES(?,?,?,?)");
    for (const [rutaId, fechas] of Object.entries(S.reprogram || {})) {
      for (const [fo, fn] of Object.entries(fechas)) insRepr.run(uid(), rutaId, fo, fn);
    }

    // --- Ajustes (empresa, claves, config) ---
    const upsert = db.prepare("INSERT OR REPLACE INTO ajustes(clave,valor) VALUES(?,?)");
    if (S.empresa) upsert.run("empresa", JSON.stringify(S.empresa));
    if (S.adminClave != null) upsert.run("admin_clave", JSON.stringify(S.adminClave));
    upsert.run("cierre_automatico", JSON.stringify(!!S.autoClose));
    if (S.ivaPct != null) upsert.run("iva_pct", JSON.stringify(S.ivaPct));
    if (S.aromaCoste && Object.keys(S.aromaCoste).length) upsert.run("aroma_coste", JSON.stringify(S.aromaCoste));
    if (S.aromaCategoria && Object.keys(S.aromaCategoria).length) upsert.run("aroma_categoria", JSON.stringify(S.aromaCategoria));
    if (S.aromaProveedor && Object.keys(S.aromaProveedor).length) upsert.run("aroma_proveedor", JSON.stringify(S.aromaProveedor));
    if (S.aromaCompra && Object.keys(S.aromaCompra).length) upsert.run("aroma_compra", JSON.stringify(S.aromaCompra));
    if (S.formatoVenta && Object.keys(S.formatoVenta).length) upsert.run("formato_venta", JSON.stringify(S.formatoVenta));
    if (S.sectores) upsert.run("sectores", JSON.stringify(S.sectores));

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

migrate();

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

  // ---- API routes ----
  if (url.pathname.startsWith("/api/")) {
    let raw = ""; req.on("data", c => raw += c);
    // Limitar tamaño del body (20 MB para soportar fotos base64 en el estado)
    let size = 0;
    req.on("data", c => { size += c.length; if (size > 20 * 1024 * 1024) { req.destroy(); } });
    req.on("end", () => {
      let body = {}; try { if (raw) body = JSON.parse(raw); } catch {}
      const q = Object.fromEntries(url.searchParams);
      const found = match(req.method, url.pathname);
      if (!found) { res.writeHead(404, { ...cors, "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: "not found" })); }
      try {
        const sess = auth(req);
        const idParam = found.params.id;
        const [status, payload] = found.handler(body, q, sess, idParam);
        res.writeHead(status, { ...cors, "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(payload));
      } catch (e) {
        console.error("API error:", e);
        res.writeHead(500, { ...cors, "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e && e.message || e) }));
      }
    });
    return;
  }

  // ---- Archivos estáticos ----
  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  // Seguridad: evitar path traversal
  filePath = filePath.replace(/\.\.\//g, "");
  const absPath = join(STATIC_DIR, filePath);
  if (!existsSync(absPath)) {
    // SPA fallback: si no existe el archivo, sirve index.html
    const indexPath = join(STATIC_DIR, "index.html");
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      return res.end(content);
    }
    res.writeHead(404); return res.end("Not found");
  }
  try {
    const content = readFileSync(absPath);
    const ext = extname(absPath).toLowerCase();
    const ct = MIME[ext] || "application/octet-stream";
    const cacheHeader = ext === ".html" ? "no-cache" : "public, max-age=86400";
    res.writeHead(200, { "Content-Type": ct, "Cache-Control": cacheHeader });
    res.end(content);
  } catch {
    res.writeHead(500); res.end("Error reading file");
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, "0.0.0.0", () => console.log(`🌿 AMBIÉNTATE backend en puerto ${PORT} (SQLite: backend/ambientate.db)`));
