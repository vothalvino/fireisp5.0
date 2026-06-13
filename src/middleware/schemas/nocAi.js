'use strict';

const explainAlert = {
  alertId: { type: 'integer', required: true },
  providerId: { type: 'integer', required: false },
};

const runbookSuggestion = {
  alertType: { type: 'string', required: true, max: 100 },
  providerId: { type: 'integer', required: false },
};

module.exports = { explainAlert, runbookSuggestion };
