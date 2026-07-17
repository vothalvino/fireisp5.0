// =============================================================================
// FireISP 5.0 — line-item pricing resolution (flexible generate paths)
// =============================================================================

const { ValidationError } = require('./errors');

/**
 * Resolve a product/custom line's pricing from a request item, for the
 * flexible /invoices/generate and /quotes/generate paths (they mirror each
 * other). Accepts either `unit_price` (canonical) or the sibling-endpoint
 * shape `amount` (quote items, one-off invoices) — previously a supplied
 * `amount` without `unit_price` was silently ignored and produced a
 * legitimate-looking 0.00 line (request-shape drift, the classic FireISP bug
 * class), and a zero-value line could be created with no signal at all.
 *
 * Rules: `unit_price` wins when both are present, but they must then agree
 * with quantity × unit_price (±1¢ — mirrors POST /invoices/:id/items' guard);
 * `amount` alone derives unit_price = amount ÷ qty (2dp — exact for the
 * qty=1 shape sibling endpoints use); NEITHER present → 422. An EXPLICIT
 * zero unit_price (or amount) stays legal: an intentional free line.
 *
 * Pure request-shape logic — lives here (not billingService) so route test
 * suites that auto-mock billingService still exercise it for real.
 *
 * @param {object} item request line ({ quantity?, unit_price?, amount? })
 * @returns {{qty:number, unitPrice:number, amount:number}}
 * @throws {ValidationError}
 */
function resolveLineItemPricing(item) {
  const qty = Math.max(parseFloat(item.quantity) || 1, 0.01);
  const hasUnitPrice = item.unit_price !== undefined && item.unit_price !== null;
  const hasAmount = item.amount !== undefined && item.amount !== null;
  if (!hasUnitPrice && !hasAmount) {
    throw new ValidationError(
      'unit_price (or amount) is required for product/custom items',
      [{ field: 'unit_price', message: 'Provide unit_price, or amount to derive it' }],
    );
  }
  let unitPrice;
  if (hasUnitPrice) {
    unitPrice = Math.max(parseFloat(item.unit_price) || 0, 0);
    if (hasAmount) {
      const expected = Math.round(qty * unitPrice * 100) / 100;
      const amt = parseFloat(item.amount) || 0;
      if (Math.abs(amt - expected) > 0.01) {
        throw new ValidationError(
          'amount must equal quantity × unit_price',
          [{ field: 'amount', message: `amount ${amt} does not match quantity × unit_price (${expected})` }],
        );
      }
    }
  } else {
    unitPrice = Math.round((Math.max(parseFloat(item.amount) || 0, 0) / qty) * 100) / 100;
  }
  return { qty, unitPrice, amount: Math.round(qty * unitPrice * 100) / 100 };
}

module.exports = { resolveLineItemPricing };
