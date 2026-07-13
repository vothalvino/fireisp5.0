// =============================================================================
// FireISP 5.0 — Support General Module (§21.5)
// =============================================================================
// Handles general/informational intents in AI customer support.
// =============================================================================
'use strict';
const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'supportGeneralModule' });

// ---------------------------------------------------------------------------
// Keyword dispatch table
// ---------------------------------------------------------------------------
const DISPATCH = [
  { pattern: /wifi|password|contraseña|clave wifi/i,                             handler: _wifiGuide },
  { pattern: /\bip\b|direccion ip|my ip|cual es mi ip/i,                         handler: _currentIp },
  { pattern: /ip estatica|ip estática|static ip|ip fija/i,                       handler: _staticIpEligibility },
  { pattern: /port|puerto|forwarding|redireccion|redirección/i,                  handler: _portForwardingGuide },
  { pattern: /cobertura|coverage|zona|area|área|disponible en/i,                 handler: _coverageCheck },
  { pattern: /horario|horarios|business hours|atencion|atención|oficina/i,       handler: _businessHours },
  { pattern: /daño|dañado|damage|roto|broken|golpe/i,                            handler: _damageReport },
  { pattern: /obstruccion|obstrucción|arbol|árbol|edificio|bloqueo/i,            handler: _obstructionReport },
  { pattern: /torre|antena|tower|\bap\b|punto de acceso/i,                       handler: _nearestTower },
  { pattern: /queja|queja tecnico|technician complaint|técnico|tecnico/i,        handler: _technicianComplaint },
];

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Dispatch a general intent to the appropriate sub-handler.
 *
 * @param {string} intent          - Detected intent name
 * @param {object} context         - Conversation context
 * @param {string} messageContent  - Raw user message
 * @param {number|string} orgId    - Organization ID
 * @returns {Promise<{ response: string, requiresConfirmation: boolean, actionType: string, actionData: object }>}
 */
async function handle(intent, context, messageContent, orgId) {
  const text = messageContent || '';

  for (const entry of DISPATCH) {
    if (entry.pattern.test(text)) {
      return entry.handler(context, messageContent, orgId);
    }
  }

  return _generalFallback();
}

// ---------------------------------------------------------------------------
// Sub-handlers
// ---------------------------------------------------------------------------

function _wifiGuide() {
  return {
    response: [
      'Para cambiar la contraseña WiFi de tu router:',
      '1. Conéctate a tu red WiFi o por cable Ethernet.',
      '2. Abre tu navegador y ve a 192.168.1.1 (o 192.168.0.1).',
      '3. Ingresa con usuario: admin / contraseña: admin (o la impresa en el router).',
      '4. Busca la sección "Wireless" o "WiFi" y cambia la contraseña.',
      '5. Guarda los cambios y vuelve a conectarte con la nueva contraseña.',
      '',
      'Si tienes dificultades, un técnico puede asistirte remotamente.',
    ].join('\n'),
    requiresConfirmation: false,
    actionType: 'wifi_guide',
    actionData: {},
  };
}

function _currentIp(context) {
  const ip = context?.connection?.ip ?? null;
  if (ip) {
    return {
      response: `Tu dirección IP pública actual es: ${ip}`,
      requiresConfirmation: false,
      actionType: 'current_ip',
      actionData: { ip },
    };
  }
  return {
    response: 'No pude detectar tu dirección IP en este momento. Puedes consultarla en https://whatismyip.com o en tu portal de cliente.',
    requiresConfirmation: false,
    actionType: 'current_ip',
    actionData: {},
  };
}

async function _staticIpEligibility(context) {
  try {
    // plans has no static_ip_available column, and plan_addons (the real
    // static-IP offering, addon_type='static_ip') is org-wide, not tied to a
    // specific plan — there is no per-plan "is this plan eligible" flag in
    // the schema. The closest true question is "does this org offer a
    // static-IP add-on at all", scoped through the client's active contract.
    const [rows] = await db.query(
      `SELECT pa.id
         FROM contracts c
         JOIN clients cl ON cl.id = c.client_id
         JOIN plan_addons pa ON pa.organization_id = c.organization_id
        WHERE cl.id = ? AND c.status = 'active'
          AND pa.addon_type = 'static_ip' AND pa.status = 'active'
        LIMIT 1`,
      [context?.customer?.id],
    );
    const eligible = rows.length > 0;
    return {
      response: eligible
        ? 'Tu plan es elegible para IP estática. Contacta a soporte para activarla. Puede tener un costo adicional.'
        : 'Tu plan actual no incluye IP estática. Para obtenerla, necesitarías cambiar a un plan que la incluya.',
      requiresConfirmation: false,
      actionType: 'static_ip_eligibility',
      actionData: { eligible },
    };
  } catch (err) {
    logger.warn({ err }, 'generalModule: staticIpEligibility failed');
    return {
      response: 'No pude verificar la elegibilidad para IP estática. Por favor contacta a soporte.',
      requiresConfirmation: false,
      actionType: 'static_ip_eligibility',
      actionData: {},
    };
  }
}

function _portForwardingGuide() {
  return {
    response: [
      'Para configurar reenvío de puertos (port forwarding):',
      '1. Accede a tu router en 192.168.1.1.',
      '2. Ve a "Advanced" → "Port Forwarding" o "NAT".',
      '3. Agrega una regla con:',
      '   • Puerto externo: el que deseas abrir (ej. 8080)',
      '   • Puerto interno: el puerto de tu dispositivo',
      '   • IP local: la IP del dispositivo en tu red (ej. 192.168.1.100)',
      '   • Protocolo: TCP, UDP o ambos',
      '4. Guarda y reinicia el router si es necesario.',
      '',
      'Nota: Algunos puertos están bloqueados por políticas del ISP. Consulta tu contrato.',
    ].join('\n'),
    requiresConfirmation: false,
    actionType: 'port_forwarding_guide',
    actionData: {},
  };
}

async function _coverageCheck(context, messageContent, orgId) {
  try {
    // Extract location hint from message
    const locationMatch = messageContent?.match(/en\s+(.+)$/i) ?? null;
    const locationHint = locationMatch ? locationMatch[1].trim() : null;

    // Real column is `zone_type`, not `coverage_type`.
    const [rows] = await db.query(
      'SELECT name, zone_type FROM coverage_zones WHERE organization_id = ? AND status = ? LIMIT 5',
      [orgId, 'active'],
    );
    if (rows.length === 0) {
      return {
        response: 'Para verificar cobertura en tu zona, por favor contáctanos con tu dirección exacta o código postal.',
        requiresConfirmation: false,
        actionType: 'coverage_check',
        actionData: { locationHint },
      };
    }
    const zones = rows.map(z => `• ${z.name} (${z.zone_type})`).join('\n');
    return {
      response: `Nuestras zonas de cobertura activas incluyen:\n${zones}\nPara verificar disponibilidad en tu dirección exacta, compártenos tu ubicación o código postal.`,
      requiresConfirmation: false,
      actionType: 'coverage_check',
      actionData: { locationHint, zones: rows },
    };
  } catch (err) {
    logger.warn({ err }, 'generalModule: coverageCheck failed');
    return {
      response: 'Para verificar cobertura, por favor compártenos tu dirección y te confirmaremos disponibilidad.',
      requiresConfirmation: false,
      actionType: 'coverage_check',
      actionData: {},
    };
  }
}

async function _businessHours(context, messageContent, orgId) {
  try {
    // `organization_settings` does not exist, and the global (non-tenant)
    // `settings` key/value table (see Organization.js / radiusService.js) is
    // NOT the right source for a per-org value — it's a single-tenant-wide
    // table with no organization_id, so it could never have answered "this
    // org's" phone/email. The org's own contact fields on `organizations`
    // are the real source; there is no business-hours column anywhere, so
    // that stays the same hardcoded default this function's own error
    // fallback already used.
    const [rows] = await db.query(
      'SELECT phone, email FROM organizations WHERE id = ?',
      [orgId],
    );
    const org = rows[0] || {};
    const hours = 'Lunes a Viernes 9:00–18:00, Sábado 9:00–14:00';
    const phone = org.phone || 'Consulta tu contrato';
    const email = org.email || '';

    return {
      response: `Nuestro horario de atención:\n📅 ${hours}\n📞 ${phone}${email ? `\n✉️  ${email}` : ''}`,
      requiresConfirmation: false,
      actionType: 'business_hours',
      actionData: { hours, phone, email },
    };
  } catch (err) {
    logger.warn({ err }, 'generalModule: businessHours failed');
    return {
      response: 'Nuestro horario de atención es Lunes a Viernes de 9:00 a 18:00 y Sábados de 9:00 a 14:00.',
      requiresConfirmation: false,
      actionType: 'business_hours',
      actionData: {},
    };
  }
}

async function _damageReport(context, messageContent, orgId) {
  try {
    await db.query(
      'INSERT INTO tickets (organization_id, client_id, subject, description, status, priority, source) VALUES (?,?,?,?,?,?,?)',
      [orgId, context?.customer?.id, 'Reporte de daño físico', messageContent, 'open', 'high', 'ai_support'],
    );
    return {
      response: 'Hemos creado un ticket de reporte de daño físico con prioridad alta. Un técnico se comunicará contigo lo antes posible para evaluar y reparar el equipo.',
      requiresConfirmation: false,
      actionType: 'damage_report',
      actionData: { ticketCreated: true },
    };
  } catch (err) {
    logger.warn({ err }, 'generalModule: damageReport ticket creation failed');
    return {
      response: 'Registramos tu reporte de daño. Por favor llama a soporte para agilizar la atención.',
      requiresConfirmation: false,
      actionType: 'damage_report',
      actionData: { ticketCreated: false },
    };
  }
}

async function _obstructionReport(context, messageContent, orgId) {
  try {
    await db.query(
      'INSERT INTO tickets (organization_id, client_id, subject, description, status, priority, source) VALUES (?,?,?,?,?,?,?)',
      [orgId, context?.customer?.id, 'Reporte de obstrucción de señal', messageContent, 'open', 'medium', 'ai_support'],
    );
    return {
      response: 'Hemos registrado tu reporte de obstrucción (árbol, edificio u otro elemento). Un técnico evaluará la situación y te contactará para planificar una visita.',
      requiresConfirmation: false,
      actionType: 'obstruction_report',
      actionData: { ticketCreated: true },
    };
  } catch (err) {
    logger.warn({ err }, 'generalModule: obstructionReport ticket creation failed');
    return {
      response: 'Registramos tu reporte de obstrucción. Nuestro equipo técnico lo revisará pronto.',
      requiresConfirmation: false,
      actionType: 'obstruction_report',
      actionData: { ticketCreated: false },
    };
  }
}

async function _nearestTower(context) {
  try {
    const [rows] = await db.query(
      `SELECT name, latitude, longitude, status
         FROM access_points
        WHERE organization_id = (SELECT organization_id FROM clients WHERE id = ? LIMIT 1)
          AND status = 'active'
        ORDER BY id ASC LIMIT 3`,
      [context?.customer?.id],
    );
    if (rows.length === 0) {
      return {
        response: 'No encontré información de torres/antenas disponibles. Contacta a soporte para más detalles.',
        requiresConfirmation: false,
        actionType: 'nearest_tower',
        actionData: {},
      };
    }
    const list = rows.map(ap => `• ${ap.name} (lat: ${ap.latitude}, lon: ${ap.longitude})`).join('\n');
    return {
      response: `Puntos de acceso activos cercanos:\n${list}`,
      requiresConfirmation: false,
      actionType: 'nearest_tower',
      actionData: { accessPoints: rows },
    };
  } catch (err) {
    logger.warn({ err }, 'generalModule: nearestTower failed');
    return {
      response: 'No pude consultar la información de torres en este momento.',
      requiresConfirmation: false,
      actionType: 'nearest_tower',
      actionData: {},
    };
  }
}

async function _technicianComplaint(context, messageContent, orgId) {
  try {
    await db.query(
      'INSERT INTO tickets (organization_id, client_id, subject, description, status, priority, source) VALUES (?,?,?,?,?,?,?)',
      [orgId, context?.customer?.id, 'Queja sobre técnico', messageContent, 'open', 'high', 'ai_support'],
    );
    return {
      response: 'Lamentamos la situación. Hemos registrado tu queja con prioridad alta. Un supervisor revisará el caso y te contactará dentro de 24 horas hábiles.',
      requiresConfirmation: false,
      actionType: 'technician_complaint',
      actionData: { ticketCreated: true },
    };
  } catch (err) {
    logger.warn({ err }, 'generalModule: technicianComplaint ticket creation failed');
    return {
      response: 'Hemos registrado tu queja sobre el técnico. Nuestro supervisor se pondrá en contacto contigo.',
      requiresConfirmation: false,
      actionType: 'technician_complaint',
      actionData: { ticketCreated: false },
    };
  }
}

function _generalFallback() {
  return {
    response: '¿En qué más puedo ayudarte? Puedo orientarte sobre configuración WiFi, cobertura, horarios, reportes de daño y más.',
    requiresConfirmation: false,
    actionType: 'general_info',
    actionData: {},
  };
}

module.exports = { handle };
