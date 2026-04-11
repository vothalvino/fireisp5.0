// =============================================================================
// FireISP 5.0 — Ticket Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Ticket extends BaseModel {
  static get tableName() { return 'tickets'; }

  static get fillable() {
    return [
      'organization_id', 'client_id', 'contract_id', 'assigned_to',
      'subject', 'description', 'priority', 'category', 'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static async getComments(ticketId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at ASC',
      [ticketId],
    );
    return rows;
  }

  static async addComment(data) {
    const db = require('../config/database');
    const [result] = await db.query(
      `INSERT INTO ticket_comments (ticket_id, user_id, body, is_internal)
       VALUES (?, ?, ?, ?)`,
      [data.ticket_id, data.user_id, data.body, data.is_internal || false],
    );
    const [rows] = await db.query('SELECT * FROM ticket_comments WHERE id = ?', [result.insertId]);
    return rows[0];
  }
}

module.exports = Ticket;
