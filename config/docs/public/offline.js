// Registers the offline service worker and shows download progress.
(() => {
  if (!('serviceWorker' in navigator)) return;
  const base = document.currentScript.src.replace(/offline\.js.*$/, '');
  const DONE_FLAG = 'offline-ready-shown';

  let bar;
  function show(text, done) {
    if (!bar) {
      bar = document.createElement('div');
      bar.setAttribute('role', 'status');
      bar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:1000;' +
        'padding:8px 14px;border-radius:8px;font:14px/1.4 sans-serif;color:#fff;background:#3451b2;' +
        'box-shadow:0 2px 8px rgba(0,0,0,.3);max-width:90vw;text-align:center;transition:opacity .5s';
      document.body.appendChild(bar);
    }
    bar.textContent = text;
    bar.style.background = done ? '#18794e' : '#3451b2';
    bar.style.opacity = '1';
  }
  function hide(ms) {
    setTimeout(() => { if (bar) bar.style.opacity = '0'; }, ms);
  }

  navigator.serviceWorker.addEventListener('message', ({ data }) => {
    if (data.type === 'offline-progress' && data.done < data.total) {
      const pct = Math.floor((data.done / data.total) * 100);
      show(`Downloading for offline use: ${pct}% (${data.done} / ${data.total}). Keep this page open.`);
    } else if (data.type === 'offline-ready' || data.type === 'offline-progress') {
      // Show the "ready" message once per device, then stay quiet on later visits.
      if (localStorage.getItem(DONE_FLAG) && !bar) return;
      localStorage.setItem(DONE_FLAG, '1');
      show('✓ Ready to work offline', true);
      hide(4000);
      // Ask the browser not to delete the offline copy when storage is low.
      navigator.storage?.persist?.();
    }
  });

  // Browsers stop installs that fail (network error) or take too long (Chrome: ~5 min).
  // Files already saved stay saved, so register again: the new install continues where it stopped.
  const listening = new WeakSet(); // registrations with an updatefound listener
  async function start() {
    let reg;
    try {
      reg = await navigator.serviceWorker.register(base + 'sw.js', { scope: base });
    } catch {
      return setTimeout(start, 10000); // offline: sw.js not reachable
    }
    const watch = worker => worker?.addEventListener('statechange', () => {
      if (worker.state !== 'redundant' || reg.installing || reg.waiting) return;
      if (bar) show('Download paused (connection problem). Retrying…');
      setTimeout(start, 10000);
    });
    watch(reg.installing);
    if (!listening.has(reg)) reg.addEventListener('updatefound', () => watch(reg.installing));
    listening.add(reg);
    // An install may be running already (e.g. resumed). Ask for the current state.
    (reg.installing || reg.waiting || reg.active)?.postMessage('offline-status');
  }
  window.addEventListener('load', start);
})();
