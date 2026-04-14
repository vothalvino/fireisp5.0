// =============================================================================
// FireISP 5.0 — Dashboard Pages
// =============================================================================
// Each page is a function: (container, ...params) => void
// =============================================================================

/* global document, alert, confirm, API, Router */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  if (str == null) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}
const esc = escapeHtml;

function badge(text, type) {
  const map = { active: 'success', paid: 'success', online: 'success', open: 'info',
    overdue: 'danger', suspended: 'danger', offline: 'danger', cancelled: 'muted',
    pending: 'warning', draft: 'muted', closed: 'muted', resolved: 'muted',
    partial: 'warning', in_progress: 'info' };
  const cls = map[(text || '').toLowerCase()] || 'muted';
  return `<span class="badge badge-${cls}">${esc(text)}</span>`;
}

function money(v, cur) {
  const n = Number(v) || 0;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? ' ' + esc(cur) : ''}`;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function loading() { return '<div class="loading"><div class="spinner"></div><p>Loading…</p></div>'; }

function errorState(message) {
  return '<div class="card" style="text-align:center;padding:2rem">' +
    '<h3 style="color:var(--danger,#e74c3c)">⚠ Error</h3>' +
    '<p style="color:#666">' + esc(message || 'Failed to load data. Please try again.') + '</p>' +
    '<button class="btn btn-primary" onclick="Router.navigate(Router.current() || \'dashboard\')">Retry</button>' +
  '</div>';
}

function emptyState(message) {
  return '<div class="card" style="text-align:center;padding:2rem;color:#999">' +
    '<p style="font-size:1.2rem">📭</p>' +
    '<p>' + esc(message || 'No records found.') + '</p>' +
  '</div>';
}

function pagination(page, total, perPage, onPage) {
  const pages = Math.ceil(total / perPage) || 1;
  if (pages <= 1) return '';
  let html = '<div class="pagination">';
  html += `<button class="btn btn-sm btn-secondary" ${page <= 1 ? 'disabled' : ''} data-pg="${page - 1}">‹</button>`;
  html += `<span style="font-size:0.85rem">Page ${page} of ${pages}</span>`;
  html += `<button class="btn btn-sm btn-secondary" ${page >= pages ? 'disabled' : ''} data-pg="${page + 1}">›</button>`;
  html += '</div>';
  return html;
}

function bindPagination(container, callback) {
  container.querySelectorAll('.pagination button:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => callback(parseInt(btn.dataset.pg, 10)));
  });
}

// ---------------------------------------------------------------------------
// Dashboard Page
// ---------------------------------------------------------------------------
async function dashboardPage(container) {
  container.innerHTML = loading();
  try {
    const [summary, revenue, deviceHealth, overdue] = await Promise.all([
      API.get('/dashboard/summary').catch(() => ({ data: {} })),
      API.get('/dashboard/revenue').catch(() => ({ data: {} })),
      API.get('/dashboard/device-health').catch(() => ({ data: {} })),
      API.get('/dashboard/overdue').catch(() => ({ data: [] })),
    ]);

    const s = summary.data || {};
    const r = revenue.data || {};
    const dh = deviceHealth.data || {};
    const od = Array.isArray(overdue.data) ? overdue.data : [];

    container.innerHTML = `
      <div class="stats-grid">
        <div class="card stat-card">
          <div class="stat-value">${esc(s.total_clients ?? '—')}</div>
          <div class="stat-label">Total Clients</div>
        </div>
        <div class="card stat-card">
          <div class="stat-value">${esc(s.active_contracts ?? '—')}</div>
          <div class="stat-label">Active Contracts</div>
        </div>
        <div class="card stat-card">
          <div class="stat-value">${money(r.revenue_this_month)}</div>
          <div class="stat-label">Revenue This Month</div>
        </div>
        <div class="card stat-card">
          <div class="stat-value">${esc(s.open_tickets ?? '—')}</div>
          <div class="stat-label">Open Tickets</div>
        </div>
        <div class="card stat-card">
          <div class="stat-value">${esc(dh.online ?? '—')} / ${esc(dh.total ?? '—')}</div>
          <div class="stat-label">Devices Online</div>
        </div>
        <div class="card stat-card">
          <div class="stat-value">${esc(s.overdue_invoices ?? '—')}</div>
          <div class="stat-label">Overdue Invoices</div>
        </div>
      </div>

      <div class="detail-grid">
        <div class="card">
          <div class="card-header"><h3>MRR Breakdown</h3></div>
          <div class="detail-group">
            <div class="detail-label">Current MRR</div>
            <div class="detail-value">${money(r.mrr)}</div>
          </div>
          <div class="detail-group">
            <div class="detail-label">Revenue This Month</div>
            <div class="detail-value">${money(r.revenue_this_month)}</div>
          </div>
          <div class="detail-group">
            <div class="detail-label">Revenue Last Month</div>
            <div class="detail-value">${money(r.revenue_last_month)}</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Overdue Invoices</h3></div>
          ${od.length === 0
    ? '<p style="color:var(--text-muted)">No overdue invoices 🎉</p>'
    : `<div class="table-wrap"><table>
              <thead><tr><th>Client</th><th>Amount</th><th>Due Date</th></tr></thead>
              <tbody>${od.slice(0, 10).map(i => `<tr>
                <td>${esc(i.client_name || i.client_id)}</td>
                <td>${money(i.total)}</td>
                <td>${fmtDate(i.due_date)}</td>
              </tr>`).join('')}</tbody>
            </table></div>`}
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="card"><p class="error-text">Failed to load dashboard: ${esc(err.message)}</p></div>`;
  }
}

// ---------------------------------------------------------------------------
// Generic CRUD List Page Factory
// ---------------------------------------------------------------------------
function crudListPage(endpoint, columns, opts = {}) {
  const { searchable = true, pageSize = 25, createFields, detailFn, entityName } = opts;
  const name = entityName || endpoint.replace(/^\//, '').replace(/-/g, ' ');

  return async function renderList(container, detailId) {
    // Detail view
    if (detailId && detailFn) {
      return detailFn(container, detailId);
    }

    let page = 1;
    let search = '';

    async function load() {
      container.innerHTML = loading();
      try {
        let url = `${endpoint}?page=${page}&limit=${pageSize}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        const res = await API.get(url);
        const items = Array.isArray(res.data) ? res.data : (res.data?.rows || []);
        const total = res.data?.total ?? res.total ?? items.length;

        let html = '<div class="toolbar">';
        if (searchable) {
          html += `<input type="search" placeholder="Search ${name}…" value="${esc(search)}" id="tbl-search">`;
        }
        if (createFields) {
          html += `<button class="btn btn-primary" id="create-btn">+ New</button>`;
        }
        html += '</div>';

        html += '<div class="card"><div class="table-wrap"><table>';
        html += '<thead><tr>';
        columns.forEach(c => { html += `<th>${esc(c.label)}</th>`; });
        html += '</tr></thead><tbody>';

        if (items.length === 0) {
          html += `<tr><td colspan="${columns.length}" style="text-align:center;color:var(--text-muted)">No records found</td></tr>`;
        } else {
          items.forEach(item => {
            html += '<tr style="cursor:pointer" data-id="' + esc(item.id) + '">';
            columns.forEach(c => {
              let val = c.key.split('.').reduce((o, k) => o?.[k], item);
              if (c.render) val = c.render(val, item);
              else if (c.badge) val = badge(val);
              else if (c.money) val = money(val, item.currency);
              else if (c.date) val = fmtDate(val);
              else val = esc(val);
              html += `<td>${val ?? '—'}</td>`;
            });
            html += '</tr>';
          });
        }

        html += '</tbody></table></div>';
        html += pagination(page, total, pageSize);
        html += '</div>';

        container.innerHTML = html;

        // Bind events
        if (searchable) {
          const searchInput = document.getElementById('tbl-search');
          let debounce;
          searchInput.addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => { search = searchInput.value; page = 1; load(); }, 400);
          });
        }
        bindPagination(container, p => { page = p; load(); });

        // Row click → detail or hash
        container.querySelectorAll('tbody tr[data-id]').forEach(row => {
          row.addEventListener('click', () => {
            const id = row.dataset.id;
            window.location.hash = `#/${endpoint.replace(/^\//, '')}/${id}`;
          });
        });

        // Create button
        if (createFields) {
          const btn = document.getElementById('create-btn');
          if (btn) btn.addEventListener('click', () => showCreateModal(endpoint, createFields, name, load));
        }
      } catch (err) {
        container.innerHTML = errorState('Failed to load ' + name + ': ' + (err.message || 'Unknown error'));
      }
    }

    await load();
  };
}

// ---------------------------------------------------------------------------
// Create Modal
// ---------------------------------------------------------------------------
function showCreateModal(endpoint, fields, name, onSuccess) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal">
      <div class="modal-title">Create ${esc(name)}</div>
      <form id="create-form">
        ${fields.map(f => `
          <div class="form-group">
            <label>${esc(f.label)}</label>
            ${f.type === 'select'
    ? `<select name="${esc(f.key)}" ${f.required ? 'required' : ''}>${f.options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select>`
    : f.type === 'textarea'
      ? `<textarea name="${esc(f.key)}" ${f.required ? 'required' : ''} rows="3"></textarea>`
      : `<input type="${f.type || 'text'}" name="${esc(f.key)}" ${f.required ? 'required' : ''} placeholder="${esc(f.placeholder || '')}">`
}
          </div>
        `).join('')}
        <p id="create-error" class="error-text"></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="create-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">Create</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(backdrop);

  backdrop.querySelector('#create-cancel').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });

  backdrop.querySelector('#create-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const data = {};
    fields.forEach(f => {
      const val = form.elements[f.key]?.value;
      if (val !== undefined && val !== '') {
        data[f.key] = f.type === 'number' ? Number(val) : val;
      }
    });
    try {
      await API.post(endpoint, data);
      backdrop.remove();
      if (onSuccess) onSuccess();
    } catch (err) {
      form.querySelector('#create-error').textContent = err.message;
    }
  });
}

// ---------------------------------------------------------------------------
// Detail page helpers
// ---------------------------------------------------------------------------
function detailPage(endpoint, title, fieldGroups) {
  return async function(container, id) {
    container.innerHTML = loading();
    try {
      const res = await API.get(`${endpoint}/${id}`);
      const item = res.data || {};

      let html = `<div class="toolbar">
        <button class="btn btn-secondary" id="back-btn">← Back</button>
        <h3>${esc(title)} #${esc(id)}</h3>
      </div>`;
      html += '<div class="card"><div class="detail-grid">';
      fieldGroups.forEach(group => {
        group.forEach(f => {
          let val = f.key.split('.').reduce((o, k) => o?.[k], item);
          if (f.badge) val = badge(val);
          else if (f.money) val = money(val, item.currency);
          else if (f.date) val = fmtDate(val);
          else val = esc(val) || '—';
          html += `<div class="detail-group"><div class="detail-label">${esc(f.label)}</div><div class="detail-value">${val}</div></div>`;
        });
      });
      html += '</div></div>';
      container.innerHTML = html;

      document.getElementById('back-btn').addEventListener('click', () => window.history.back());
    } catch (err) {
      container.innerHTML = errorState('Failed to load: ' + (err.message || 'Unknown error'));
    }
  };
}

// ---------------------------------------------------------------------------
// Page: Clients
// ---------------------------------------------------------------------------
const clientsPage = crudListPage('/clients', [
  { key: 'id', label: 'ID' },
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'status', label: 'Status', badge: true },
], {
  entityName: 'clients',
  createFields: [
    { key: 'first_name', label: 'First Name', required: true },
    { key: 'last_name', label: 'Last Name', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'phone', label: 'Phone' },
    { key: 'rfc', label: 'RFC (Tax ID)' },
    { key: 'address', label: 'Address' },
  ],
  detailFn: detailPage('/clients', 'Client', [[
    { key: 'first_name', label: 'First Name' },
    { key: 'last_name', label: 'Last Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'rfc', label: 'RFC' },
    { key: 'status', label: 'Status', badge: true },
    { key: 'address', label: 'Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip_code', label: 'ZIP' },
    { key: 'created_at', label: 'Created', date: true },
  ]]),
});

// ---------------------------------------------------------------------------
// Page: Contracts
// ---------------------------------------------------------------------------
const contractsPage = crudListPage('/contracts', [
  { key: 'id', label: 'ID' },
  { key: 'client_id', label: 'Client ID' },
  { key: 'plan_id', label: 'Plan ID' },
  { key: 'status', label: 'Status', badge: true },
  { key: 'start_date', label: 'Start Date', date: true },
  { key: 'monthly_rate', label: 'Rate', money: true },
], {
  entityName: 'contracts',
  detailFn: detailPage('/contracts', 'Contract', [[
    { key: 'client_id', label: 'Client ID' },
    { key: 'plan_id', label: 'Plan ID' },
    { key: 'status', label: 'Status', badge: true },
    { key: 'start_date', label: 'Start Date', date: true },
    { key: 'end_date', label: 'End Date', date: true },
    { key: 'monthly_rate', label: 'Monthly Rate', money: true },
    { key: 'ip_address', label: 'IP Address' },
    { key: 'created_at', label: 'Created', date: true },
  ]]),
});

// ---------------------------------------------------------------------------
// Page: Plans
// ---------------------------------------------------------------------------
const plansPage = crudListPage('/plans', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'download_speed', label: 'Download (Mbps)' },
  { key: 'upload_speed', label: 'Upload (Mbps)' },
  { key: 'price', label: 'Price', money: true },
  { key: 'status', label: 'Status', badge: true },
], {
  entityName: 'plans',
  createFields: [
    { key: 'name', label: 'Name', required: true },
    { key: 'download_speed', label: 'Download Speed (Mbps)', type: 'number', required: true },
    { key: 'upload_speed', label: 'Upload Speed (Mbps)', type: 'number', required: true },
    { key: 'price', label: 'Price', type: 'number', required: true },
  ],
});

// ---------------------------------------------------------------------------
// Page: Invoices
// ---------------------------------------------------------------------------
const invoicesPage = crudListPage('/invoices', [
  { key: 'id', label: 'ID' },
  { key: 'client_id', label: 'Client' },
  { key: 'invoice_number', label: 'Number' },
  { key: 'total', label: 'Total', money: true },
  { key: 'status', label: 'Status', badge: true },
  { key: 'due_date', label: 'Due Date', date: true },
], {
  entityName: 'invoices',
  detailFn: detailPage('/invoices', 'Invoice', [[
    { key: 'invoice_number', label: 'Number' },
    { key: 'client_id', label: 'Client ID' },
    { key: 'subtotal', label: 'Subtotal', money: true },
    { key: 'tax_amount', label: 'Tax', money: true },
    { key: 'total', label: 'Total', money: true },
    { key: 'status', label: 'Status', badge: true },
    { key: 'issue_date', label: 'Issue Date', date: true },
    { key: 'due_date', label: 'Due Date', date: true },
    { key: 'currency', label: 'Currency' },
    { key: 'notes', label: 'Notes' },
  ]]),
});

// ---------------------------------------------------------------------------
// Page: Payments
// ---------------------------------------------------------------------------
const paymentsPage = crudListPage('/payments', [
  { key: 'id', label: 'ID' },
  { key: 'client_id', label: 'Client' },
  { key: 'amount', label: 'Amount', money: true },
  { key: 'method', label: 'Method' },
  { key: 'status', label: 'Status', badge: true },
  { key: 'payment_date', label: 'Date', date: true },
], { entityName: 'payments' });

// ---------------------------------------------------------------------------
// Page: Tickets
// ---------------------------------------------------------------------------
const ticketsPage = crudListPage('/tickets', [
  { key: 'id', label: 'ID' },
  { key: 'client_id', label: 'Client' },
  { key: 'subject', label: 'Subject' },
  { key: 'priority', label: 'Priority', badge: true },
  { key: 'status', label: 'Status', badge: true },
  { key: 'created_at', label: 'Created', date: true },
], {
  entityName: 'tickets',
  createFields: [
    { key: 'client_id', label: 'Client ID', type: 'number', required: true },
    { key: 'subject', label: 'Subject', required: true },
    { key: 'description', label: 'Description', type: 'textarea', required: true },
    { key: 'priority', label: 'Priority', type: 'select', options: [
      { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' }, { value: 'critical', label: 'Critical' },
    ] },
  ],
  detailFn: detailPage('/tickets', 'Ticket', [[
    { key: 'subject', label: 'Subject' },
    { key: 'description', label: 'Description' },
    { key: 'client_id', label: 'Client ID' },
    { key: 'assigned_to', label: 'Assigned To' },
    { key: 'priority', label: 'Priority', badge: true },
    { key: 'status', label: 'Status', badge: true },
    { key: 'created_at', label: 'Created', date: true },
    { key: 'updated_at', label: 'Updated', date: true },
  ]]),
});

// ---------------------------------------------------------------------------
// Page: Devices
// ---------------------------------------------------------------------------
const devicesPage = crudListPage('/devices', [
  { key: 'id', label: 'ID' },
  { key: 'hostname', label: 'Hostname' },
  { key: 'ip_address', label: 'IP Address' },
  { key: 'device_type', label: 'Type' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'status', label: 'Status', badge: true },
], {
  entityName: 'devices',
  detailFn: detailPage('/devices', 'Device', [[
    { key: 'hostname', label: 'Hostname' },
    { key: 'ip_address', label: 'IP Address' },
    { key: 'mac_address', label: 'MAC Address' },
    { key: 'device_type', label: 'Type' },
    { key: 'manufacturer', label: 'Manufacturer' },
    { key: 'model', label: 'Model' },
    { key: 'firmware_version', label: 'Firmware' },
    { key: 'status', label: 'Status', badge: true },
    { key: 'site_id', label: 'Site ID' },
    { key: 'client_id', label: 'Client ID' },
    { key: 'last_seen', label: 'Last Seen', date: true },
  ]]),
});

// ---------------------------------------------------------------------------
// Page: Network Health
// ---------------------------------------------------------------------------
async function networkPage(container) {
  container.innerHTML = loading();
  try {
    const res = await API.get('/network-health?limit=20');
    const items = Array.isArray(res.data) ? res.data : (res.data?.rows || []);

    let html = '<div class="stats-grid">';
    // Summary stats
    const latencies = items.map(i => i.latency_ms).filter(Boolean);
    const avgLatency = latencies.length ? (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1) : '—';
    const losses = items.map(i => i.packet_loss).filter(v => v != null);
    const avgLoss = losses.length ? (losses.reduce((a, b) => a + b, 0) / losses.length).toFixed(2) : '—';

    html += `<div class="card stat-card"><div class="stat-value">${esc(items.length)}</div><div class="stat-label">Recent Snapshots</div></div>`;
    html += `<div class="card stat-card"><div class="stat-value">${avgLatency}ms</div><div class="stat-label">Avg Latency</div></div>`;
    html += `<div class="card stat-card"><div class="stat-value">${avgLoss}%</div><div class="stat-label">Avg Packet Loss</div></div>`;
    html += '</div>';

    html += '<div class="card"><div class="card-header"><h3>Network Health Snapshots</h3></div>';
    html += '<div class="table-wrap"><table>';
    html += '<thead><tr><th>ID</th><th>Site ID</th><th>Latency</th><th>Packet Loss</th><th>Uptime</th><th>Timestamp</th></tr></thead>';
    html += '<tbody>';
    items.forEach(i => {
      html += `<tr>
        <td>${esc(i.id)}</td>
        <td>${esc(i.site_id)}</td>
        <td>${esc(i.latency_ms)}ms</td>
        <td>${esc(i.packet_loss)}%</td>
        <td>${esc(i.uptime)}</td>
        <td>${fmtDate(i.created_at)}</td>
      </tr>`;
    });
    html += '</tbody></table></div></div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="card"><p class="error-text">Failed to load network health: ${esc(err.message)}</p></div>`;
  }
}

// ---------------------------------------------------------------------------
// Page: Users
// ---------------------------------------------------------------------------
const usersPage = crudListPage('/users', [
  { key: 'id', label: 'ID' },
  { key: 'first_name', label: 'First Name' },
  { key: 'last_name', label: 'Last Name' },
  { key: 'email', label: 'Email' },
  { key: 'role', label: 'Role' },
  { key: 'status', label: 'Status', badge: true },
], { entityName: 'users' });

// ---------------------------------------------------------------------------
// Page: Credit Notes
// ---------------------------------------------------------------------------
const creditNotesPage = crudListPage('/credit-notes', [
  { key: 'id', label: 'ID' },
  { key: 'credit_note_number', label: 'Number' },
  { key: 'client_id', label: 'Client' },
  { key: 'total', label: 'Total', money: true },
  { key: 'reason', label: 'Reason' },
  { key: 'status', label: 'Status', badge: true },
  { key: 'created_at', label: 'Created', date: true },
], {
  entityName: 'credit notes',
  detailFn: detailPage('/credit-notes', 'Credit Note', [[
    { key: 'credit_note_number', label: 'Number' },
    { key: 'client_id', label: 'Client ID' },
    { key: 'total', label: 'Total', money: true },
    { key: 'reason', label: 'Reason' },
    { key: 'status', label: 'Status', badge: true },
    { key: 'currency', label: 'Currency' },
    { key: 'created_at', label: 'Created', date: true },
  ]]),
});

// ---------------------------------------------------------------------------
// Page: Quotes
// ---------------------------------------------------------------------------
const quotesPage = crudListPage('/quotes', [
  { key: 'id', label: 'ID' },
  { key: 'quote_number', label: 'Number' },
  { key: 'client_id', label: 'Client' },
  { key: 'total', label: 'Total', money: true },
  { key: 'status', label: 'Status', badge: true },
  { key: 'valid_until', label: 'Valid Until', date: true },
], {
  entityName: 'quotes',
  detailFn: detailPage('/quotes', 'Quote', [[
    { key: 'quote_number', label: 'Number' },
    { key: 'client_id', label: 'Client ID' },
    { key: 'subtotal', label: 'Subtotal', money: true },
    { key: 'tax', label: 'Tax', money: true },
    { key: 'total', label: 'Total', money: true },
    { key: 'status', label: 'Status', badge: true },
    { key: 'valid_until', label: 'Valid Until', date: true },
    { key: 'notes', label: 'Notes' },
    { key: 'created_at', label: 'Created', date: true },
  ]]),
});

// ---------------------------------------------------------------------------
// Page: Sites
// ---------------------------------------------------------------------------
const sitesPage = crudListPage('/sites', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'address', label: 'Address' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'status', label: 'Status', badge: true },
], {
  entityName: 'sites',
  createFields: [
    { key: 'name', label: 'Name', required: true },
    { key: 'address', label: 'Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip_code', label: 'ZIP Code' },
  ],
  detailFn: detailPage('/sites', 'Site', [[
    { key: 'name', label: 'Name' },
    { key: 'address', label: 'Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip_code', label: 'ZIP Code' },
    { key: 'country', label: 'Country' },
    { key: 'latitude', label: 'Latitude' },
    { key: 'longitude', label: 'Longitude' },
    { key: 'status', label: 'Status', badge: true },
    { key: 'created_at', label: 'Created', date: true },
  ]]),
});

// ---------------------------------------------------------------------------
// Page: Jobs
// ---------------------------------------------------------------------------
const jobsPage = crudListPage('/jobs', [
  { key: 'id', label: 'ID' },
  { key: 'title', label: 'Title' },
  { key: 'client_id', label: 'Client' },
  { key: 'assigned_to', label: 'Assigned To' },
  { key: 'priority', label: 'Priority', badge: true },
  { key: 'status', label: 'Status', badge: true },
  { key: 'scheduled_date', label: 'Scheduled', date: true },
], {
  entityName: 'jobs',
  createFields: [
    { key: 'title', label: 'Title', required: true },
    { key: 'client_id', label: 'Client ID', type: 'number', required: true },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'priority', label: 'Priority', type: 'select', options: [
      { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' }, { value: 'critical', label: 'Critical' },
    ] },
    { key: 'scheduled_date', label: 'Scheduled Date', type: 'date' },
  ],
  detailFn: detailPage('/jobs', 'Job', [[
    { key: 'title', label: 'Title' },
    { key: 'description', label: 'Description' },
    { key: 'client_id', label: 'Client ID' },
    { key: 'assigned_to', label: 'Assigned To' },
    { key: 'priority', label: 'Priority', badge: true },
    { key: 'status', label: 'Status', badge: true },
    { key: 'scheduled_date', label: 'Scheduled', date: true },
    { key: 'completed_date', label: 'Completed', date: true },
    { key: 'notes', label: 'Notes' },
    { key: 'created_at', label: 'Created', date: true },
  ]]),
});

// ---------------------------------------------------------------------------
// Page: Outages
// ---------------------------------------------------------------------------
const outagesPage = crudListPage('/outages', [
  { key: 'id', label: 'ID' },
  { key: 'title', label: 'Title' },
  { key: 'site_id', label: 'Site' },
  { key: 'severity', label: 'Severity', badge: true },
  { key: 'status', label: 'Status', badge: true },
  { key: 'started_at', label: 'Started', date: true },
  { key: 'resolved_at', label: 'Resolved', date: true },
], {
  entityName: 'outages',
  detailFn: detailPage('/outages', 'Outage', [[
    { key: 'title', label: 'Title' },
    { key: 'site_id', label: 'Site ID' },
    { key: 'severity', label: 'Severity', badge: true },
    { key: 'status', label: 'Status', badge: true },
    { key: 'started_at', label: 'Started', date: true },
    { key: 'resolved_at', label: 'Resolved', date: true },
    { key: 'description', label: 'Description' },
    { key: 'affected_clients', label: 'Affected Clients' },
    { key: 'notes', label: 'Notes' },
  ]]),
});

// ---------------------------------------------------------------------------
// Page: Warehouses
// ---------------------------------------------------------------------------
const warehousesPage = crudListPage('/warehouses', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'location', label: 'Location' },
  { key: 'city', label: 'City' },
  { key: 'status', label: 'Status', badge: true },
], {
  entityName: 'warehouses',
  createFields: [
    { key: 'name', label: 'Name', required: true },
    { key: 'location', label: 'Location' },
    { key: 'city', label: 'City' },
  ],
});

// ---------------------------------------------------------------------------
// Page: Inventory
// ---------------------------------------------------------------------------
const inventoryPage = crudListPage('/inventory', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'sku', label: 'SKU' },
  { key: 'warehouse_id', label: 'Warehouse' },
  { key: 'quantity', label: 'Quantity' },
  { key: 'status', label: 'Status', badge: true },
], {
  entityName: 'inventory',
  detailFn: detailPage('/inventory', 'Inventory Item', [[
    { key: 'name', label: 'Name' },
    { key: 'sku', label: 'SKU' },
    { key: 'description', label: 'Description' },
    { key: 'category', label: 'Category' },
    { key: 'warehouse_id', label: 'Warehouse ID' },
    { key: 'quantity', label: 'Quantity' },
    { key: 'min_stock', label: 'Min Stock' },
    { key: 'unit_cost', label: 'Unit Cost', money: true },
    { key: 'status', label: 'Status', badge: true },
    { key: 'created_at', label: 'Created', date: true },
  ]]),
});

// ---------------------------------------------------------------------------
// Page: Roles
// ---------------------------------------------------------------------------
const rolesPage = crudListPage('/roles', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description' },
  { key: 'is_system', label: 'Type', render: val => val ? 'System' : 'Custom' },
], { entityName: 'roles' });

// ---------------------------------------------------------------------------
// Page: Organizations
// ---------------------------------------------------------------------------
const organizationsPage = crudListPage('/organizations', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'status', label: 'Status', badge: true },
  { key: 'created_at', label: 'Created', date: true },
], {
  entityName: 'organizations',
  createFields: [
    { key: 'name', label: 'Name', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'phone', label: 'Phone' },
  ],
  detailFn: detailPage('/organizations', 'Organization', [[
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'address', label: 'Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'country', label: 'Country' },
    { key: 'rfc', label: 'RFC' },
    { key: 'status', label: 'Status', badge: true },
    { key: 'created_at', label: 'Created', date: true },
  ]]),
});

// ---------------------------------------------------------------------------
// Page: Settings
// ---------------------------------------------------------------------------
const settingsPage = crudListPage('/settings', [
  { key: 'id', label: 'ID' },
  { key: 'key', label: 'Key' },
  { key: 'value', label: 'Value' },
  { key: 'category', label: 'Category' },
  { key: 'description', label: 'Description' },
], { entityName: 'settings' });

// ---------------------------------------------------------------------------
// Page: Audit Logs
// ---------------------------------------------------------------------------
const auditLogsPage = crudListPage('/audit-logs', [
  { key: 'id', label: 'ID' },
  { key: 'user_id', label: 'User' },
  { key: 'action', label: 'Action' },
  { key: 'entity_type', label: 'Entity Type' },
  { key: 'entity_id', label: 'Entity ID' },
  { key: 'created_at', label: 'Created', date: true },
], { entityName: 'audit logs', pageSize: 50 });

// ---------------------------------------------------------------------------
// Page: Expenses
// ---------------------------------------------------------------------------
const expensesPage = crudListPage('/expenses', [
  { key: 'id', label: 'ID' },
  { key: 'description', label: 'Description' },
  { key: 'category', label: 'Category' },
  { key: 'amount', label: 'Amount', money: true },
  { key: 'expense_date', label: 'Date', date: true },
  { key: 'status', label: 'Status', badge: true },
], {
  entityName: 'expenses',
  createFields: [
    { key: 'description', label: 'Description', required: true },
    { key: 'category', label: 'Category', required: true },
    { key: 'amount', label: 'Amount', type: 'number', required: true },
    { key: 'vendor', label: 'Vendor' },
    { key: 'expense_date', label: 'Date', type: 'date' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  detailFn: detailPage('/expenses', 'Expense', [[
    { key: 'description', label: 'Description' },
    { key: 'category', label: 'Category' },
    { key: 'amount', label: 'Amount', money: true },
    { key: 'vendor', label: 'Vendor' },
    { key: 'expense_date', label: 'Date', date: true },
    { key: 'notes', label: 'Notes' },
    { key: 'status', label: 'Status', badge: true },
    { key: 'created_at', label: 'Created', date: true },
  ]]),
});

// ---------------------------------------------------------------------------
// Page: IP Pools
// ---------------------------------------------------------------------------
const ipPoolsPage = crudListPage('/ip-pools', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'network', label: 'Network' },
  { key: 'prefix_length', label: 'Prefix' },
  { key: 'pool_type', label: 'Type' },
  { key: 'status', label: 'Status', badge: true },
], {
  entityName: 'IP pools',
  detailFn: detailPage('/ip-pools', 'IP Pool', [[
    { key: 'name', label: 'Name' },
    { key: 'network', label: 'Network' },
    { key: 'prefix_length', label: 'Prefix Length' },
    { key: 'pool_type', label: 'Pool Type' },
    { key: 'gateway', label: 'Gateway' },
    { key: 'vlan_id', label: 'VLAN ID' },
    { key: 'status', label: 'Status', badge: true },
    { key: 'total_ips', label: 'Total IPs' },
    { key: 'used_ips', label: 'Used IPs' },
  ]]),
});

// ---------------------------------------------------------------------------
// Page: SLA Definitions
// ---------------------------------------------------------------------------
const slaDefinitionsPage = crudListPage('/sla-definitions', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'uptime_target', label: 'Uptime Target' },
  { key: 'response_time_hours', label: 'Response (hrs)' },
  { key: 'resolution_time_hours', label: 'Resolution (hrs)' },
  { key: 'status', label: 'Status', badge: true },
], { entityName: 'SLA definitions' });

// ---------------------------------------------------------------------------
// Page: SNMP Profiles
// ---------------------------------------------------------------------------
const snmpProfilesPage = crudListPage('/snmp-profiles', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'community', label: 'Community' },
  { key: 'version', label: 'Version' },
  { key: 'port', label: 'Port' },
  { key: 'status', label: 'Status', badge: true },
], {
  entityName: 'SNMP profiles',
  createFields: [
    { key: 'name', label: 'Name', required: true },
    { key: 'community', label: 'Community', required: true },
    { key: 'version', label: 'Version', type: 'select', options: [
      { value: 'v1', label: 'v1' }, { value: 'v2c', label: 'v2c' },
      { value: 'v3', label: 'v3' },
    ] },
    { key: 'port', label: 'Port', type: 'number' },
  ],
});

// ---------------------------------------------------------------------------
// Page: Webhooks
// ---------------------------------------------------------------------------
const webhooksPage = crudListPage('/webhooks', [
  { key: 'id', label: 'ID' },
  { key: 'url', label: 'URL' },
  { key: 'events', label: 'Events' },
  { key: 'status', label: 'Status', badge: true },
  { key: 'created_at', label: 'Created', date: true },
], {
  entityName: 'webhooks',
  createFields: [
    { key: 'url', label: 'URL', required: true },
    { key: 'events', label: 'Events', required: true },
    { key: 'secret', label: 'Secret' },
  ],
});

// ---------------------------------------------------------------------------
// Page: Scheduled Tasks
// ---------------------------------------------------------------------------
const scheduledTasksPage = crudListPage('/scheduled-tasks', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'cron_expression', label: 'Cron' },
  { key: 'status', label: 'Status', badge: true },
  { key: 'last_run_at', label: 'Last Run', date: true },
  { key: 'next_run_at', label: 'Next Run', date: true },
], { entityName: 'scheduled tasks' });

// ---------------------------------------------------------------------------
// Page: Alert Rules
// ---------------------------------------------------------------------------
const alertRulesPage = crudListPage('/alerts/rules', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'metric', label: 'Metric' },
  { key: 'operator', label: 'Operator' },
  { key: 'threshold', label: 'Threshold' },
  { key: 'severity', label: 'Severity', badge: true },
  { key: 'enabled', label: 'Enabled', render: val => val ? '✅ Enabled' : '❌ Disabled' },
], { entityName: 'alert rules' });

// ---------------------------------------------------------------------------
// Page: Coverage Zones
// ---------------------------------------------------------------------------
const coverageZonesPage = crudListPage('/coverage-zones', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description' },
  { key: 'status', label: 'Status', badge: true },
], {
  entityName: 'coverage zones',
  createFields: [
    { key: 'name', label: 'Name', required: true },
    { key: 'description', label: 'Description', type: 'textarea' },
  ],
});

// ---------------------------------------------------------------------------
// Page: Network Links
// ---------------------------------------------------------------------------
const networkLinksPage = crudListPage('/network-links', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'link_type', label: 'Type' },
  { key: 'bandwidth_mbps', label: 'Bandwidth (Mbps)' },
  { key: 'site_a_id', label: 'Site A' },
  { key: 'site_b_id', label: 'Site B' },
  { key: 'status', label: 'Status', badge: true },
], { entityName: 'network links' });

// ---------------------------------------------------------------------------
// Suspension Management
// ---------------------------------------------------------------------------
const suspensionRulesPage = crudListPage('/suspension/rules', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'grace_period_days', label: 'Grace Period (days)' },
  { key: 'auto_suspend', label: 'Auto Suspend', render: val => val ? '✅ Yes' : '❌ No' },
  { key: 'auto_reconnect', label: 'Auto Reconnect', render: val => val ? '✅ Yes' : '❌ No' },
  { key: 'enabled', label: 'Enabled', render: val => val ? '✅ Enabled' : '❌ Disabled' },
], { entityName: 'suspension rules' });

const suspensionLogsPage = crudListPage('/suspension/logs', [
  { key: 'id', label: 'ID' },
  { key: 'contract_id', label: 'Contract' },
  { key: 'action', label: 'Action', badge: true },
  { key: 'reason', label: 'Reason' },
  { key: 'created_at', label: 'Date', date: true },
], { entityName: 'suspension logs', searchable: true });

// ---------------------------------------------------------------------------
// Billing & Reports
// ---------------------------------------------------------------------------
const billingPage = crudListPage('/billing/periods', [
  { key: 'id', label: 'ID' },
  { key: 'start_date', label: 'Start', date: true },
  { key: 'end_date', label: 'End', date: true },
  { key: 'status', label: 'Status', badge: true },
  { key: 'invoice_count', label: 'Invoices' },
  { key: 'total', label: 'Total', money: true },
], { entityName: 'billing periods' });

const revenueSummaryPage = crudListPage('/revenue-summary', [
  { key: 'id', label: 'ID' },
  { key: 'period', label: 'Period' },
  { key: 'total_revenue', label: 'Revenue', money: true },
  { key: 'total_collected', label: 'Collected', money: true },
  { key: 'outstanding', label: 'Outstanding', money: true },
  { key: 'currency', label: 'Currency' },
], { entityName: 'revenue summaries' });

async function reportsPage(container) {
  container.innerHTML = loading();
  try {
    const [aging, summary] = await Promise.all([
      API.get('/reports/aging').catch(() => ({ data: [] })),
      API.get('/reports/financial-summary').catch(() => ({ data: {} })),
    ]);
    const ar = Array.isArray(aging.data) ? aging.data : [];
    const fs = summary.data || {};
    container.innerHTML = `
      <div class="detail-grid">
        <div class="card">
          <div class="card-header"><h3>Financial Summary</h3></div>
          <div class="detail-group">
            <div class="detail-label">Total Revenue</div>
            <div class="detail-value">${money(fs.total_revenue)}</div>
          </div>
          <div class="detail-group">
            <div class="detail-label">Total Collected</div>
            <div class="detail-value">${money(fs.total_collected)}</div>
          </div>
          <div class="detail-group">
            <div class="detail-label">Outstanding</div>
            <div class="detail-value">${money(fs.outstanding)}</div>
          </div>
          <div class="detail-group">
            <div class="detail-label">Active Clients</div>
            <div class="detail-value">${esc(fs.active_clients ?? '—')}</div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>Accounts Receivable Aging</h3></div>
          ${ar.length === 0 ? emptyState('No aging data available')
    : '<div class="table-wrap"><table><thead><tr><th>Client</th><th>Current</th><th>30 Days</th><th>60 Days</th><th>90+ Days</th></tr></thead><tbody>'
      + ar.slice(0, 20).map(r => '<tr><td>' + esc(r.client_name || r.client_id) + '</td><td>' + money(r.current) + '</td><td>' + money(r.days_30) + '</td><td>' + money(r.days_60) + '</td><td>' + money(r.days_90_plus) + '</td></tr>').join('')
      + '</tbody></table></div>'}
        </div>
      </div>`;
  } catch (err) {
    container.innerHTML = errorState(err.message);
  }
}

// ---------------------------------------------------------------------------
// CFDI / Mexican Compliance
// ---------------------------------------------------------------------------
const cfdiDocumentsPage = crudListPage('/cfdi-documents', [
  { key: 'id', label: 'ID' },
  { key: 'uuid', label: 'UUID' },
  { key: 'invoice_id', label: 'Invoice' },
  { key: 'receptor_rfc', label: 'Receptor RFC' },
  { key: 'total', label: 'Total', money: true },
  { key: 'status', label: 'Status', badge: true },
  { key: 'created_at', label: 'Created', date: true },
], { entityName: 'CFDI documents' });

const facturasPublicasPage = crudListPage('/facturas-publicas', [
  { key: 'id', label: 'ID' },
  { key: 'invoice_number', label: 'Invoice Number' },
  { key: 'receptor_name', label: 'Receptor' },
  { key: 'total', label: 'Total', money: true },
  { key: 'status', label: 'Status', badge: true },
  { key: 'created_at', label: 'Created', date: true },
], { entityName: 'facturas públicas' });

const satCatalogsPage = crudListPage('/sat-catalogs', [
  { key: 'id', label: 'ID' },
  { key: 'catalog_type', label: 'Type' },
  { key: 'code', label: 'Code' },
  { key: 'description', label: 'Description' },
], { entityName: 'SAT catalogs', searchable: true });

const csdCertificatesPage = crudListPage('/csd-certificates', [
  { key: 'id', label: 'ID' },
  { key: 'certificate_number', label: 'Certificate No.' },
  { key: 'rfc', label: 'RFC' },
  { key: 'valid_from', label: 'Valid From', date: true },
  { key: 'valid_to', label: 'Valid To', date: true },
  { key: 'status', label: 'Status', badge: true },
], { entityName: 'CSD certificates' });

const pacProvidersPage = crudListPage('/pac-providers', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'provider_type', label: 'Type' },
  { key: 'environment', label: 'Environment', badge: true },
  { key: 'status', label: 'Status', badge: true },
], { entityName: 'PAC providers' });

// ---------------------------------------------------------------------------
// Network / RADIUS
// ---------------------------------------------------------------------------
const nasPage = crudListPage('/nas', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'ip_address', label: 'IP Address' },
  { key: 'type', label: 'Type' },
  { key: 'coa_port', label: 'CoA Port' },
  { key: 'status', label: 'Status', badge: true },
], {
  entityName: 'NAS devices',
  createFields: [
    { key: 'name', label: 'Name', required: true },
    { key: 'ip_address', label: 'IP Address', required: true },
    { key: 'secret', label: 'Secret', required: true },
    { key: 'type', label: 'Type' },
  ],
});

const radiusPage = crudListPage('/radius', [
  { key: 'id', label: 'ID' },
  { key: 'username', label: 'Username' },
  { key: 'contract_id', label: 'Contract' },
  { key: 'nas_id', label: 'NAS' },
  { key: 'ip_address', label: 'IP Address' },
  { key: 'status', label: 'Status', badge: true },
], { entityName: 'RADIUS accounts' });

const connectionLogsPage = crudListPage('/connection-logs', [
  { key: 'id', label: 'ID' },
  { key: 'username', label: 'Username' },
  { key: 'ip_address', label: 'IP Address' },
  { key: 'nas_ip', label: 'NAS IP' },
  { key: 'bytes_in', label: 'Bytes In' },
  { key: 'bytes_out', label: 'Bytes Out' },
  { key: 'session_time', label: 'Session Time' },
  { key: 'created_at', label: 'Date', date: true },
], { entityName: 'connection logs', searchable: true });

const speedTestsPage = crudListPage('/speed-tests', [
  { key: 'id', label: 'ID' },
  { key: 'contract_id', label: 'Contract' },
  { key: 'download_mbps', label: 'Download (Mbps)' },
  { key: 'upload_mbps', label: 'Upload (Mbps)' },
  { key: 'latency_ms', label: 'Latency (ms)' },
  { key: 'created_at', label: 'Date', date: true },
], { entityName: 'speed tests' });

const vlansPage = crudListPage('/vlans', [
  { key: 'id', label: 'ID' },
  { key: 'vlan_id', label: 'VLAN ID' },
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description' },
  { key: 'status', label: 'Status', badge: true },
], {
  entityName: 'VLANs',
  createFields: [
    { key: 'vlan_id', label: 'VLAN ID', required: true, type: 'number' },
    { key: 'name', label: 'Name', required: true },
    { key: 'description', label: 'Description' },
  ],
});

const ipAssignmentsPage = crudListPage('/ip-assignments', [
  { key: 'id', label: 'ID' },
  { key: 'ip_address', label: 'IP Address' },
  { key: 'pool_id', label: 'Pool' },
  { key: 'contract_id', label: 'Contract' },
  { key: 'status', label: 'Status', badge: true },
  { key: 'assigned_at', label: 'Assigned', date: true },
], { entityName: 'IP assignments' });

// ---------------------------------------------------------------------------
// Payment Gateways & Recurring
// ---------------------------------------------------------------------------
const paymentGatewaysPage = crudListPage('/payment-gateways', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'provider', label: 'Provider' },
  { key: 'environment', label: 'Environment', badge: true },
  { key: 'status', label: 'Status', badge: true },
], { entityName: 'payment gateways' });

const paymentTransactionsPage = crudListPage('/payment-transactions', [
  { key: 'id', label: 'ID' },
  { key: 'gateway_id', label: 'Gateway' },
  { key: 'amount', label: 'Amount', money: true },
  { key: 'currency', label: 'Currency' },
  { key: 'gateway_status', label: 'Status', badge: true },
  { key: 'created_at', label: 'Date', date: true },
], { entityName: 'payment transactions' });

const recurringPaymentProfilesPage = crudListPage('/recurring-payment-profiles', [
  { key: 'id', label: 'ID' },
  { key: 'client_id', label: 'Client' },
  { key: 'gateway_id', label: 'Gateway' },
  { key: 'amount', label: 'Amount', money: true },
  { key: 'frequency', label: 'Frequency' },
  { key: 'next_charge_date', label: 'Next Charge', date: true },
  { key: 'status', label: 'Status', badge: true },
], { entityName: 'recurring payment profiles' });

// ---------------------------------------------------------------------------
// Admin / API Tokens / 2FA / Service Areas
// ---------------------------------------------------------------------------
const apiTokensPage = crudListPage('/api-tokens', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'scopes', label: 'Scopes' },
  { key: 'last_used_at', label: 'Last Used', date: true },
  { key: 'expires_at', label: 'Expires', date: true },
], {
  entityName: 'API tokens',
  createFields: [
    { key: 'name', label: 'Name', required: true },
    { key: 'scopes', label: 'Scopes' },
  ],
});

async function twoFactorPage(container) {
  container.innerHTML = loading();
  try {
    const res = await API.get('/2fa/status');
    const status = res.data || {};
    container.innerHTML = `
      <div class="card" style="max-width:600px">
        <div class="card-header"><h3>Two-Factor Authentication</h3></div>
        <div class="detail-group">
          <div class="detail-label">Status</div>
          <div class="detail-value">${status.enabled ? '<span class="badge badge-success">Enabled</span>' : '<span class="badge badge-warning">Disabled</span>'}</div>
        </div>
        ${!status.enabled ? `
          <p style="margin:1rem 0;color:var(--text-muted)">Enable 2FA to add an extra layer of security to your account.</p>
          <button class="btn btn-primary" id="enable-2fa-btn">Enable 2FA</button>
        ` : `
          <p style="margin:1rem 0;color:var(--text-muted)">Two-factor authentication is active on your account.</p>
          <button class="btn btn-danger" id="disable-2fa-btn">Disable 2FA</button>
        `}
      </div>`;
    const enableBtn = document.getElementById('enable-2fa-btn');
    if (enableBtn) {
      enableBtn.addEventListener('click', async () => {
        try {
          const setupRes = await API.post('/2fa/setup');
          const d = setupRes.data || {};
          container.innerHTML = '<div class="card" style="max-width:600px">' +
            '<div class="card-header"><h3>Set Up 2FA</h3></div>' +
            '<p>Scan this QR code with your authenticator app, then enter the verification code below.</p>' +
            '<p style="word-break:break-all;font-family:monospace;font-size:0.85rem;background:var(--bg-secondary);padding:0.5rem;border-radius:4px">' + esc(d.otpauth_url || d.secret) + '</p>' +
            '<form id="verify-2fa-form" style="margin-top:1rem">' +
            '<div class="form-group"><label>Verification Code</label><input type="text" id="totp-code" required maxlength="6" pattern="[0-9]{6}" placeholder="000000"></div>' +
            '<p id="verify-error" class="error-text"></p>' +
            '<button type="submit" class="btn btn-primary">Verify & Enable</button>' +
            '</form></div>';
          document.getElementById('verify-2fa-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const code = document.getElementById('totp-code').value;
            try {
              await API.post('/2fa/verify', { token: code });
              twoFactorPage(container);
            } catch (err) {
              document.getElementById('verify-error').textContent = err.message || 'Invalid code';
            }
          });
        } catch (err) {
          container.innerHTML = errorState(err.message);
        }
      });
    }
    const disableBtn = document.getElementById('disable-2fa-btn');
    if (disableBtn) {
      disableBtn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to disable 2FA?')) {
          try {
            await API.delete('/2fa');
            twoFactorPage(container);
          } catch (err) {
            alert('Failed to disable 2FA: ' + (err.message || 'Unknown error'));
          }
        }
      });
    }
  } catch (err) {
    container.innerHTML = errorState(err.message);
  }
}

const serviceAreasPage = crudListPage('/service-areas', [
  { key: 'id', label: 'ID' },
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description' },
  { key: 'status', label: 'Status', badge: true },
], {
  entityName: 'service areas',
  createFields: [
    { key: 'name', label: 'Name', required: true },
    { key: 'description', label: 'Description', type: 'textarea' },
  ],
});

// ---------------------------------------------------------------------------
// Regulatory / IFT
// ---------------------------------------------------------------------------
const concessionTitlesPage = crudListPage('/concession-titles', [
  { key: 'id', label: 'ID' },
  { key: 'title_number', label: 'Title Number' },
  { key: 'title_type', label: 'Type' },
  { key: 'issued_date', label: 'Issued', date: true },
  { key: 'expiry_date', label: 'Expires', date: true },
  { key: 'status', label: 'Status', badge: true },
], { entityName: 'concession titles' });

const regulatoryFilingsPage = crudListPage('/regulatory-filings', [
  { key: 'id', label: 'ID' },
  { key: 'filing_type', label: 'Type' },
  { key: 'period', label: 'Period' },
  { key: 'submitted_at', label: 'Submitted', date: true },
  { key: 'status', label: 'Status', badge: true },
], { entityName: 'regulatory filings' });

const iftReportsPage = crudListPage('/ift-statistical-reports', [
  { key: 'id', label: 'ID' },
  { key: 'report_type', label: 'Type' },
  { key: 'period', label: 'Period' },
  { key: 'subscriber_count', label: 'Subscribers' },
  { key: 'status', label: 'Status', badge: true },
  { key: 'created_at', label: 'Created', date: true },
], { entityName: 'IFT reports' });

const deviceConfigBackupsPage = crudListPage('/device-config-backups', [
  { key: 'id', label: 'ID' },
  { key: 'device_id', label: 'Device' },
  { key: 'backup_type', label: 'Type' },
  { key: 'file_size', label: 'Size' },
  { key: 'created_at', label: 'Created', date: true },
], { entityName: 'device config backups' });

// ---------------------------------------------------------------------------
// Register all pages
// ---------------------------------------------------------------------------
Router.register('dashboard', dashboardPage);
Router.register('clients', clientsPage);
Router.register('contracts', contractsPage);
Router.register('plans', plansPage);
Router.register('invoices', invoicesPage);
Router.register('payments', paymentsPage);
Router.register('tickets', ticketsPage);
Router.register('devices', devicesPage);
Router.register('network', networkPage);
Router.register('users', usersPage);
Router.register('credit-notes', creditNotesPage);
Router.register('quotes', quotesPage);
Router.register('sites', sitesPage);
Router.register('jobs', jobsPage);
Router.register('outages', outagesPage);
Router.register('warehouses', warehousesPage);
Router.register('inventory', inventoryPage);
Router.register('roles', rolesPage);
Router.register('organizations', organizationsPage);
Router.register('settings', settingsPage);
Router.register('audit-logs', auditLogsPage);
Router.register('expenses', expensesPage);
Router.register('ip-pools', ipPoolsPage);
Router.register('sla-definitions', slaDefinitionsPage);
Router.register('snmp-profiles', snmpProfilesPage);
Router.register('webhooks', webhooksPage);
Router.register('scheduled-tasks', scheduledTasksPage);
Router.register('alerts/rules', alertRulesPage);
Router.register('coverage-zones', coverageZonesPage);
Router.register('network-links', networkLinksPage);
Router.register('suspension/rules', suspensionRulesPage);
Router.register('suspension/logs', suspensionLogsPage);
Router.register('billing', billingPage);
Router.register('revenue-summary', revenueSummaryPage);
Router.register('reports', reportsPage);
Router.register('cfdi-documents', cfdiDocumentsPage);
Router.register('facturas-publicas', facturasPublicasPage);
Router.register('sat-catalogs', satCatalogsPage);
Router.register('csd-certificates', csdCertificatesPage);
Router.register('pac-providers', pacProvidersPage);
Router.register('nas', nasPage);
Router.register('radius', radiusPage);
Router.register('connection-logs', connectionLogsPage);
Router.register('speed-tests', speedTestsPage);
Router.register('vlans', vlansPage);
Router.register('ip-assignments', ipAssignmentsPage);
Router.register('payment-gateways', paymentGatewaysPage);
Router.register('payment-transactions', paymentTransactionsPage);
Router.register('recurring-profiles', recurringPaymentProfilesPage);
Router.register('api-tokens', apiTokensPage);
Router.register('two-factor', twoFactorPage);
Router.register('service-areas', serviceAreasPage);
Router.register('concession-titles', concessionTitlesPage);
Router.register('regulatory-filings', regulatoryFilingsPage);
Router.register('ift-reports', iftReportsPage);
Router.register('device-config-backups', deviceConfigBackupsPage);
