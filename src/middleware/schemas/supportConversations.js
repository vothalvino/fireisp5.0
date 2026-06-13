'use strict';

const startConversation = {
  clientId: { type: 'integer', required: true },
  channel: { type: 'string', required: false, max: 30 },
  message: { type: 'string', required: true, min: 1, max: 2000 },
};

const sendMessage = {
  content: { type: 'string', required: true, min: 1, max: 2000 },
};

const escalateConversation = {
  reason: { type: 'string', required: false, max: 255 },
};

const updateChannelConfig = {
  isEnabled: { type: 'boolean', required: false },
  availabilityHours: { type: 'object', required: false },
  handoffBehavior: { type: 'string', required: false, max: 50 },
  webhookUrl: { type: 'string', required: false, max: 500 },
  configJson: { type: 'object', required: false },
};

const createKbArticle = {
  title: { type: 'string', required: true, min: 1, max: 500 },
  body: { type: 'string', required: true, min: 1 },
  category: { type: 'string', required: false, max: 100 },
  locale: { type: 'string', required: false, max: 10 },
  tags: { type: 'string', required: false, max: 500 },
  isPublished: { type: 'boolean', required: false },
};

const updateKbArticle = {
  title: { type: 'string', required: false, min: 1, max: 500 },
  body: { type: 'string', required: false, min: 1 },
  category: { type: 'string', required: false, max: 100 },
  locale: { type: 'string', required: false, max: 10 },
  tags: { type: 'string', required: false, max: 500 },
  isPublished: { type: 'boolean', required: false },
};

const kbFeedback = {
  feedback: { type: 'string', required: true, enum: ['helpful', 'wrong', 'partial'] },
  notes: { type: 'string', required: false, max: 500 },
};

const kbSearch = {
  q: { type: 'string', required: true, min: 1, max: 500 },
  locale: { type: 'string', required: false, max: 10 },
  limit: { type: 'integer', required: false },
};

module.exports = {
  startConversation,
  sendMessage,
  escalateConversation,
  updateChannelConfig,
  createKbArticle,
  updateKbArticle,
  kbFeedback,
  kbSearch,
};
