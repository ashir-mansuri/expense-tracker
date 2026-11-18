/* Applies the saved colours before the first paint, so nothing flashes. A plain script (not a module) so it can run at once. */
try {
  var raw = localStorage.getItem('expense-tracker.prefs');
  var s;
  if (raw) s = JSON.parse(raw) || {};
  else s = (JSON.parse(localStorage.getItem('expense-tracker.v1') || '{}').settings) || {};
  var r = document.documentElement;
  if (s.look === 'gold') { r.dataset.look = 'gold'; document.querySelector('meta[name="theme-color"]').content = '#141416'; }
  if (s.look === 'cobalt') {
    r.dataset.look = 'cobalt';
    document.querySelector('meta[name="theme-color"]').content = '#F8FAFC';
    var sb = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]'); if (sb) sb.content = 'default';
  }
  if (s.look === 'obsidian') { r.dataset.look = 'obsidian'; document.querySelector('meta[name="theme-color"]').content = '#0B0E11'; }
  if (s.look !== 'cobalt' && s.look !== 'obsidian' && (s.theme === 'light' || s.theme === 'dark')) r.dataset.theme = s.theme;
} catch (e) {}
