// =============================================================================
// FireISP 5.0 — CWMP XML Parser/Builder Tests
// =============================================================================
'use strict';

const { parseCwmpEnvelope, buildCwmpResponse } = require('../src/services/cwmpXml');

// ---------------------------------------------------------------------------
// Sample CWMP envelopes
// ---------------------------------------------------------------------------

const INFORM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header>
    <cwmp:ID soapenv:mustUnderstand="1">MSG-001</cwmp:ID>
  </soapenv:Header>
  <soapenv:Body>
    <cwmp:Inform>
      <DeviceId>
        <Manufacturer>TP-Link</Manufacturer>
        <OUI>EC1724</OUI>
        <ProductClass>TD-W8901G</ProductClass>
        <SerialNumber>ABC123456789</SerialNumber>
      </DeviceId>
      <Event soapenv:arrayType="cwmp:EventStruct[2]">
        <EventStruct>
          <EventCode>0 BOOTSTRAP</EventCode>
          <CommandKey></CommandKey>
        </EventStruct>
        <EventStruct>
          <EventCode>1 BOOT</EventCode>
          <CommandKey></CommandKey>
        </EventStruct>
      </Event>
      <MaxEnvelopes>1</MaxEnvelopes>
      <CurrentTime>2026-06-11T12:00:00</CurrentTime>
      <RetryCount>0</RetryCount>
      <ParameterList soapenv:arrayType="cwmp:ParameterValueStruct[2]">
        <ParameterValueStruct>
          <Name>Device.DeviceInfo.SoftwareVersion</Name>
          <Value xsi:type="xsd:string">1.0.0</Value>
        </ParameterValueStruct>
        <ParameterValueStruct>
          <Name>Device.DeviceInfo.HardwareVersion</Name>
          <Value xsi:type="xsd:string">v1</Value>
        </ParameterValueStruct>
      </ParameterList>
    </cwmp:Inform>
  </soapenv:Body>
</soapenv:Envelope>`;

const GET_PARAM_VALUES_RESPONSE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header>
    <cwmp:ID soapenv:mustUnderstand="1">MSG-002</cwmp:ID>
  </soapenv:Header>
  <soapenv:Body>
    <cwmp:GetParameterValuesResponse>
      <ParameterList soapenv:arrayType="cwmp:ParameterValueStruct[2]">
        <ParameterValueStruct>
          <Name>Device.WiFi.SSID.1.SSID</Name>
          <Value xsi:type="xsd:string">MyNetwork</Value>
        </ParameterValueStruct>
        <ParameterValueStruct>
          <Name>Device.WAN.IP</Name>
          <Value xsi:type="xsd:string">192.168.1.1</Value>
        </ParameterValueStruct>
      </ParameterList>
    </cwmp:GetParameterValuesResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

const SET_PARAM_VALUES_RESPONSE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:cwmp="urn:dslforum-org:cwmp-1-0">
  <soapenv:Header>
    <cwmp:ID soapenv:mustUnderstand="1">MSG-003</cwmp:ID>
  </soapenv:Header>
  <soapenv:Body>
    <cwmp:SetParameterValuesResponse>
      <Status>0</Status>
    </cwmp:SetParameterValuesResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

const FAULT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Header>
    <cwmp:ID soapenv:mustUnderstand="1">MSG-ERR</cwmp:ID>
  </soapenv:Header>
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>Client</faultcode>
      <faultstring>CWMP fault</faultstring>
      <detail>
        <Fault>
          <FaultCode>9005</FaultCode>
          <FaultString>Invalid Parameter Value</FaultString>
        </Fault>
      </detail>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseCwmpEnvelope', () => {
  test('parses an Inform envelope', () => {
    const result = parseCwmpEnvelope(INFORM_XML);
    expect(result.messageType).toBe('Inform');
    expect(result.id).toBe('MSG-001');
    expect(result.payload.deviceId.manufacturer).toBe('TP-Link');
    expect(result.payload.deviceId.oui).toBe('EC1724');
    expect(result.payload.deviceId.serialNumber).toBe('ABC123456789');
    expect(result.payload.events).toHaveLength(2);
    expect(result.payload.events[0].code).toBe('0 BOOTSTRAP');
    expect(result.payload.parameters).toHaveLength(2);
    expect(result.payload.parameters[0].name).toBe('Device.DeviceInfo.SoftwareVersion');
    expect(result.payload.parameters[0].value).toBe('1.0.0');
  });

  test('parses a GetParameterValuesResponse', () => {
    const result = parseCwmpEnvelope(GET_PARAM_VALUES_RESPONSE_XML);
    expect(result.messageType).toBe('GetParameterValuesResponse');
    expect(result.id).toBe('MSG-002');
    expect(result.payload.parameterList).toHaveLength(2);
    expect(result.payload.parameterList[0].name).toBe('Device.WiFi.SSID.1.SSID');
    expect(result.payload.parameterList[0].value).toBe('MyNetwork');
  });

  test('parses a SetParameterValuesResponse', () => {
    const result = parseCwmpEnvelope(SET_PARAM_VALUES_RESPONSE_XML);
    expect(result.messageType).toBe('SetParameterValuesResponse');
    expect(result.payload.status).toBe(0);
  });

  test('parses a Fault envelope', () => {
    const result = parseCwmpEnvelope(FAULT_XML);
    expect(result.messageType).toBe('Fault');
    expect(result.payload.faultCode).toBe('9005');
    expect(result.payload.faultString).toBe('Invalid Parameter Value');
  });

  test('returns Unknown for unrecognized XML', () => {
    const result = parseCwmpEnvelope('<foo><bar>baz</bar></foo>');
    expect(result.messageType).toBe('Unknown');
  });
});

describe('buildCwmpResponse', () => {
  test('builds an InformResponse', () => {
    const xml = buildCwmpResponse('MSG-001', 'InformResponse');
    expect(xml).toContain('InformResponse');
    expect(xml).toContain('MSG-001');
    expect(xml).toContain('MaxEnvelopes');
  });

  test('builds a GetParameterValues request', () => {
    const xml = buildCwmpResponse('MSG-002', 'GetParameterValues', {
      parameterNames: ['Device.WiFi.SSID.1.SSID', 'Device.WAN.IP'],
    });
    expect(xml).toContain('GetParameterValues');
    expect(xml).toContain('Device.WiFi.SSID.1.SSID');
    expect(xml).toContain('Device.WAN.IP');
    expect(xml).toContain('MSG-002');
  });

  test('builds a SetParameterValues request', () => {
    const xml = buildCwmpResponse('MSG-003', 'SetParameterValues', {
      parameterValueList: [
        { name: 'Device.WiFi.SSID.1.SSID', value: 'NewSSID', type: 'xsd:string' },
      ],
    });
    expect(xml).toContain('SetParameterValues');
    expect(xml).toContain('Device.WiFi.SSID.1.SSID');
    expect(xml).toContain('NewSSID');
    expect(xml).toContain('xsd:string');
  });

  test('builds an Empty response', () => {
    const xml = buildCwmpResponse('MSG-004', 'Empty');
    expect(xml).toContain('MSG-004');
    expect(xml).toContain('Envelope');
  });

  test('builds a Download request', () => {
    const xml = buildCwmpResponse('DL-001', 'Download', {
      commandKey: 'DL-001',
      fileType: '1 Firmware Upgrade Image',
      url: 'http://example.com/firmware.bin',
      fileSize: 1024000,
    });
    expect(xml).toContain('Download');
    expect(xml).toContain('http://example.com/firmware.bin');
    expect(xml).toContain('1024000');
  });
});
