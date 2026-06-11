// =============================================================================
// FireISP 5.0 — CPE Diagnostics Tests (§8.3)
// =============================================================================
'use strict';

const { buildCwmpResponse, parseCwmpEnvelope } = require('../src/services/cwmpXml');

// ---------------------------------------------------------------------------
// §8.3: buildCwmpResponse new types
// ---------------------------------------------------------------------------

describe('cwmpXml §8.3 builders', () => {
  test('FactoryReset envelope is valid XML with FactoryReset element', () => {
    const xml = buildCwmpResponse('MSG-FR', 'FactoryReset');
    expect(xml).toContain('cwmp:FactoryReset');
    expect(xml).toContain('MSG-FR');
  });

  test('StartPingDiagnostic produces SetParameterValues for ping params', () => {
    const xml = buildCwmpResponse('MSG-PD', 'StartPingDiagnostic', {
      host: '1.1.1.1',
      numberOfRepetitions: 5,
      timeout: 2000,
    });
    expect(xml).toContain('SetParameterValues');
    expect(xml).toContain('DiagnosticsState');
    expect(xml).toContain('Requested');
    expect(xml).toContain('1.1.1.1');
    expect(xml).toContain('5');
  });

  test('StartTracerouteDiagnostic produces SetParameterValues for traceroute params', () => {
    const xml = buildCwmpResponse('MSG-TR', 'StartTracerouteDiagnostic', {
      host: '8.8.8.8',
      maxHopCount: 20,
    });
    expect(xml).toContain('SetParameterValues');
    expect(xml).toContain('DiagnosticsState');
    expect(xml).toContain('8.8.8.8');
    expect(xml).toContain('20');
  });

  test('GetDiagnosticResults produces GetParameterValues', () => {
    const xml = buildCwmpResponse('MSG-GDR', 'GetDiagnosticResults', {
      paths: [
        'InternetGatewayDevice.IPPingDiagnostics.AverageResponseTime',
        'InternetGatewayDevice.IPPingDiagnostics.SuccessCount',
      ],
    });
    expect(xml).toContain('GetParameterValues');
    expect(xml).toContain('AverageResponseTime');
  });

  test('StartPingDiagnostic uses custom basePath when provided', () => {
    const xml = buildCwmpResponse('MSG-PDC', 'StartPingDiagnostic', {
      host: '192.168.1.1',
      basePath: 'Device.IP.Diagnostics.IPPing.',
    });
    expect(xml).toContain('Device.IP.Diagnostics.IPPing.');
  });
});

// ---------------------------------------------------------------------------
// §8.3: DiagnosticsComplete detection
// ---------------------------------------------------------------------------

const DIAG_COMPLETE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header>
    <cwmp:ID soapenv:mustUnderstand="1">DIAG-001</cwmp:ID>
  </soapenv:Header>
  <soapenv:Body>
    <cwmp:Inform>
      <DeviceId>
        <Manufacturer>TP-Link</Manufacturer>
        <OUI>EC1724</OUI>
        <ProductClass>TD-W8901G</ProductClass>
        <SerialNumber>DIAG12345</SerialNumber>
      </DeviceId>
      <Event soapenv:arrayType="cwmp:EventStruct[1]">
        <EventStruct>
          <EventCode>8 DIAGNOSTICS COMPLETE</EventCode>
          <CommandKey></CommandKey>
        </EventStruct>
      </Event>
      <MaxEnvelopes>1</MaxEnvelopes>
      <ParameterList soapenv:arrayType="cwmp:ParameterValueStruct[2]">
        <ParameterValueStruct>
          <Name>InternetGatewayDevice.IPPingDiagnostics.AverageResponseTime</Name>
          <Value xsi:type="xsd:unsignedInt">23</Value>
        </ParameterValueStruct>
        <ParameterValueStruct>
          <Name>InternetGatewayDevice.IPPingDiagnostics.SuccessCount</Name>
          <Value xsi:type="xsd:unsignedInt">3</Value>
        </ParameterValueStruct>
      </ParameterList>
    </cwmp:Inform>
  </soapenv:Body>
</soapenv:Envelope>`;

describe('parseCwmpEnvelope §8.3 DiagnosticsComplete', () => {
  test('detects DiagnosticsComplete message type', () => {
    const { messageType, payload } = parseCwmpEnvelope(DIAG_COMPLETE_XML);
    expect(messageType).toBe('DiagnosticsComplete');
    // Payload is parsed as Inform
    expect(payload.deviceId.serialNumber).toBe('DIAG12345');
    expect(payload.events[0].code).toBe('8 DIAGNOSTICS COMPLETE');
  });

  test('DiagnosticsComplete payload includes parameter values', () => {
    const { payload } = parseCwmpEnvelope(DIAG_COMPLETE_XML);
    const paramNames = payload.parameters.map(p => p.name);
    expect(paramNames).toContain('InternetGatewayDevice.IPPingDiagnostics.AverageResponseTime');
    expect(payload.parameters.find(p => p.name.endsWith('SuccessCount')).value).toBe('3');
  });
});

// ---------------------------------------------------------------------------
// §8.3: cwmpXml module exports
// ---------------------------------------------------------------------------

describe('cwmpXml module exports §8.3', () => {
  test('exports buildFactoryReset as named export', () => {
    const { buildFactoryReset } = require('../src/services/cwmpXml');
    expect(typeof buildFactoryReset).toBe('function');
    const xml = buildFactoryReset('MSG-TEST');
    expect(xml).toContain('cwmp:FactoryReset');
  });

  test('exports buildStartPingDiagnostic as named export', () => {
    const { buildStartPingDiagnostic } = require('../src/services/cwmpXml');
    expect(typeof buildStartPingDiagnostic).toBe('function');
  });

  test('exports buildStartTracerouteDiagnostic as named export', () => {
    const { buildStartTracerouteDiagnostic } = require('../src/services/cwmpXml');
    expect(typeof buildStartTracerouteDiagnostic).toBe('function');
  });
});
