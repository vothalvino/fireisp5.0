'use strict';

// =============================================================================
// FireISP 5.0 — DHCP Server + Static Reservation Validation Schemas
// =============================================================================

const createDhcpServer = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  server_type: { type: 'string', enum: ['kea', 'mikrotik'] },
  host: { type: 'string', required: true, max: 255 },
  port: { type: 'number', min: 1, max: 65535 },
  api_url: { type: 'string', max: 500 },
  api_token: { type: 'string', max: 1000 },
  status: { type: 'string', enum: ['active', 'inactive'] },
  notes: { type: 'string', max: 5000 },
};

const updateDhcpServer = {
  name: { type: 'string', min: 1, max: 100 },
  server_type: { type: 'string', enum: ['kea', 'mikrotik'] },
  host: { type: 'string', max: 255 },
  port: { type: 'number', min: 1, max: 65535 },
  api_url: { type: 'string', max: 500 },
  api_token: { type: 'string', max: 1000 },
  status: { type: 'string', enum: ['active', 'inactive'] },
  notes: { type: 'string', max: 5000 },
};

const createDhcpReservation = {
  ip_address: { type: 'string', required: true, max: 45 },
  mac_address: { type: 'string', required: true, max: 17 },
  hostname: { type: 'string', max: 255 },
  dhcp_server_id: { type: 'number' },
  pool_id: { type: 'number' },
  client_id: { type: 'number' },
  contract_id: { type: 'number' },
  option82_circuit_id: { type: 'string', max: 255 },
  option82_remote_id: { type: 'string', max: 255 },
  status: { type: 'string', enum: ['active', 'inactive'] },
  notes: { type: 'string', max: 5000 },
};

const updateDhcpReservation = {
  ip_address: { type: 'string', max: 45 },
  mac_address: { type: 'string', max: 17 },
  hostname: { type: 'string', max: 255 },
  dhcp_server_id: { type: 'number' },
  pool_id: { type: 'number' },
  client_id: { type: 'number' },
  contract_id: { type: 'number' },
  option82_circuit_id: { type: 'string', max: 255 },
  option82_remote_id: { type: 'string', max: 255 },
  status: { type: 'string', enum: ['active', 'inactive'] },
  notes: { type: 'string', max: 5000 },
};

module.exports = { createDhcpServer, updateDhcpServer, createDhcpReservation, updateDhcpReservation };
