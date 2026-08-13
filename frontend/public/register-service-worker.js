// Kept in an external, same-origin file so the production CSP does not need
// unsafe-inline or a build-time nonce in the otherwise static SPA shell.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function (err) {
      console.warn('SW registration failed:', err);
    });
  });
}
