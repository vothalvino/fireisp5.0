// =============================================================================
// FireISP 5.0 — Toast Notification System with SSE
// =============================================================================
// Provides non-intrusive toast notifications and a Server-Sent Events
// connection for real-time updates (payment received, device offline, etc.).
// =============================================================================

/* global window, document, EventSource */

const Toast = (() => {
  let container = null;
  let eventSource = null;

  /**
   * Initialize the toast container (called once at boot).
   */
  function init() {
    if (container) return;
    container = document.createElement('div');
    container.id = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    document.body.appendChild(container);
  }

  /**
   * Show a toast notification.
   * @param {string} message  Text to display (HTML-escaped internally)
   * @param {'success'|'error'|'warning'|'info'} type  Toast type
   * @param {number} duration  Auto-dismiss time in ms (0 = manual close)
   */
  function show(message, type, duration) {
    if (type === undefined) type = 'info';
    if (duration === undefined) duration = 5000;

    init();

    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.setAttribute('role', 'alert');

    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const icon = icons[type] || icons.info;

    // Escape message to prevent XSS
    const safe = String(message).replace(/[<>&"']/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', '\'': '&#39;' }[c];
    });

    toast.innerHTML =
      '<span class="toast-icon">' + icon + '</span>' +
      '<span class="toast-message">' + safe + '</span>' +
      '<button class="toast-close" aria-label="Close">&times;</button>';

    // Close button
    toast.querySelector('.toast-close').addEventListener('click', function () {
      dismiss(toast);
    });

    container.appendChild(toast);

    // Trigger entrance animation
    requestAnimationFrame(function () {
      toast.classList.add('toast-visible');
    });

    // Auto-dismiss
    if (duration > 0) {
      setTimeout(function () { dismiss(toast); }, duration);
    }

    return toast;
  }

  /**
   * Dismiss a toast element with exit animation.
   */
  function dismiss(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-exit');
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }

  // Convenience methods
  function success(msg, dur) { return show(msg, 'success', dur); }
  function error(msg, dur) { return show(msg, 'error', dur !== undefined ? dur : 8000); }
  function warning(msg, dur) { return show(msg, 'warning', dur); }
  function info(msg, dur) { return show(msg, 'info', dur); }

  // ---------------------------------------------------------------------------
  // Server-Sent Events (SSE) Connection
  // ---------------------------------------------------------------------------

  /**
   * Connect to the SSE event stream for real-time notifications.
   * Automatically reconnects on connection loss.
   */
  function connectSSE() {
    disconnectSSE();

    const token = (typeof API !== 'undefined' && API.token) ? API.token() : null;
    if (!token) return;

    const url = '/api/events?token=' + encodeURIComponent(token);

    try {
      eventSource = new EventSource(url);

      eventSource.onopen = function () {
        // Connection established
      };

      eventSource.onerror = function () {
        // EventSource auto-reconnects; just show a warning on repeated failures
        if (eventSource && eventSource.readyState === EventSource.CLOSED) {
          warning('Real-time connection lost. Retrying…', 3000);
        }
      };

      // Listen for specific event types
      eventSource.addEventListener('notification', function (e) {
        try {
          var data = JSON.parse(e.data);
          show(data.message || 'New notification', data.type || 'info');
        } catch (_err) {
          // Ignore malformed SSE data
        }
      });

      eventSource.addEventListener('payment.received', function (e) {
        try {
          var data = JSON.parse(e.data);
          success('Payment received: $' + (data.amount || '0.00') + (data.client ? ' from ' + data.client : ''));
        } catch (_err) {
          success('Payment received');
        }
      });

      eventSource.addEventListener('invoice.created', function (e) {
        try {
          var data = JSON.parse(e.data);
          info('Invoice created: ' + (data.invoice_number || '#' + data.id));
        } catch (_err) {
          info('New invoice created');
        }
      });

      eventSource.addEventListener('device.offline', function (e) {
        try {
          var data = JSON.parse(e.data);
          error('Device offline: ' + (data.name || data.ip_address || 'Unknown'));
        } catch (_err) {
          error('A device went offline');
        }
      });

      eventSource.addEventListener('device.online', function (e) {
        try {
          var data = JSON.parse(e.data);
          success('Device online: ' + (data.name || data.ip_address || 'Unknown'));
        } catch (_err) {
          success('A device came online');
        }
      });

      eventSource.addEventListener('contract.suspended', function (e) {
        try {
          var data = JSON.parse(e.data);
          warning('Contract suspended: ' + (data.contract_id || ''));
        } catch (_err) {
          warning('A contract was suspended');
        }
      });

      eventSource.addEventListener('alert.triggered', function (e) {
        try {
          var data = JSON.parse(e.data);
          warning('Alert: ' + (data.message || data.rule_name || 'Threshold breached'));
        } catch (_err) {
          warning('Alert triggered');
        }
      });

      // Generic message handler for all other events
      eventSource.onmessage = function (e) {
        try {
          var data = JSON.parse(e.data);
          if (data.message) {
            show(data.message, data.type || 'info');
          }
        } catch (_err) {
          // Ignore non-JSON messages (e.g. heartbeat)
        }
      };
    } catch (_err) {
      // EventSource not supported or connection failed
    }
  }

  /**
   * Disconnect from the SSE event stream (called on logout).
   */
  function disconnectSSE() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  }

  return {
    init: init,
    show: show,
    success: success,
    error: error,
    warning: warning,
    info: info,
    connectSSE: connectSSE,
    disconnectSSE: disconnectSSE,
  };
})();
