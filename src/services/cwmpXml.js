// =============================================================================
// FireISP 5.0 — CWMP XML Parser/Builder (§8.1)
// =============================================================================
// Hand-rolled CWMP/SOAP XML subset. No external XML library.
// Handles: Inform, GetParameterValues/Names/Response, SetParameterValues/Response,
//          Download/Response, TransferComplete, Fault envelopes.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract text content from the FIRST occurrence of a tag.
 * Handles CDATA sections and plain text. Returns null if tag not found.
 */
function extractTag(xml, tag) {
  // Try with namespace prefix first, then without
  const patterns = [
    new RegExp(`<[^>]*:${tag}[^>]*>([\\s\\S]*?)<\\/[^>]*:${tag}>`, 'i'),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'),
  ];
  for (const re of patterns) {
    const m = xml.match(re);
    if (m) {
      let val = m[1].trim();
      // Strip CDATA
      const cdata = val.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
      if (cdata) val = cdata[1];
      return val;
    }
  }
  return null;
}

/**
 * Extract all occurrences of a tag, returning an array of inner content strings.
 */
function extractAllTags(xml, tag) {
  const results = [];
  const re = new RegExp(`<[^>]*:?${tag}[^>]*>([\\s\\S]*?)<\\/[^>]*:?${tag}>`, 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) {
    results.push(m[1].trim());
  }
  return results;
}

/**
 * Escape XML special characters.
 */
function xmlEscape(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Extract the SOAP message ID from the header.
 */
function extractMessageId(xml) {
  return extractTag(xml, 'ID') || `ID-${Date.now()}`;
}

/**
 * Detect the CWMP message type from the SOAP body.
 */
function detectMessageType(xml) {
  const types = [
    'Inform', 'GetParameterValuesResponse', 'SetParameterValuesResponse',
    'GetParameterNamesResponse', 'DownloadResponse', 'TransferCompleteResponse', 'Fault',
  ];
  for (const t of types) {
    // Match with or without namespace prefix
    if (new RegExp(`<[^>]*:?${t}[\\s>]`, 'i').test(xml) || xml.includes(`<${t}`)) {
      return t;
    }
  }
  return 'Unknown';
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseInform(xml) {
  // DeviceId
  const devIdBlock = extractTag(xml, 'DeviceId') || '';
  const deviceId = {
    manufacturer: extractTag(devIdBlock, 'Manufacturer') || extractTag(xml, 'Manufacturer') || '',
    oui: extractTag(devIdBlock, 'OUI') || extractTag(xml, 'OUI') || '',
    productClass: extractTag(devIdBlock, 'ProductClass') || extractTag(xml, 'ProductClass') || '',
    serialNumber: extractTag(devIdBlock, 'SerialNumber') || extractTag(xml, 'SerialNumber') || '',
    hwVersion: extractTag(xml, 'HardwareVersion') || '',
    swVersion: extractTag(xml, 'SoftwareVersion') || '',
  };

  // Events
  const events = [];
  const eventBlocks = extractAllTags(xml, 'EventStruct');
  for (const block of eventBlocks) {
    events.push({
      code: extractTag(block, 'EventCode') || '',
      commandKey: extractTag(block, 'CommandKey') || '',
    });
  }

  // Parameters from ParameterList
  const parameters = [];
  const paramBlocks = extractAllTags(xml, 'ParameterValueStruct');
  for (const block of paramBlocks) {
    parameters.push({
      name: extractTag(block, 'Name') || '',
      value: extractTag(block, 'Value') || '',
    });
  }

  return { deviceId, events, parameters };
}

function parseGetParameterValuesResponse(xml) {
  const parameterList = [];
  const blocks = extractAllTags(xml, 'ParameterValueStruct');
  for (const block of blocks) {
    parameterList.push({
      name: extractTag(block, 'Name') || '',
      value: extractTag(block, 'Value') || '',
    });
  }
  return { parameterList };
}

function parseSetParameterValuesResponse(xml) {
  const statusStr = extractTag(xml, 'Status') || '0';
  return { status: parseInt(statusStr, 10) || 0 };
}

function parseGetParameterNamesResponse(xml) {
  const parameterList = [];
  const blocks = extractAllTags(xml, 'ParameterInfoStruct');
  for (const block of blocks) {
    parameterList.push({
      name: extractTag(block, 'Name') || '',
      writable: extractTag(block, 'Writable') === '1' || extractTag(block, 'Writable') === 'true',
    });
  }
  return { parameterList };
}

function parseFault(xml) {
  // Extract the CWMP <Fault> element inside <detail>, avoiding the outer SOAP <faultcode>
  const detailMatch = xml.match(/<detail>([\s\S]*?)<\/detail>/i);
  const inner = detailMatch ? detailMatch[1] : xml;
  return {
    faultCode: extractTag(inner, 'FaultCode') || '',
    faultString: extractTag(inner, 'FaultString') || '',
  };
}

// ---------------------------------------------------------------------------
// Public: parseCwmpEnvelope
// ---------------------------------------------------------------------------

/**
 * Parse a CWMP SOAP envelope string.
 * @param {string} xmlString
 * @returns {{ messageType: string, id: string, payload: object }}
 */
function parseCwmpEnvelope(xmlString) {
  const xml = xmlString || '';
  const messageType = detectMessageType(xml);
  const id = extractMessageId(xml);

  let payload;
  switch (messageType) {
    case 'Inform':
      payload = parseInform(xml);
      break;
    case 'GetParameterValuesResponse':
      payload = parseGetParameterValuesResponse(xml);
      break;
    case 'SetParameterValuesResponse':
      payload = parseSetParameterValuesResponse(xml);
      break;
    case 'GetParameterNamesResponse':
      payload = parseGetParameterNamesResponse(xml);
      break;
    case 'Fault':
      payload = parseFault(xml);
      break;
    default:
      payload = {};
  }

  return { messageType, id, payload };
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const SOAP_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:cwmp="urn:dslforum-org:cwmp-1-0"
                  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`;

function wrapEnvelope(messageId, bodyContent) {
  return `${SOAP_HEADER}
  <soapenv:Header>
    <cwmp:ID soapenv:mustUnderstand="1">${xmlEscape(messageId)}</cwmp:ID>
  </soapenv:Header>
  <soapenv:Body>
    ${bodyContent}
  </soapenv:Body>
</soapenv:Envelope>`;
}

function buildInformResponse(messageId) {
  return wrapEnvelope(messageId, `<cwmp:InformResponse>
      <MaxEnvelopes>1</MaxEnvelopes>
    </cwmp:InformResponse>`);
}

function buildGetParameterValues(messageId, params) {
  const names = (params.parameterNames || [])
    .map(n => `      <string>${xmlEscape(n)}</string>`)
    .join('\n');
  return wrapEnvelope(messageId, `<cwmp:GetParameterValues>
      <ParameterNames soapenv:arrayType="xsd:string[${(params.parameterNames || []).length}]">
${names}
      </ParameterNames>
    </cwmp:GetParameterValues>`);
}

function buildSetParameterValues(messageId, params) {
  const items = (params.parameterValueList || [])
    .map(p => `      <ParameterValueStruct>
        <Name>${xmlEscape(p.name)}</Name>
        <Value xsi:type="${xmlEscape(p.type || 'xsd:string')}">${xmlEscape(p.value)}</Value>
      </ParameterValueStruct>`)
    .join('\n');
  const count = (params.parameterValueList || []).length;
  return wrapEnvelope(messageId, `<cwmp:SetParameterValues>
      <ParameterList soapenv:arrayType="cwmp:ParameterValueStruct[${count}]">
${items}
      </ParameterList>
      <ParameterKey></ParameterKey>
    </cwmp:SetParameterValues>`);
}

function buildGetParameterNames(messageId, params) {
  return wrapEnvelope(messageId, `<cwmp:GetParameterNames>
      <ParameterPath>${xmlEscape(params.parameterPath || '')}</ParameterPath>
      <NextLevel>${params.nextLevel ? '1' : '0'}</NextLevel>
    </cwmp:GetParameterNames>`);
}

function buildDownload(messageId, params) {
  return wrapEnvelope(messageId, `<cwmp:Download>
      <CommandKey>${xmlEscape(params.commandKey || '')}</CommandKey>
      <FileType>${xmlEscape(params.fileType || '1 Firmware Upgrade Image')}</FileType>
      <URL>${xmlEscape(params.url || '')}</URL>
      <Username></Username>
      <Password></Password>
      <FileSize>${params.fileSize || 0}</FileSize>
      <TargetFileName></TargetFileName>
      <DelaySeconds>0</DelaySeconds>
      <SuccessURL></SuccessURL>
      <FailureURL></FailureURL>
    </cwmp:Download>`);
}

function buildReboot(messageId) {
  return wrapEnvelope(messageId, `<cwmp:Reboot>
      <CommandKey>reboot</CommandKey>
    </cwmp:Reboot>`);
}

function buildEmpty(messageId) {
  return wrapEnvelope(messageId, '');
}

// ---------------------------------------------------------------------------
// Public: buildCwmpResponse
// ---------------------------------------------------------------------------

/**
 * Build a CWMP SOAP response/request XML string.
 * @param {string} messageId
 * @param {string} type - 'InformResponse'|'GetParameterValues'|'SetParameterValues'|'GetParameterNames'|'Download'|'Reboot'|'Empty'
 * @param {object} [params]
 * @returns {string}
 */
function buildCwmpResponse(messageId, type, params = {}) {
  switch (type) {
    case 'InformResponse':        return buildInformResponse(messageId);
    case 'GetParameterValues':    return buildGetParameterValues(messageId, params);
    case 'SetParameterValues':    return buildSetParameterValues(messageId, params);
    case 'GetParameterNames':     return buildGetParameterNames(messageId, params);
    case 'Download':              return buildDownload(messageId, params);
    case 'Reboot':                return buildReboot(messageId);
    case 'Empty':
    default:                      return buildEmpty(messageId);
  }
}

module.exports = { parseCwmpEnvelope, buildCwmpResponse };
