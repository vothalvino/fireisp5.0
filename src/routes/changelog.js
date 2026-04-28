// =============================================================================
// FireISP 5.0 — Changelog Route (P3.8)
// =============================================================================
// Public endpoint — no authentication required.
// Returns the static changelog JSON sorted newest-first.
// =============================================================================

const { Router } = require('express');
const path = require('path');

const router = Router();
const entries = require(path.join(__dirname, '../data/changelog.json'));
const sorted = [...entries].sort((a, b) => new Date(b.date) - new Date(a.date));

router.get('/', (_req, res) => {
  res.json({ data: sorted });
});

module.exports = router;
