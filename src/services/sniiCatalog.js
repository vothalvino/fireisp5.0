// =============================================================================
// FireISP 5.0 — versioned SNII preparation object contract
// =============================================================================
// Exact basenames and wire-header spelling are taken from the historical IFT
// baseline associated with the 2024-02-14 amendment.  In 2026 that public
// package is an archive; current
// templates are shown inside the authenticated CRT Ventanilla.  This adapter is
// bootstrap/reference data only.  A reporting profile must independently pin
// and attest the current Ventanilla versions before preparation can proceed.
// =============================================================================

'use strict';

const CATALOG_VERSION = 'snii-2024-02-14-contract-v1';
const HISTORICAL_TEMPLATE_INDEX_URL = 'https://www.ift.org.mx/industria/plantillas-de-descarga-disponibles-para-snii';
const HISTORICAL_DICTIONARY_INDEX_URL = 'https://www.ift.org.mx/industria/diccionarios-de-datos';
const CURRENT_CRT_PROCEDURE_URL = 'https://portal.crt.gob.mx/docs-bin/informes-difusion/actualizacion-de-la-informacion-al-sistema-nacional-de-informacion-de-infraestructura.pdf';

// Optionality and controlled vocabularies below were transcribed from the
// versioned official data dictionary workbook.  Keep this separate from the
// operational source adapters: a source-system enum must never be treated as
// an official SNII catalog value without an explicit reviewed mapping.
const COMMON_OPTIONAL_HEADERS = Object.freeze(['CLAVE_ENTIDAD', 'CLAVE_MUNICIPIO']);
const CONTRACT_RULES = Object.freeze({
  antena_am: { catalogs: { TIPO_ANTENA: ['Panel', 'Tablero', 'Monopolo', 'Versátil', 'Yagi', 'Otro', 'No aplica'] } },
  antena_fm: { catalogs: { MONTAJE: ['Lateral', 'Otro', 'No aplica'], TIPO_ANTENA: ['Panel', 'Tablero', 'Versátil', 'Yagi', 'Otro', 'No aplica'] } },
  antena_gsm: { catalogs: { TIPO_ANTENA: ['Tarjeta', 'Panel', 'Otro', 'No aplica'] } },
  antena_lte: { catalogs: { TIPO_ANTENA: ['Tarjeta', 'Panel', 'Transmit Diversity', 'SU', 'AAS', 'Otro', 'No aplica'] } },
  antena_tdt: { catalogs: { MONTAJE: ['Lateral', 'Otro', 'No aplica'], TIPO_ANTENA: ['Panel', 'Tablero', 'Versátil', 'Otro', 'No aplica'] } },
  antena_wcdma: { catalogs: { TIPO_ANTENA: ['Panel', 'Tablero', 'Otro', 'No aplica'] } },
  central: {
    catalogs: {
      TIPO_CENTRAL: ['CCA', 'CCE', 'CCU', 'CTI Nacional', 'CTI EE.UU', 'CTI', 'Otro', 'No aplica'],
      INTERCONEXION: ['IP', 'TDM', 'Móvil', 'No', 'Otro', 'No aplica'],
    },
  },
  mgw: { catalogs: { INTERCONEXION: ['Si', 'No', 'Otro', 'No aplica'] } },
  nodob: { catalogs: { TECNOLOGIA_CELULAR: ['HSDPA', 'HSUPA', 'HSPA+', 'Otro', 'No aplica'] } },
  punto_interconexion: {
    optional: ['ESPACIO_COUBICACION'],
    catalogs: {
      ESPACIO_COUBICACION: ['Externa', 'Interna', 'Otro', 'No aplica'],
      TIPO_PUNTO_INTERCONEXION: ['IP', 'TDM', 'Móvil', 'Otro', 'No aplica'],
    },
  },
  transmisor: {
    catalogs: {
      MODO_OPERACION: ['Principal', 'Complementario', 'Auxiliar', 'Emergente', 'Otro', 'No aplica'],
      SISTEMA_HIBRIDO: ['Si', 'No', 'Otro', 'No aplica'],
      TIPO_INSTALACION_SISTEMA_HIBRIDO: ['Líneas separadas', 'Línea común', 'Otro', 'No aplica'],
    },
  },
  sala_transmision: { optional: ['CAPACIDAD_DISPONIBLE_AC', 'ESPACIO_DISPONIBLE_AC'] },
  sitio_transmision: { optional: ['CAPACIDAD_DISPONIBLE_SE', 'UPS', 'SUPERFICIE_DISPONIBLE_TERRENO'] },
  torre: {
    optional: ['ESPACIO_DISPONIBLE'],
    catalogs: {
      TIPO_TORRE: ['Arriostradas', 'Auto soportadas', 'Mástiles', 'Monopolos', 'Otro', 'No aplica'],
      USO_TORRE: ['Sistema radiador', 'Soporte de antenas', 'Otro', 'No aplica'],
      SECCION: ['Tubular', 'Triangular', 'Cuadrada', 'Otro', 'No aplica'],
      SERVICIO: ['Telecomunicaciones', 'Radiodifusión', 'Ambas', 'Otro', 'No aplica'],
    },
  },
  ducto: { optional: ['AREA_DISPONIBLE'] },
  poste: { optional: ['ESPACIO_DISPONIBLE'] },
  pozo: {
    optional: ['ESPACIO_DISPONIBLE'],
    catalogs: { TIPO_POZO: ['En arroyo', 'En banqueta', '2BOQ', '4BOQ', 'Otro', 'No aplica'] },
  },
  cable_fibra_acceso: {
    catalogs: {
      TIPO_DESPLIEGUE: ['Aérea', 'Subterránea', 'Ambos', 'Otro', 'No aplica'],
      TIPO_FIBRA: ['Monomodo', 'Multimodo', 'Otro', 'No aplica'],
    },
  },
  cable_fibra_transporte: {
    catalogs: {
      TIPO_DESPLIEGUE: ['Aérea', 'Subterránea', 'Subterránea y Aérea', 'Submarina', 'Otro', 'No aplica'],
      TIPO_FIBRA: ['Monomodo', 'Multimodo', 'Otro', 'No aplica'],
    },
  },
  troncal_cobre: { catalogs: { TIPO_CENTRAL: ['CCE', 'CTI', 'Otro', 'No aplica'] } },
  sitio_publico: { catalogs: { TIPO_SITIO: ['Hospital', 'Escuela', 'Plaza pública', 'Otro', 'No aplica'] } },
  sitio_privado: {
    optional: ['ASENTAMIENTO', 'LOCALIDAD', 'ESPACIO_DISPONIBLE', 'ALTURA', 'TIPO_ASENTAMIENTO', 'TIPO_SITIO'],
    catalogs: { TIPO_SITIO: ['Terreno', 'Azotea', 'Otro', 'No aplica'] },
  },
});

function object(slug, label, family, geometry, periodicity, aliases, headers) {
  const point = geometry === 'Point';
  const wireHeaders = headers.split(',');
  const rules = CONTRACT_RULES[slug] || {};
  const optional = new Set([...COMMON_OPTIONAL_HEADERS, ...(rules.optional || [])]);
  const catalogValues = Object.fromEntries(
    Object.entries(rules.catalogs || {}).map(([header, values]) => [header, Object.freeze(values)]),
  );
  const fieldConstraints = Object.fromEntries(wireHeaders.map((header) => {
    if (header === 'CLAVE_ENTIDAD' || header === 'CLAVE_MUNICIPIO') {
      return [header, Object.freeze({ type: 'string', max_length: 5 })];
    }
    if (header === 'PATRON_RADIACION') {
      return [header, Object.freeze({ type: 'string', max_length: 1000 })];
    }
    if (point && !['sitio_publico', 'sitio_privado'].includes(slug)
        && (header === 'LATITUD' || header === 'LONGITUD')) {
      return [header, Object.freeze({ type: 'float' })];
    }
    return [header, Object.freeze({ type: 'string', max_length: 50 })];
  }));
  return Object.freeze({
    slug,
    label,
    family,
    geometry,
    periodicity,
    aliases: Object.freeze(aliases),
    official_template_filename: `${slug}.${point ? 'json' : 'kml'}`,
    official_filenames: Object.freeze(point
      ? { json: `${slug}.json`, xlsx: `${slug}.xlsx`, csv: `${slug}.csv`, xml: `${slug}.xml` }
      : { kml: `${slug}.kml`, kmz: `${slug}.kmz` }),
    preparation_filename: `${slug}.${point ? 'csv' : 'kml'}`,
    official_formats: Object.freeze(point ? ['json', 'xlsx', 'csv', 'xml'] : ['kml', 'kmz']),
    generated_format: point ? 'csv' : 'kml',
    wire_headers: Object.freeze(wireHeaders),
    required_headers: Object.freeze(wireHeaders.filter(header => !optional.has(header))),
    catalog_values: Object.freeze(catalogValues),
    field_constraints: Object.freeze(fieldConstraints),
    validation_supported: periodicity !== 'event_driven',
    preparation_supported: periodicity !== 'event_driven',
  });
}

const ELEMENT_TYPES = Object.freeze([
  object('antena_am', 'Antena AM', 'active', 'Point', 'annual', ['am_antenna'], 'CODIGO_IDENTIFICADOR,CODIGO_TORRE,CODIGO_SITIO,MARCA,MODELO,TIPO_ANTENA,PRA,ALTURA,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('antena_fm', 'Antena FM', 'active', 'Point', 'annual', ['fm_antenna'], 'CODIGO_IDENTIFICADOR,CODIGO_TORRE,CODIGO_SITIO,MARCA,MODELO,MONTAJE,TIPO_ANTENA,PRA,ALTURA,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('antena_gsm', 'Antena GSM', 'active', 'Point', 'annual', ['gsm_antenna'], 'CODIGO_IDENTIFICADOR,CODIGO_TORRE,CODIGO_CENTRAL,CODIGO_SITIO,MARCA,MODELO,ALTURA,PATRON_RADIACION,PIRE,GANANCIA,TIPO_ANTENA,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('antena_lte', 'Antena LTE', 'active', 'Point', 'semiannual', ['lte_antenna'], 'CODIGO_IDENTIFICADOR,CODIGO_TORRE,CODIGO_CENTRAL,CODIGO_SITIO,MARCA,MODELO,ALTURA,PATRON_RADIACION,PIRE,GANANCIA,TIPO_ANTENA,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('antena_microondas', 'Antena Microondas', 'active', 'Point', 'annual', ['microwave_antenna'], 'CODIGO_IDENTIFICADOR,CODIGO_TORRE,CODIGO_CENTRAL,CODIGO_SITIO,MARCA,MODELO,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('antena_tdt', 'Antena TDT', 'active', 'Point', 'annual', ['tdt_antenna'], 'CODIGO_IDENTIFICADOR,CODIGO_TORRE,CODIGO_SITIO,MARCA,MODELO,MONTAJE,TIPO_ANTENA,PRA,ALTURA,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('antena_wcdma', 'Antena WCDMA', 'active', 'Point', 'annual', ['wcdma_antenna'], 'CODIGO_IDENTIFICADOR,CODIGO_TORRE,CODIGO_CENTRAL,CODIGO_SITIO,MARCA,MODELO,ALTURA,PATRON_RADIACION,PIRE,GANANCIA,TIPO_ANTENA,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('central', 'Central', 'active', 'Point', 'annual', ['central_office', 'exchange'], 'CODIGO_IDENTIFICADOR,CODIGO_SITIO,MARCA,MODELO,TIPO_CENTRAL,INTERCONEXION,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('cmts', 'CMTS', 'active', 'Point', 'annual', ['cable_modem_termination_system'], 'CODIGO_IDENTIFICADOR,CODIGO_CENTRAL,CODIGO_SITIO,MARCA,MODELO,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('dslam', 'DSLAM', 'active', 'Point', 'semiannual', ['dsl_access_multiplexer'], 'CODIGO_IDENTIFICADOR,CODIGO_CENTRAL,CODIGO_SITIO,MARCA,MODELO,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('enodeb', 'eNodeB', 'active', 'Point', 'semiannual', ['e_node_b'], 'CODIGO_IDENTIFICADOR,CODIGO_SITIO,MARCA,MODELO,VERSION_LTE,SENSIBILIDAD_RECEPCION,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('mgw', 'MGW', 'active', 'Point', 'semiannual', ['media_gateway'], 'CODIGO_IDENTIFICADOR,CODIGO_CENTRAL,CODIGO_SITIO,MARCA,MODELO,INTERCONEXION,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('nodob', 'Nodo B', 'active', 'Point', 'annual', ['node_b', 'nodo_b'], 'CODIGO_IDENTIFICADOR,CODIGO_SITIO,MARCA,MODELO,TECNOLOGIA_CELULAR,SENSIBILIDAD_RECEPCION,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('olt', 'OLT', 'active', 'Point', 'semiannual', ['optical_line_terminal'], 'CODIGO_IDENTIFICADOR,CODIGO_CENTRAL,CODIGO_SITIO,MARCA,MODELO,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('punto_interconexion', 'Puntos de Interconexión', 'active', 'Point', 'semiannual', ['interconnection_point', 'poi'], 'CODIGO_IDENTIFICADOR,CODIGO_CENTRAL,CODIGO_SITIO,ESPACIO_COUBICACION,CODIGO_ORIGEN,CODIGO_DESTINO,TIPO_PUNTO_INTERCONEXION,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('repetidor', 'Repetidor', 'active', 'Point', 'annual', ['repeater'], 'CODIGO_IDENTIFICADOR,CODIGO_CENTRAL,CODIGO_SITIO,MARCA,MODELO,PIRE,PRA,GANANCIA,FIGURA_RUIDO,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('sector_gsm', 'Sector GSM', 'active', 'Polygon', 'semiannual', ['gsm_sector'], 'CODIGO_IDENTIFICADOR,CODIGO_TORRE,CODIGO_SITIO,VECINOS_INTER_DEFINIDOS,VECINOS_INTRA_DEFINIDOS,BCCH,BSIC,FRECUENCIA_ASCENDENTE,FRECUENCIA_DESCENDENTE,PROPIEDAD,PROPIETARIO,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('sector_lte', 'Sector LTE', 'active', 'Polygon', 'semiannual', ['lte_sector'], 'CODIGO_IDENTIFICADOR,CODIGO_TORRE,CODIGO_SITIO,VECINOS_INTER_DEFINIDOS,VECINOS_INTRA_DEFINIDOS,PCI,FRECUENCIA_ASCENDENTE,FRECUENCIA_DESCENDENTE,FRECUENCIA_CARRIER,PROPIEDAD,PROPIETARIO,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('sector_wcdma', 'Sector WCDMA', 'active', 'Polygon', 'annual', ['wcdma_sector'], 'CODIGO_IDENTIFICADOR,CODIGO_TORRE,CODIGO_SITIO,VECINOS_INTER_DEFINIDOS,VECINOS_INTRA_DEFINIDOS,PSC,FRECUENCIA_ASCENDENTE,FRECUENCIA_DESCENDENTE,PROPIEDAD,PROPIETARIO,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('switch_atm', 'Switch ATM', 'active', 'Point', 'semiannual', ['atm_switch'], 'CODIGO_IDENTIFICADOR,CODIGO_CENTRAL,CODIGO_SITIO,MARCA,MODELO,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('switch_otn', 'Switch OTN', 'active', 'Point', 'semiannual', ['otn_switch'], 'CODIGO_IDENTIFICADOR,CODIGO_CENTRAL,CODIGO_SITIO,MARCA,MODELO,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('transmisor', 'Transmisor', 'active', 'Point', 'annual', ['transmitter'], 'CODIGO_IDENTIFICADOR,CODIGO_CENTRAL,CODIGO_SITIO,MARCA,MODELO,CANAL_VIRTUAL,MODO_OPERACION,SISTEMA_HIBRIDO,TIPO_INSTALACION_SISTEMA_HIBRIDO,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('sala_transmision', 'Sala de Transmisión', 'active', 'Point', 'annual', ['transmission_room'], 'CODIGO_IDENTIFICADOR,CODIGO_SITIO,CAPACIDAD_DISPONIBLE_AC,ESPACIO_DISPONIBLE_AC,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('sitio_transmision', 'Sitio de Transmisión', 'active', 'Point', 'annual', ['transmission_site', 'site'], 'CODIGO_IDENTIFICADOR,CAPACIDAD_DISPONIBLE_SE,UPS,SUPERFICIE_DISPONIBLE_TERRENO,TIPO,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('torre', 'Torres', 'passive', 'Point', 'semiannual', ['tower'], 'CODIGO_IDENTIFICADOR,CODIGO_SITIO,TIPO_TORRE,USO_TORRE,SECCION,ESPACIO_DISPONIBLE,SERVICIO,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('ducto', 'Ductos', 'passive', 'LineString', 'annual', ['duct', 'conduit'], 'CODIGO_IDENTIFICADOR,AREA_TOTAL,AREA_MTTO,AREA_DISPONIBLE,PROPIEDAD,PROPIETARIO,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('poste', 'Postes', 'passive', 'Point', 'annual', ['pole'], 'CODIGO_IDENTIFICADOR,PESO_MAXIMO,ESPACIO_DISPONIBLE,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('pozo', 'Pozos', 'passive', 'Point', 'annual', ['manhole', 'handhole'], 'CODIGO_IDENTIFICADOR,ESPACIO_DISPONIBLE,TIPO_POZO,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('cable_coaxial', 'Cable Coaxial', 'transmission_medium', 'LineString', 'annual', ['coaxial_cable', 'coax'], 'CODIGO_IDENTIFICADOR,ESTANDAR,NODO_ORIGEN,NODO_DESTINO,LONGITUD,PROPIEDAD,PROPIETARIO,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('enlace_microondas', 'Enlace Microondas o VHF', 'transmission_medium', 'LineString', 'annual', ['microwave_link', 'vhf_link'], 'CODIGO_IDENTIFICADOR,BANDA_FRECUENCIAS,CI_SITIOA,CI_SITIOB,PROPIEDAD,PROPIETARIO,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('cable_fibra_acceso', 'Cable de Fibra óptica de la red de acceso', 'transmission_medium', 'LineString', 'annual', ['access_fiber', 'fiber_access'], 'CODIGO_IDENTIFICADOR,CODIGO_CENTRAL,TIPO_DESPLIEGUE,ESTANDAR,TIPO_FIBRA,LONGITUD,PROPIEDAD,PROPIETARIO,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('cable_fibra_transporte', 'Cable de Fibra óptica de la red de transporte', 'transmission_medium', 'LineString', 'annual', ['transport_fiber', 'backbone_fiber'], 'CODIGO_IDENTIFICADOR,NODO_ORIGEN,NODO_DESTINO,TIPO_DESPLIEGUE,ESTANDAR,TIPO_FIBRA,NUMERO_HILOS,LONGITUD,PROPIEDAD,PROPIETARIO,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('troncal_cobre', 'Troncal de Cobre', 'transmission_medium', 'LineString', 'annual', ['copper_trunk'], 'CODIGO_IDENTIFICADOR,TIPO_CENTRAL,NODO_ORIGEN,NODO_DESTINO,NUMERO_PARES,LONGITUD_TRAMO,PROPIEDAD,PROPIETARIO,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('sitio_publico', 'Sitios públicos', 'public_site', 'Point', 'annual', ['public_site'], 'CODIGO_IDENTIFICADOR,CONECTIVIDAD,TASA_TRANSMISION_ASCENDENTE,TASA_TRANSMISION_DESCENDENTE,CORREO_CONTACTO,TELEFONO_CONTACTO,TIPO_SITIO,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('sitio_privado', 'Sitios privados', 'private_site', 'Point', 'voluntary', ['private_site'], 'CODIGO_IDENTIFICADOR,TELEFONO_FIJO,TELEFONO_PRIVADO,CORREO_ELECTRONICO,NOMBRE_VIALIDAD,NUMERO_EXTERIOR,MUNICIPIO,ESTADO,ASENTAMIENTO,LOCALIDAD,ESPACIO_DISPONIBLE,ALTURA,TIPO_ASENTAMIENTO,TIPO_SITIO,PROPIEDAD,PROPIETARIO,LATITUD,LONGITUD,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('derecho_via', 'Derechos de vía', 'right_of_way', 'LineString', 'annual', ['right_of_way', 'row'], 'CODIGO_IDENTIFICADOR,CONCESION,PUNTO_INICIO_TRAMO,PUNTO_FIN_TRAMO,FRANJA_TERRENO,CORREO_CONTACTO,TELEFONO_CONTACTO,PROPIEDAD,PROPIETARIO,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('obra_civil_area', 'Obra Civil Área', 'civil_work', 'Polygon', 'event_driven', ['civil_work_area'], 'DOMICILIO,TIPO_OBRA_CIVIL,FECHA,CORREO_ELECTRONICO,TELEFONO,DATOS_ADICIONALES,OBSERVACIONES,PROPIEDAD,PROPIETARIO,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('obra_civil_lineal', 'Obra Civil Lineal', 'civil_work', 'LineString', 'event_driven', ['civil_work_line'], 'DOMICILIO,TIPO_OBRA_CIVIL,FECHA,CORREO_ELECTRONICO,TELEFONO,DATOS_ADICIONALES,OBSERVACIONES,PROPIEDAD,PROPIETARIO,CLAVE_ENTIDAD,CLAVE_MUNICIPIO'),
  object('obra_civil_puntual', 'Obra Civil Puntual', 'civil_work', 'Point', 'event_driven', ['civil_work_point'], 'DOMICILIO,TIPO_OBRA_CIVIL,FECHA,CORREO_ELECTRONICO,TELEFONO,DATOS_ADICIONALES,OBSERVACIONES,PROPIEDAD,PROPIETARIO,CLAVE_ENTIDAD,CLAVE_MUNICIPIO,LATITUD,LONGITUD'),
]);

const BY_SLUG = new Map(ELEMENT_TYPES.map(item => [item.slug, item]));
const ALIASES = new Map();
for (const item of ELEMENT_TYPES) {
  for (const alias of item.aliases) ALIASES.set(alias, item.slug);
}

function canonicalElementType(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return BY_SLUG.has(normalized) ? normalized : (ALIASES.get(normalized) || null);
}

function getElementType(value) {
  const canonical = canonicalElementType(value);
  return canonical ? BY_SLUG.get(canonical) : null;
}

module.exports = {
  CATALOG_VERSION,
  HISTORICAL_TEMPLATE_INDEX_URL,
  HISTORICAL_DICTIONARY_INDEX_URL,
  CURRENT_CRT_PROCEDURE_URL,
  ELEMENT_TYPES,
  canonicalElementType,
  getElementType,
};
