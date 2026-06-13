// =============================================================================
// FireISP 5.0 — Support Conversations Routes (§21.2 - §21.8)
// =============================================================================
// Mounted at /api/v1/support
//
// Endpoints:
//   POST   /conversations                   start conversation
//   GET    /conversations                   list conversations
//   GET    /conversations/:id               get conversation with messages
//   POST   /conversations/:id/messages      send message
//   POST   /conversations/:id/escalate      manual escalation
//   POST   /conversations/:id/diagnose      run diagnostic
//   DELETE /conversations/:id               close/delete conversation
//   GET    /metrics                         AI support KPI metrics
//   GET    /channels                        list channel configs
//   PUT    /channels/:channel               update channel config
//   GET    /kb                              list KB articles
//   POST   /kb                              create KB article
//   GET    /kb/search                       search KB articles (STATIC before :id)
//   GET    /kb/:id                          get KB article
//   PUT    /kb/:id                          update KB article
//   DELETE /kb/:id                          delete KB article
//   POST   /kb/:id/embed                    trigger embedding
//   POST   /kb/:id/feedback                 submit feedback
// =============================================================================
'use strict';

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const {
  startConversation: startConvSchema,
  sendMessage: sendMsgSchema,
  escalateConversation: escalateSchema,
  updateChannelConfig: updateChannelSchema,
  createKbArticle: createKbSchema,
  updateKbArticle: updateKbSchema,
  kbFeedback: kbFeedbackSchema,
  kbSearch: kbSearchSchema,
} = require('../middleware/schemas/supportConversations');

const supportConversationService = require('../services/supportConversationService');
const kbService = require('../services/kbService');
const diagnosticEngineService = require('../services/diagnosticEngineService');
const aiSupportMetricsService = require('../services/aiSupportMetricsService');
const db = require('../config/database');
const { NotFoundError } = require('../utils/errors');

const router = Router();
router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// Metrics (static — before any param routes)
// ---------------------------------------------------------------------------

// GET /support/metrics
router.get(
  '/metrics',
  requirePermission('support.metrics.view'),
  async (req, res, next) => {
    try {
      const { date_from, date_to } = req.query;
      const data = await aiSupportMetricsService.getMetrics(req.organizationId, date_from, date_to);
      res.json({ data });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Channel configs
// ---------------------------------------------------------------------------

// GET /support/channels
router.get(
  '/channels',
  requirePermission('support.channels.view'),
  async (req, res, next) => {
    try {
      const [rows] = await db.query(
        'SELECT * FROM support_channel_configs WHERE organization_id = ? ORDER BY channel',
        [req.organizationId],
      );
      res.json({ data: rows, total: rows.length });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /support/channels/:channel
router.put(
  '/channels/:channel',
  requirePermission('support.channels.manage'),
  validate(updateChannelSchema),
  async (req, res, next) => {
    try {
      const { channel } = req.params;
      const { isEnabled, availabilityHours, handoffBehavior, webhookUrl, configJson } = req.body;

      await db.query(
        `INSERT INTO support_channel_configs
           (organization_id, channel, is_enabled, availability_hours, handoff_behavior, webhook_url, config_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           is_enabled = COALESCE(VALUES(is_enabled), is_enabled),
           availability_hours = COALESCE(VALUES(availability_hours), availability_hours),
           handoff_behavior = COALESCE(VALUES(handoff_behavior), handoff_behavior),
           webhook_url = COALESCE(VALUES(webhook_url), webhook_url),
           config_json = COALESCE(VALUES(config_json), config_json),
           updated_at = NOW()`,
        [
          req.organizationId,
          channel,
          isEnabled !== undefined ? isEnabled : null,
          availabilityHours !== undefined ? JSON.stringify(availabilityHours) : null,
          handoffBehavior || null,
          webhookUrl || null,
          configJson !== undefined ? JSON.stringify(configJson) : null,
        ],
      );

      const [[row]] = await db.query(
        'SELECT * FROM support_channel_configs WHERE organization_id = ? AND channel = ?',
        [req.organizationId, channel],
      );
      res.json({ data: row });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// KB — static routes before param routes
// ---------------------------------------------------------------------------

// GET /support/kb/search
router.get(
  '/kb/search',
  requirePermission('support.kb.view'),
  validate(kbSearchSchema),
  async (req, res, next) => {
    try {
      const { q, locale, limit = 20 } = req.query;
      const results = await kbService.searchArticles(req.organizationId, q, { locale, limit: Number(limit) });
      res.json({ data: results, total: results.length });
    } catch (err) {
      next(err);
    }
  },
);

// GET /support/kb
router.get(
  '/kb',
  requirePermission('support.kb.view'),
  async (req, res, next) => {
    try {
      const { category, locale, limit = 50, offset = 0 } = req.query;
      const articles = await kbService.listArticles(req.organizationId, { category, locale, limit: Number(limit), offset: Number(offset) });
      res.json({ data: articles, total: articles.length });
    } catch (err) {
      next(err);
    }
  },
);

// POST /support/kb
router.post(
  '/kb',
  requirePermission('support.kb.manage'),
  validate(createKbSchema),
  async (req, res, next) => {
    try {
      const { title, body, category, locale = 'es', tags, isPublished = false } = req.body;
      const article = await kbService.createArticle({
        orgId: req.organizationId,
        title,
        body,
        category: category || null,
        locale,
        tags: tags || null,
        isPublished,
        authorId: req.user?.id || null,
      });
      res.status(201).json({ data: article });
    } catch (err) {
      next(err);
    }
  },
);

// POST /support/kb/:id/embed
router.post(
  '/kb/:id/embed',
  requirePermission('support.kb.manage'),
  async (req, res, next) => {
    try {
      const result = await kbService.embedArticle(req.params.id, req.organizationId);
      res.json({ data: result });
    } catch (err) {
      if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
      next(err);
    }
  },
);

// POST /support/kb/:id/feedback
router.post(
  '/kb/:id/feedback',
  requirePermission('support.kb.feedback'),
  validate(kbFeedbackSchema),
  async (req, res, next) => {
    try {
      const { feedback, notes } = req.body;
      const result = await kbService.recordFeedback({
        articleId: req.params.id,
        orgId: req.organizationId,
        feedback,
        notes: notes || null,
        userId: req.user?.id || null,
      });
      res.json({ data: result });
    } catch (err) {
      if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
      next(err);
    }
  },
);

// GET /support/kb/:id
router.get(
  '/kb/:id',
  requirePermission('support.kb.view'),
  async (req, res, next) => {
    try {
      const article = await kbService.getArticle(req.params.id, req.organizationId);
      if (!article) return res.status(404).json({ error: 'KB article not found' });
      res.json({ data: article });
    } catch (err) {
      next(err);
    }
  },
);

// PUT /support/kb/:id
router.put(
  '/kb/:id',
  requirePermission('support.kb.manage'),
  validate(updateKbSchema),
  async (req, res, next) => {
    try {
      const article = await kbService.updateArticle(req.params.id, req.organizationId, req.body);
      if (!article) return res.status(404).json({ error: 'KB article not found' });
      res.json({ data: article });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /support/kb/:id
router.delete(
  '/kb/:id',
  requirePermission('support.kb.manage'),
  async (req, res, next) => {
    try {
      await kbService.deleteArticle(req.params.id, req.organizationId);
      res.status(204).send();
    } catch (err) {
      if (err instanceof NotFoundError) return res.status(404).json({ error: err.message });
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

// POST /support/conversations
router.post(
  '/conversations',
  requirePermission('support.conversations.create'),
  validate(startConvSchema),
  async (req, res, next) => {
    try {
      const { clientId, channel = 'web', message } = req.body;
      const conversation = await supportConversationService.startConversation({
        orgId: req.organizationId,
        clientId,
        channel,
        message,
      });
      res.status(201).json({ data: conversation });
    } catch (err) {
      next(err);
    }
  },
);

// GET /support/conversations
router.get(
  '/conversations',
  requirePermission('support.conversations.view'),
  async (req, res, next) => {
    try {
      const { status, client_id, limit = 50, offset = 0 } = req.query;
      const conversations = await supportConversationService.listConversations(
        req.organizationId,
        { status, clientId: client_id, limit: Number(limit), offset: Number(offset) },
      );
      res.json({ data: conversations, total: conversations.length });
    } catch (err) {
      next(err);
    }
  },
);

// POST /support/conversations/:id/messages
router.post(
  '/conversations/:id/messages',
  requirePermission('support.conversations.respond'),
  validate(sendMsgSchema),
  async (req, res, next) => {
    try {
      const conv = await supportConversationService.getConversation(req.params.id, req.organizationId);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });

      const updated = await supportConversationService.sendMessage({
        conversationId: req.params.id,
        orgId: req.organizationId,
        content: req.body.content,
        clientId: conv.client_id,
      });
      res.status(201).json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// POST /support/conversations/:id/escalate
router.post(
  '/conversations/:id/escalate',
  requirePermission('support.conversations.escalate'),
  validate(escalateSchema),
  async (req, res, next) => {
    try {
      const conv = await supportConversationService.getConversation(req.params.id, req.organizationId);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });

      const updated = await supportConversationService.escalate({
        conversationId: req.params.id,
        reason: req.body.reason || 'Manual escalation by agent',
        orgId: req.organizationId,
      });
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// POST /support/conversations/:id/diagnose
router.post(
  '/conversations/:id/diagnose',
  requirePermission('support.diagnostics.run'),
  async (req, res, next) => {
    try {
      const conv = await supportConversationService.getConversation(req.params.id, req.organizationId);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });

      const { symptom, accessType } = req.body;
      const result = await diagnosticEngineService.runDiagnostic({
        orgId: req.organizationId,
        clientId: conv.client_id,
        conversationId: Number(req.params.id),
        symptom: symptom || null,
        accessType: accessType || null,
      });
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// GET /support/conversations/:id
router.get(
  '/conversations/:id',
  requirePermission('support.conversations.view'),
  async (req, res, next) => {
    try {
      const conversation = await supportConversationService.getConversation(req.params.id, req.organizationId);
      if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
      res.json({ data: conversation });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /support/conversations/:id
router.delete(
  '/conversations/:id',
  requirePermission('support.conversations.delete'),
  async (req, res, next) => {
    try {
      const conv = await supportConversationService.getConversation(req.params.id, req.organizationId);
      if (!conv) return res.status(404).json({ error: 'Conversation not found' });

      await supportConversationService.closeConversation(req.params.id, req.organizationId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
