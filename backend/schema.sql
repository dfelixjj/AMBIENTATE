-- ============================================================================
-- AMBIÉNTATE · Esquema de base de datos (PostgreSQL / Supabase)
-- Deriva del modelo de la app single-file. Pégalo en Supabase → SQL Editor.
-- Convención: snake_case, UUID como PK, timestamptz, RLS activado.
-- ============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- CATÁLOGOS
-- ---------------------------------------------------------------------------

-- Aromas disponibles (el admin los añade/elimina)
create table aromas (
  id     uuid primary key default gen_random_uuid(),
  nombre text not null unique
);

-- Tipos de dispositivo y su consumo por visita
create table dispositivos_tipo (
  id        text primary key,          -- 'NEBU 2', 'HIDRO 1', 'BACTERIOSTATICO 1'...
  label     text not null,             -- 'Nebu 2'
  unidad    text not null check (unidad in ('ml','bote')),
  cantidad  numeric not null,          -- 200 (ml) o 1 (bote)
  bacterio  boolean not null default false
);

-- Ajustes globales de la empresa (clave/valor)
create table ajustes (
  clave text primary key,             -- 'cierre_automatico', 'meses_adelanto'...
  valor jsonb not null
);

-- ---------------------------------------------------------------------------
-- PERSONAS
-- ---------------------------------------------------------------------------

-- Técnicos y administrador. La contraseña la gestiona Supabase Auth (auth.users);
-- aquí solo guardamos el perfil y el rol, enlazado por auth_user_id.
create table tecnicos (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  nombre       text not null,
  telefono     text,
  rol          text not null default 'tecnico' check (rol in ('tecnico','admin')),
  activo       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RUTAS Y CLIENTES
-- ---------------------------------------------------------------------------

create table rutas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  tecnico_id  uuid references tecnicos(id) on delete set null,
  fecha_ancla date,                    -- inicio del ciclo de 28 días
  activa      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table clientes (
  id             uuid primary key default gen_random_uuid(),
  negocio        text not null,
  sector         text,
  direccion      text,
  lat            double precision,     -- para optimización de ruta (futuro)
  lng            double precision,
  importe        numeric not null default 0,   -- cuota mensual del servicio
  forma_habitual text not null default 'efectivo'
                   check (forma_habitual in ('efectivo','domiciliacion','pendiente')),
  aroma          text,                 -- nombre del aroma actual
  ruta_id        uuid references rutas(id) on delete set null,
  activo         boolean not null default true,
  contrato_estado text not null default 'nuevo'
                   check (contrato_estado in ('nuevo','presupuesto','firmado')),
  crm_id         text,                 -- puente con el CRM externo de facturación
  created_at     timestamptz not null default now()
);
create index on clientes (ruta_id);

-- Un cliente puede tener varios dispositivos, incluso repetidos (cantidad)
create table cliente_dispositivos (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references clientes(id) on delete cascade,
  dispositivo_tipo text not null references dispositivos_tipo(id),
  cantidad         int  not null default 1
);
create index on cliente_dispositivos (cliente_id);

-- ---------------------------------------------------------------------------
-- CALENDARIO 28 DÍAS · reprogramaciones puntuales (mover una ocurrencia)
-- ---------------------------------------------------------------------------
create table reprogramaciones (
  id             uuid primary key default gen_random_uuid(),
  ruta_id        uuid not null references rutas(id) on delete cascade,
  fecha_original date not null,
  fecha_nueva    date not null,
  unique (ruta_id, fecha_original)
);

-- ---------------------------------------------------------------------------
-- JORNADAS Y VISITAS  (corazón operativo)
-- ---------------------------------------------------------------------------

create table jornadas (
  id          uuid primary key default gen_random_uuid(),
  fecha       date not null,
  ruta_id     uuid not null references rutas(id) on delete cascade,
  tecnico_id  uuid references tecnicos(id) on delete set null,
  cerrada     boolean not null default false,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz,
  unique (fecha, ruta_id)
);
create index on jornadas (fecha);
create index on jornadas (ruta_id, cerrada);

create table visitas (
  id             uuid primary key default gen_random_uuid(),
  jornada_id     uuid not null references jornadas(id) on delete cascade,
  cliente_id     uuid not null references clientes(id) on delete cascade,
  orden          int not null default 0,
  estado         text not null default 'programada'
                   check (estado in ('programada','pendiente','ausente','cerrado','realizada','incidencia')),
  heredada       boolean not null default false,   -- pendiente de un día anterior
  anadida        boolean not null default false,   -- añadida a mano a la ruta
  motivo_anadido text check (motivo_anadido in ('incidencia','venta') or motivo_anadido is null),
  servicio_ok    boolean,
  cambio_aroma   text,
  hora           timestamptz,
  unique (jornada_id, cliente_id)
);
create index on visitas (jornada_id);
create index on visitas (cliente_id);

-- Cobro de una visita realizada (1:1)
create table cobros (
  id        uuid primary key default gen_random_uuid(),
  visita_id uuid not null unique references visitas(id) on delete cascade,
  importe   numeric not null default 0,
  forma     text not null check (forma in ('efectivo','domiciliacion','pendiente'))
);

create table ventas_adicionales (
  id        uuid primary key default gen_random_uuid(),
  visita_id uuid not null references visitas(id) on delete cascade,
  producto  text,
  importe   numeric not null default 0
);

create table incidencias (
  id        uuid primary key default gen_random_uuid(),
  visita_id uuid not null references visitas(id) on delete cascade,
  tipo      text not null check (tipo in ('averia','bateria','manipulada')),
  nota      text,
  foto_url  text,                      -- Supabase Storage (bucket 'incidencias')
  resuelta  boolean not null default false
);

-- Consumo de producto (una fila por dispositivo de la visita)
create table consumos (
  id               uuid primary key default gen_random_uuid(),
  visita_id        uuid not null references visitas(id) on delete cascade,
  dispositivo_tipo text references dispositivos_tipo(id),
  producto         text not null,      -- nombre del aroma o 'Bacteriostático'
  unidad           text not null check (unidad in ('ml','bote')),
  cantidad         numeric not null
);
create index on consumos (visita_id);

-- ---------------------------------------------------------------------------
-- GASTOS EN EFECTIVO
-- ---------------------------------------------------------------------------
create table gastos (
  id         uuid primary key default gen_random_uuid(),
  tecnico_id uuid references tecnicos(id) on delete set null,
  negocio    text,
  concepto   text,
  importe    numeric not null default 0,
  foto_url   text,                     -- Storage (bucket 'gastos'); NO base64
  fecha      date not null,
  created_at timestamptz not null default now()
);
create index on gastos (fecha);

-- ---------------------------------------------------------------------------
-- TAREAS DEL ADMINISTRADOR (verificar cierres, etc.)
-- ---------------------------------------------------------------------------
create table tareas (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null,            -- 'cierre'...
  estado     text not null default 'pendiente' check (estado in ('pendiente','hecha')),
  fecha      date,
  ruta_id    uuid references rutas(id) on delete set null,
  tecnico_id uuid references tecnicos(id) on delete set null,
  datos      jsonb,                    -- resumen del cierre (importes, pendientes...)
  resultado  text,                     -- 'ok' | 'revisar'
  created_at timestamptz not null default now()
);
create index on tareas (estado);

-- ---------------------------------------------------------------------------
-- DOCUMENTOS (presupuesto / factura) — primer cobro = 3 meses por adelantado
-- ---------------------------------------------------------------------------
create table documentos (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references clientes(id) on delete cascade,
  tipo           text not null check (tipo in ('presupuesto','factura')),
  importe_mensual numeric not null,
  meses_adelanto int not null default 3,
  total          numeric not null,     -- importe_mensual * meses_adelanto
  url            text,                 -- PDF en Storage (bucket 'documentos')
  created_at     timestamptz not null default now()
);

-- ============================================================================
-- SEED DE CATÁLOGOS
-- ============================================================================
insert into aromas (nombre) values ('Skull'),('Canela'),('Mango'),('Infantil'),('Azahar');

insert into dispositivos_tipo (id,label,unidad,cantidad,bacterio) values
  ('HIDRO 1','Hidro 1','bote',1,false),
  ('NEBU 1','Nebu 1','ml',100,false),
  ('NEBU 1.5','Nebu 1,5','ml',150,false),
  ('NEBU 2','Nebu 2','ml',200,false),
  ('NEBU 5','Nebu 5','ml',500,false),
  ('BACTERIOSTATICO 1','Bacteriostático 1','bote',1,true);

insert into ajustes (clave,valor) values
  ('cierre_automatico', 'true'::jsonb),
  ('meses_adelanto', '3'::jsonb);

-- ============================================================================
-- FUNCIONES (RPC) · lógica de negocio atómica en el servidor
-- Se llaman desde el cliente con supabase.rpc('nombre', {...})
-- ============================================================================

-- ¿Es 'admin' el usuario autenticado actual?
create or replace function es_admin() returns boolean language sql stable as $$
  select exists (select 1 from tecnicos where auth_user_id = auth.uid() and rol = 'admin');
$$;

-- id de técnico del usuario autenticado
create or replace function mi_tecnico_id() returns uuid language sql stable as $$
  select id from tecnicos where auth_user_id = auth.uid();
$$;

-- Cerrar jornada: marca cerrada, pasa lo no realizado a 'pendiente',
-- y crea la tarea de verificación para el admin. Todo en una transacción.
create or replace function cerrar_jornada(p_jornada uuid)
returns void language plpgsql security definer as $$
declare
  v_ruta uuid; v_tec uuid; v_fecha date;
  v_ef numeric; v_ba numeric; v_gastos numeric; v_realizadas int;
  v_pend jsonb;
begin
  select ruta_id, tecnico_id, fecha into v_ruta, v_tec, v_fecha
    from jornadas where id = p_jornada;

  update visitas set estado = 'pendiente'
    where jornada_id = p_jornada and estado in ('programada','ausente');

  update jornadas set cerrada = true, closed_at = now() where id = p_jornada;

  select coalesce(sum(case when c.forma='efectivo' then c.importe else 0 end),0),
         coalesce(sum(case when c.forma='domiciliacion' then c.importe else 0 end),0),
         count(*) filter (where v.estado='realizada')
    into v_ef, v_ba, v_realizadas
    from visitas v left join cobros c on c.visita_id = v.id
    where v.jornada_id = p_jornada;

  select coalesce(sum(importe),0) into v_gastos
    from gastos where fecha = v_fecha and tecnico_id = v_tec;

  select coalesce(jsonb_agg(cl.negocio),'[]'::jsonb) into v_pend
    from visitas v join clientes cl on cl.id = v.cliente_id
    where v.jornada_id = p_jornada and v.estado <> 'realizada';

  insert into tareas (tipo,fecha,ruta_id,tecnico_id,datos)
  values ('cierre', v_fecha, v_ruta, v_tec, jsonb_build_object(
    'realizadas', v_realizadas, 'cobradoEf', v_ef, 'cobradoBanco', v_ba,
    'gastos', v_gastos, 'aEntregar', v_ef - v_gastos, 'pendientes', v_pend));
end $$;

-- Genera (o devuelve) la jornada de una ruta en una fecha, arrastrando pendientes
-- de la última jornada cerrada + programados del resto de clientes de la ruta.
create or replace function generar_jornada(p_ruta uuid, p_fecha date)
returns uuid language plpgsql security definer as $$
declare v_jor uuid; v_tec uuid; v_orden int := 0; r record;
begin
  select id into v_jor from jornadas where ruta_id = p_ruta and fecha = p_fecha;
  if v_jor is not null then return v_jor; end if;

  select tecnico_id into v_tec from rutas where id = p_ruta;
  insert into jornadas (fecha, ruta_id, tecnico_id) values (p_fecha, p_ruta, v_tec)
    returning id into v_jor;

  -- pendientes heredados (clientes no realizados en la última jornada cerrada de la ruta)
  for r in
    select distinct v.cliente_id from visitas v
    join jornadas j on j.id = v.jornada_id
    where j.ruta_id = p_ruta and j.cerrada and j.fecha < p_fecha and v.estado <> 'realizada'
  loop
    insert into visitas (jornada_id, cliente_id, orden, estado, heredada)
    values (v_jor, r.cliente_id, v_orden, 'pendiente', true)
    on conflict do nothing;
    v_orden := v_orden + 1;
  end loop;

  -- programados: resto de clientes activos de la ruta
  for r in
    select c.id from clientes c
    where c.ruta_id = p_ruta and c.activo
      and c.id not in (select cliente_id from visitas where jornada_id = v_jor)
  loop
    insert into visitas (jornada_id, cliente_id, orden, estado)
    values (v_jor, r.id, v_orden, 'programada');
    v_orden := v_orden + 1;
  end loop;

  return v_jor;
end $$;

-- ============================================================================
-- RLS · SEGURIDAD A NIVEL DE FILA
-- El técnico solo ve/escribe lo de SUS rutas; el admin ve/escribe todo.
-- (Se muestran las tablas clave; replica el patrón en las demás.)
-- ============================================================================
alter table tecnicos            enable row level security;
alter table rutas               enable row level security;
alter table clientes            enable row level security;
alter table cliente_dispositivos enable row level security;
alter table jornadas            enable row level security;
alter table visitas             enable row level security;
alter table cobros              enable row level security;
alter table ventas_adicionales  enable row level security;
alter table incidencias         enable row level security;
alter table consumos            enable row level security;
alter table gastos              enable row level security;
alter table tareas              enable row level security;
alter table reprogramaciones    enable row level security;
alter table documentos          enable row level security;
alter table aromas              enable row level security;
alter table dispositivos_tipo   enable row level security;
alter table ajustes             enable row level security;

-- Catálogos: lectura para cualquier autenticado; escritura solo admin
create policy cat_read  on aromas            for select using (auth.role() = 'authenticated');
create policy cat_write on aromas            for all    using (es_admin()) with check (es_admin());
create policy dt_read   on dispositivos_tipo for select using (auth.role() = 'authenticated');
create policy dt_write  on dispositivos_tipo for all    using (es_admin()) with check (es_admin());
create policy aj_read   on ajustes           for select using (auth.role() = 'authenticated');
create policy aj_write  on ajustes           for all    using (es_admin()) with check (es_admin());

-- Técnicos: cada uno ve su ficha; admin todo
create policy tec_self  on tecnicos for select using (es_admin() or auth_user_id = auth.uid());
create policy tec_admin on tecnicos for all    using (es_admin()) with check (es_admin());

-- Rutas y clientes: técnico ve las suyas; admin todo. Escritura: admin (y técnico crea cliente).
create policy rutas_read  on rutas    for select using (es_admin() or tecnico_id = mi_tecnico_id());
create policy rutas_admin on rutas    for all    using (es_admin()) with check (es_admin());
create policy cli_read    on clientes for select using (es_admin() or ruta_id in (select id from rutas where tecnico_id = mi_tecnico_id()));
create policy cli_write   on clientes for all    using (es_admin() or ruta_id in (select id from rutas where tecnico_id = mi_tecnico_id()))
                                               with check (es_admin() or ruta_id in (select id from rutas where tecnico_id = mi_tecnico_id()));

-- Jornadas/visitas: técnico solo las de sus rutas; admin todo
create policy jor_rw on jornadas for all
  using (es_admin() or tecnico_id = mi_tecnico_id())
  with check (es_admin() or tecnico_id = mi_tecnico_id());
create policy vis_rw on visitas for all
  using (es_admin() or jornada_id in (select id from jornadas where tecnico_id = mi_tecnico_id()))
  with check (es_admin() or jornada_id in (select id from jornadas where tecnico_id = mi_tecnico_id()));

-- Cobros/ventas/incidencias/consumos: heredan de la visita
create policy cob_rw on cobros for all
  using (es_admin() or visita_id in (select v.id from visitas v join jornadas j on j.id=v.jornada_id where j.tecnico_id = mi_tecnico_id()))
  with check (es_admin() or visita_id in (select v.id from visitas v join jornadas j on j.id=v.jornada_id where j.tecnico_id = mi_tecnico_id()));
-- (repite el mismo patrón para ventas_adicionales, incidencias, consumos)

-- Gastos: cada técnico los suyos; admin todo
create policy gas_rw on gastos for all
  using (es_admin() or tecnico_id = mi_tecnico_id())
  with check (es_admin() or tecnico_id = mi_tecnico_id());

-- Tareas: solo admin
create policy tar_admin on tareas for all using (es_admin()) with check (es_admin());

-- Reprogramaciones y documentos: solo admin
create policy rep_admin on reprogramaciones for all using (es_admin()) with check (es_admin());
create policy doc_admin on documentos       for all using (es_admin()) with check (es_admin());
