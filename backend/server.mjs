// ============================================================================
// AMBIÉNTATE · Backend local (Node + SQLite integrado, sin dependencias)
// Equivalente en local del backend Supabase (mismo modelo que schema.sql).
// Arranque:  node --experimental-sqlite server.mjs   (Node >= 22)
// Sirve una API JSON en http://localhost:4000 con datos COMPARTIDOS: varios
// navegadores/dispositivos ven y escriben los mismos datos.
// ============================================================================
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(DIR, "ambientate.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

const uid = () => Math.random().toString(36).slice(2, 9);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---------------------------------------------------------------------------
// ESQUEMA (SQLite) + SEED (solo la primera vez)
// ---------------------------------------------------------------------------
function migrate() {
  db.exec(`
  create table if not exists ajustes (clave text primary key, valor text);
  create table if not exists aromas (nombre text primary key);
  create table if not exists dispositivos_tipo (id text primary key, label text, unidad text, cantidad real, bacterio integer);
  create table if not exists tecnicos (id text primary key, nombre text, telefono text, rol text, clave text, activo integer default 1);
  create table if not exists rutas (id text primary key, nombre text, tecnico_id text, fecha_ancla text, activa integer default 1);
  create table if not exists clientes (id text primary key, negocio text, sector text, direccion text, importe real,
      forma_habitual text, aroma text, ruta_id text, activo integer default 1, contrato_estado text default 'nuevo');
  create table if not exists cliente_dispositivos (id text primary key, cliente_id text, dispositivo_tipo text, cantidad integer default 1);
  create table if not exists reprogramaciones (id text primary key, ruta_id text, fecha_original text, fecha_nueva text);
  create table if not exists jornadas (id text primary key, fecha text, ruta_id text, tecnico_id text, cerrada integer default 0, unique(fecha, ruta_id));
  create table if not exists visitas (id text primary key, jornada_id text, cliente_id text, orden integer default 0,
      estado text default 'programada', heredada integer default 0, anadida integer default 0, motivo_anadido text,
      servicio_ok integer, cambio_aroma text, hora text,
      cobro_importe real, cobro_forma text, venta_producto text, venta_importe real, incidencia_tipo text, incidencia_nota text,
      unique(jornada_id, cliente_id));
  create table if not exists consumos (id text primary key, visita_id text, dispositivo_tipo text, producto text, unidad text, cantidad real);
  create table if not exists gastos (id text primary key, tecnico_id text, negocio text, concepto text, importe real, foto_url text, fecha text);
  create table if not exists tareas (id text primary key, tipo text, estado text default 'pendiente', fecha text, ruta_id text, tecnico_id text, datos text, resultado text);
  `);

  const seeded = db.prepare("select count(*) c from tecnicos").get().c;
  if (seeded) return;

  const hoy = todayISO(), ayer = addDays(hoy, -1);
  const run = (sql, ...p) => db.prepare(sql).run(...p);

  run("insert into ajustes values('cierre_automatico','true'),('meses_adelanto','3')");
  ["Skull", "Canela", "Mango", "Infantil", "Azahar"].forEach(a => run("insert into aromas values(?)", a));
  [["HIDRO 1", "Hidro 1", "bote", 1, 0], ["NEBU 1", "Nebu 1", "ml", 100, 0], ["NEBU 1.5", "Nebu 1,5", "ml", 150, 0],
   ["NEBU 2", "Nebu 2", "ml", 200, 0], ["NEBU 5", "Nebu 5", "ml", 500, 0], ["BACTERIOSTATICO 1", "Bacteriostático 1", "bote", 1, 1]]
    .forEach(d => run("insert into dispositivos_tipo values(?,?,?,?,?)", ...d));

  run("insert into tecnicos values('t1','Técnico 1','600 111 222','tecnico','1234',1)");
  run("insert into tecnicos values('t2','Técnico 2','600 333 444','tecnico','1234',1)");
  run("insert into ajustes values('admin_clave','\"0000\"')"); // clave admin (numérica)

  run("insert into rutas values('r1','Ruta Utrera','t1',?,1)", hoy);
  run("insert into rutas values('r2','Ruta Dos Hermanas','t2',?,1)", hoy);
  run("insert into rutas values('r3','Ruta Sevilla Centro','t1',?,1)", addDays(hoy, 1));

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

migrate();

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Content-Type": "application/json; charset=utf-8" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  let raw = ""; req.on("data", c => raw += c);
  req.on("end", () => {
    let body = {}; try { if (raw) body = JSON.parse(raw); } catch {}
    const q = Object.fromEntries(url.searchParams);
    const found = match(req.method, url.pathname);
    if (!found) { res.writeHead(404, cors); return res.end(JSON.stringify({ error: "not found" })); }
    try {
      const sess = auth(req);
      const idParam = found.params.id;
      const [status, payload] = found.handler(body, q, sess, idParam);
      res.writeHead(status, cors); res.end(JSON.stringify(payload));
    } catch (e) {
      res.writeHead(500, cors); res.end(JSON.stringify({ error: String(e && e.message || e) }));
    }
  });
});

const PORT = 4000;
server.listen(PORT, () => console.log(`🌿 AMBIÉNTATE backend en http://localhost:${PORT}  (SQLite: backend/ambientate.db)`));
