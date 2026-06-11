// =============================================================================
// FireISP 5.0 — CPE Task Validation Schemas (§8.1)
// =============================================================================

const createCpeTask = {
  task_type: {
    type: 'string',
    required: true,
    enum: [
      'get_parameter_values', 'set_parameter_values', 'get_parameter_names',
      'download', 'reboot', 'factory_reset', 'add_object', 'delete_object',
    ],
  },
  parameters: { type: 'object' },
  priority: { type: 'number', min: 1, max: 10 },
};

module.exports = { createCpeTask };
