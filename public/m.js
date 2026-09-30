(() => {
  const parts = location.pathname.split('/').filter(Boolean);
  const slug = parts.pop(), city = parts.pop() || 'palermo';
  const source = new URLSearchParams(location.search).get('s') || '';
  const LANGS = { it: ['IT', 'it-IT'], en: ['EN', 'en-GB'], fr: ['FR', 'fr-FR'], de: ['DE', 'de-DE'], es: ['ES', 'es-ES'] };
  const UI = {
    it: { play: '▶ Ascolta', stop: '■ Ferma', near: 'Vicino a te', geo: 'Usa la mia posizione', call: 'Chiama', map: 'Mappa', web: 'Sito', m: 'm', none: 'Nessun locale nelle vicinanze.', soon: 'Audio-guida in preparazione.', off: 'Audio non supportato da questo browser: leggi il testo qui sopra.' },
    en: { play: '▶ Listen', stop: '■ Stop', near: 'Near you', geo: 'Use my location', call: 'Call', map: 'Map', web: 'Website', m: 'm', none: 'No places nearby.', soon: 'Audio guide coming soon.', off: 'Audio not supported by this browser: read the text above.' },
    fr: { play: '▶ Écouter', stop: '■ Arrêter', near: 'Près de vous', geo: 'Utiliser ma position', call: 'Appeler', map: 'Plan', web: 'Site', m: 'm', none: 'Aucun lieu à proximité.', soon: 'Audioguide bientôt disponible.', off: 'Audio non pris en charge : lisez le texte ci-dessus.' },
    de: { play: '▶ Anhören', stop: '■ Stopp', near: 'In Ihrer Nähe', geo: 'Meinen Standort nutzen', call: 'Anrufen', map: 'Karte', web: 'Website', m: 'm', none: 'Keine Orte in der Nähe.', soon: 'Audioguide in Vorbereitung.', off: 'Audio wird nicht unterstützt: lesen Sie den Text oben.' },
    es: { play: '▶ Escuchar', stop: '■ Parar', near: 'Cerca de usted', geo: 'Usar mi ubicación', call: 'Llamar', map: 'Mapa', web: 'Web', m: 'm', none: 'No hay lugares cercanos.', soon: 'Audioguía en preparación.', off: 'Audio no compatible: lea el texto de arriba.' },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let lang = (localStorage.getItem('lang') || (navigator.language || 'en').slice(0, 2)).toLowerCase();
  if (!LANGS[lang]) lang = 'en';
  let pos = null, data = null, audioEl = null, speaking = false, scanned = false;

  const track = (type, extra = {}) => {
    const body = JSON.stringify({ type, city, slug, lang, source, ...extra });
    try { if (!navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }))) throw 0; }
    catch { fetch('/api/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {}); }
  };

  async function load() {
    const q = new URLSearchParams({ lang });
    if (pos) { q.set('lat', pos.lat); q.set('lng', pos.lng); }
    try {
      const r = await fetch(`/api/p/${encodeURIComponent(city)}/${encodeURIComponent(slug)}?${q}`);
      if (!r.ok) throw new Error(r.status);
      data = await r.json();
    } catch (e) {
      document.getElementById('app').innerHTML = '<div class="card">Contenuto non disponibile. / Content not available.</div>';
      return;
    }
    render();
    if (!scanned) { scanned = true; track('scan'); }
    if (data.showcase.length) track('impression', { business_ids: data.showcase.map((b) => b.id) });
  }

  function stopAudio() {
    if (audioEl) { audioEl.pause(); audioEl = null; }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    speaking = false;
  }

  function togglePlay() {
    if (speaking) { stopAudio(); return render(); }
    const t = data.text;
    if (t.audio_url) {
      audioEl = new Audio(t.audio_url);
      audioEl.onended = () => { speaking = false; render(); };
      audioEl.play().catch(() => {});
    } else if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(`${t.title}. ${t.body}`);
      u.lang = LANGS[t.lang || lang][1];
      u.onend = () => { speaking = false; render(); };
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } else {
      alert(UI[lang].off);
      return;
    }
    speaking = true;
    track('audio');
    render();
  }

  function dist(m) { return m < 1000 ? `${Math.round(m / 10) * 10} ${UI[lang].m}` : `${(m / 1000).toFixed(1)} km`; }

  function render() {
    const u = UI[lang], t = data.text;
    const biz = data.showcase.map((b) => `
      <div class="card biz">
        <div class="top"><span class="name">${esc(b.name)}</span><span class="tag ${b.tier === 'plus' ? 'plus' : ''}">${esc(b.category)} · ${dist(b.distance_m)}</span></div>
        ${b.description ? `<div class="mute">${esc(b.description)}</div>` : ''}
        <div class="actions">
          ${b.phone ? `<a class="btn small" href="tel:${esc(b.phone)}" data-t="call" data-b="${b.id}">${u.call}</a>` : ''}
          <a class="btn small ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}" data-t="map" data-b="${b.id}">${u.map}</a>
          ${b.website ? `<a class="btn small ghost" target="_blank" rel="noopener" href="${esc(b.website)}" data-t="web" data-b="${b.id}">${u.web}</a>` : ''}
        </div>
      </div>`).join('');
    document.getElementById('app').innerHTML = `
      <div class="langs">${Object.entries(LANGS).map(([k, [l]]) => `<button data-l="${k}" class="${k === lang ? 'on' : ''}">${l}</button>`).join('')}</div>
      <h1>${esc(t.title || data.monument.name)}</h1>
      <div class="mute">${esc(data.monument.comune)}</div>
      ${t.body ? `<div class="player"><button class="btn" id="play">${speaking ? u.stop : u.play}</button></div><p>${esc(t.body)}</p>` : `<p class="mute">${u.soon}</p>`}
      <h2>${u.near}</h2>
      ${biz || `<p class="mute">${u.none}</p>`}
      <button class="ghost small" id="geo">${u.geo}</button>`;
    document.documentElement.lang = lang;
    document.title = t.title || data.monument.name;
  }

  document.addEventListener('click', (e) => {
    const l = e.target.closest('[data-l]');
    if (l) { stopAudio(); lang = l.dataset.l; localStorage.setItem('lang', lang); return load(); }
    if (e.target.closest('#play')) return togglePlay();
    if (e.target.closest('#geo')) {
      navigator.geolocation?.getCurrentPosition((p) => { pos = { lat: p.coords.latitude, lng: p.coords.longitude }; load(); }, () => {}, { timeout: 8000 });
      return;
    }
    const a = e.target.closest('a[data-t]');
    if (a) track(a.dataset.t, { business_id: Number(a.dataset.b) });
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  load();
})();
