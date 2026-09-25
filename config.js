window.WEDDING_CONFIG = {
  // Paste your deployed Google Apps Script Web App URL here.
  // Example: https://script.google.com/macros/s/AKfycb.../exec
  API_URL: "https://script.google.com/macros/s/AKfycbyBfYYKbqkAYkjwI-nC2L2MThhGCwgm3-yBwEclFTIAZsg6EhCcfVcRmW3N4z2sfI6q/exec",
  // Fast lightweight revision check; full Sheet read is the independent safety net.
  REVISION_POLL_MS: 3000,
  FULL_SYNC_MS: 20000,
  POLL_MS: 20000, // backwards-compatible fallback
  EVENT_TITLE: "The Wedding Day",
  EVENT_LABEL: "26 September 2026",
  // Leave false unless you want to test against sample data before the backend is connected.
  USE_DEMO_DATA: false
};
