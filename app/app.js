/* Halte — prototype d'audioguide géolocalisé (sans serveur, sans compte). */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem('ta.' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem('ta.' + k, JSON.stringify(v)); } catch (_) {} }
  };

  /* ---------- État ---------- */
  var S = {
    places: [],
    cities: [],
    cats: [],
    city: store.get('city', ''),
    cat: store.get('cat', 'all'),
    pos: null,          // { lat, lon, acc, sim }
    simId: '',
    watchId: null,
    tracking: false,
    selected: null,
    offered: {},
    visited: new Set(store.get('visited', [])),
    autoOffer: store.get('auto', true),
    awake: true,
    rate: store.get('rate', 1),
    voiceURI: store.get('voice', ''),
    bannerFor: null,
    player: { placeId: null, mode: null, chunks: [], i: 0, state: 'idle', token: 0 }
  };
  var map;

  /* ---------- Utilitaires ---------- */
  function haversine(a, b) {
    var R = 6371000, toRad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toRad, dLon = (b.lon - a.lon) * toRad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function fmtDist(m) {
    if (m < 1000) return Math.round(m / 10) * 10 + ' m';
    if (m < 10000) return (m / 1000).toFixed(1).replace('.', ',') + ' km';
    return Math.round(m / 1000) + ' km';
  }
  function fmtWalk(m) {
    var min = Math.max(1, Math.round(m / 75));
    if (min > 90) return '';
    return min + ' min à pied';
  }
  function fmtDur(sec) {
    if (sec < 75) return Math.round(sec / 10) * 10 + ' s';
    return Math.round(sec / 60) + ' min';
  }
  function byId(id) { for (var i = 0; i < S.places.length; i++) if (S.places[i].id === id) return S.places[i]; return null; }
  function words(t) { return (t.match(/\S+/g) || []).length; }

  /* ---------- Chargement ---------- */
  function load() {
    if (window.__DATA__) return Promise.resolve(window.__DATA__);
    return fetch('data/lieux.json').then(function (r) { return r.json(); });
  }

  load().then(init).catch(function (e) {
    $('#list').innerHTML = '<p style="padding:16px">Impossible de charger les données (' + esc(e.message || e) + ').</p>';
  });

  function init(data) {
    S.cities = data.cities;
    S.cats = data.categories;
    var perCity = {};
    S.places = data.places.map(function (p) {
      perCity[p.city] = (perCity[p.city] || 0) + 1;
      p.order = perCity[p.city];
      p.expressSec = Math.round(words(p.express) / 2.5);
      p.histoireSec = Math.round(words(p.histoire) / 2.5);
      p._d = null;
      return p;
    });
    if (!cityById(S.city)) S.city = S.cities[0].id;

    var c0 = cityById(S.city);
    map = new TileMap($('#map'), { lat: c0.lat, lon: c0.lon, zoom: 15 });
    S.places.forEach(function (p) {
      map.addMarker(p.id, {
        lat: p.lat, lon: p.lon, label: p.name, html: String(p.order),
        className: S.visited.has(p.id) ? 'done' : '',
        onClick: function (id) { select(id, true); }
      });
    });

    $('#city').innerHTML = S.cities.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
    }).join('');
    $('#city').addEventListener('change', function () { setCity(this.value, true); });
    $('#cats').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-cat]');
      if (b) setCat(b.getAttribute('data-cat'));
    });
    applyFilter(true);
    requestAnimationFrame(function () { map._measure(); map.fitPoints(visiblePlaces()); });

    $('#zin').addEventListener('click', function () { map.zoomBy(1); });
    $('#zout').addEventListener('click', function () { map.zoomBy(-1); });
    $('#recenter').addEventListener('click', function () {
      if (S.pos && nearCity(S.pos) === S.city) map.setView(S.pos.lat, S.pos.lon, Math.max(map.z, 16));
      else map.fitPoints(visiblePlaces());
    });
    $('#btn-locate').addEventListener('click', toggleTracking);
    $('#btn-settings').addEventListener('click', function () { openSettings(); });
    $('#list').addEventListener('click', onListClick);

    setupSettings();

    if ('serviceWorker' in navigator && !window.__INLINE__ && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
    window.__ta = { S: S, setPosition: setPosition, startPlayback: startPlayback };
  }

  /* ---------- Écran allumé ---------- */
  var wake = null;
  function keepAwake(on) {
    try {
      if (!('wakeLock' in navigator)) return;
      if (on) {
        if (!S.awake || wake) return;
        navigator.wakeLock.request('screen').then(function (l) {
          wake = l;
          l.addEventListener('release', function () { wake = null; });
        }).catch(function () {});
      } else if (wake) {
        wake.release().catch(function () {});
        wake = null;
      }
    } catch (_) {}
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && (S.tracking || S.player.state === 'playing')) keepAwake(true);
  });

  /* ---------- Villes et catégories ---------- */
  function cityById(id) {
    for (var i = 0; i < S.cities.length; i++) if (S.cities[i].id === id) return S.cities[i];
    return null;
  }
  function catById(id) {
    for (var i = 0; i < S.cats.length; i++) if (S.cats[i].id === id) return S.cats[i];
    return null;
  }
  // Ville la plus proche d'une position (à moins de 40 km), sinon null.
  function nearCity(pos) {
    var best = null, bd = Infinity;
    S.cities.forEach(function (c) {
      var d = haversine(pos, c);
      if (d < bd) { bd = d; best = c; }
    });
    return bd < 40000 ? best.id : null;
  }
  function visiblePlaces() {
    return S.places.filter(function (p) {
      return p.city === S.city && (S.cat === 'all' || p.cats.indexOf(S.cat) >= 0);
    });
  }
  function cityPlaces() {
    return S.places.filter(function (p) { return p.city === S.city; });
  }

  function renderChips() {
    var inCity = cityPlaces();
    var used = S.cats.filter(function (c) {
      return inCity.some(function (p) { return p.cats.indexOf(c.id) >= 0; });
    });
    if (S.cat !== 'all' && !used.some(function (c) { return c.id === S.cat; })) S.cat = 'all';
    $('#cats').innerHTML = '<button type="button" data-cat="all" aria-pressed="' + (S.cat === 'all') + '">Tout</button>' +
      used.map(function (c) {
        return '<button type="button" data-cat="' + esc(c.id) + '" title="' + esc(c.hint) + '" aria-pressed="' + (S.cat === c.id) + '">' +
          c.icon + ' ' + esc(c.label) + '</button>';
      }).join('');
  }

  function applyFilter(fit) {
    $('#city').value = S.city;
    renderChips();
    var vis = {};
    visiblePlaces().forEach(function (p) { vis[p.id] = true; });
    S.places.forEach(function (p) { map.setMarkerVisible(p.id, !!vis[p.id]); });
    if (S.selected && !vis[S.selected]) { map.setMarkerClass(S.selected, 'sel', false); S.selected = null; }
    if (fit) map.fitPoints(visiblePlaces());
    renderListKeepScroll();
    defaultStatus();
  }

  function setCity(id, fit) {
    if (!cityById(id) || id === S.city) return;
    S.city = id; store.set('city', id);
    S.offered = {};
    applyFilter(fit);
  }
  function setCat(id) {
    S.cat = id; store.set('cat', id);
    S.offered = {};
    applyFilter(false);
    $('#list').scrollTop = 0;
  }

  function defaultStatus() {
    if (S.pos) { posStatus(); return; }
    var n = cityPlaces().length;
    setStatus(n + ' lieux');
  }

  /* ---------- Liste ---------- */
  function ctaHtml() {
    var arr = sortedPlaces();
    if (!arr.length) return '';
    if (S.pos && arr[0]._d != null && arr[0]._d < 40000) {
      var n = arr[0];
      return '<button type="button" class="cta" data-act="nearest">▶ Écouter le plus proche' +
        '<span class="cta-sub">' + esc(n.name) + ' · ' + fmtDist(n._d) + '</span></button>';
    }
    if (S.pos) return '';
    return '<button type="button" class="cta" data-act="locate">Me localiser pour commencer' +
      '<span class="cta-sub">L\'app vous propose chaque lieu quand vous en approchez</span></button>';
  }

  function sortedPlaces() {
    var arr = visiblePlaces();
    if (S.pos) arr.sort(function (a, b) { return a._d - b._d; });
    else arr.sort(function (a, b) { return a.order - b.order; });
    return arr;
  }

  function tagsHtml(p) {
    return p.cats.map(function (id) {
      var c = catById(id);
      return c ? '<span class="tag">' + c.icon + ' ' + esc(c.label) + '</span>' : '';
    }).join('');
  }

  function renderList() {
    var list = sortedPlaces();
    var html = list.map(function (p) {
      var done = S.visited.has(p.id);
      var dist = p._d == null || p._d > 40000 ? '' :
        '<div class="dist">' + fmtDist(p._d) + (fmtWalk(p._d) ? '<small>' + fmtWalk(p._d) + '</small>' : '') + '</div>';
      return '<article class="card' + (done ? ' done' : '') + (S.selected === p.id ? ' sel' : '') + '" data-id="' + esc(p.id) + '">' +
        '<div class="card-head"><span class="num">' + (done ? '✓' : p.order) + '</span>' +
        '<div class="card-title"><h2>' + esc(p.name) + '</h2><p>' + esc(p.tagline) + '</p>' +
        '<div class="tags">' + tagsHtml(p) + '</div></div>' + dist + '</div>' +
        '<div class="card-actions">' +
        '<button type="button" data-act="play" data-mode="express">▶ Express<small>' + fmtDur(p.expressSec) + '</small></button>' +
        '<button type="button" data-act="play" data-mode="histoire">▶ Histoire<small>' + fmtDur(p.histoireSec) + '</small></button></div>' +
        '</article>';
    }).join('');
    if (!list.length) html = '<p class="empty">Aucun lieu dans cette catégorie ici.</p>';
    $('#list').innerHTML = ctaHtml() + html;
  }

  function onListClick(e) {
    var btn = e.target.closest('button[data-act]');
    var card = e.target.closest('.card');
    if (!btn) { if (card) select(card.getAttribute('data-id'), true); return; }
    var act = btn.getAttribute('data-act');
    if (act === 'locate') { toggleTracking(); return; }
    if (act === 'nearest') { startPlayback(sortedPlaces()[0].id, 'express'); return; }
    if (act === 'play' && card) startPlayback(card.getAttribute('data-id'), btn.getAttribute('data-mode'));
  }

  function select(id, pan) {
    if (S.selected) map.setMarkerClass(S.selected, 'sel', false);
    S.selected = id;
    map.setMarkerClass(id, 'sel', true);
    var p = byId(id);
    if (pan && p) map.setView(p.lat, p.lon, Math.max(map.z, 16));
    var cards = document.querySelectorAll('.card');
    for (var i = 0; i < cards.length; i++) cards[i].classList.toggle('sel', cards[i].getAttribute('data-id') === id);
    var c = document.querySelector('.card[data-id="' + id + '"]');
    if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ---------- Position ---------- */
  function toggleTracking() {
    if (S.tracking) { stopTracking(); return; }
    if (!navigator.geolocation) { setStatus('La géolocalisation n\'est pas disponible sur cet appareil.'); return; }
    S.tracking = true;
    keepAwake(true);
    $('#btn-locate').classList.add('on');
    $('#btn-locate').textContent = 'Localisé ✓';
    setStatus('Recherche de votre position…');
    S.watchId = navigator.geolocation.watchPosition(function (g) {
      if (S.simId) return;
      setPosition(g.coords.latitude, g.coords.longitude, g.coords.accuracy, false);
    }, function (err) {
      var msg = err.code === 1 ? 'Localisation refusée : autorisez-la dans les réglages du navigateur.' :
        err.code === 2 ? 'Position indisponible pour le moment.' : 'Délai dépassé pour la localisation.';
      setStatus(msg);
      if (err.code === 1) stopTracking(true);
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }

  function stopTracking(keepStatus) {
    if (S.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(S.watchId);
    S.watchId = null; S.tracking = false;
    if (S.player.state !== 'playing') keepAwake(false);
    $('#btn-locate').classList.remove('on');
    $('#btn-locate').textContent = 'Me localiser';
    if (!S.simId) {
      S.pos = null;
      map.setUser(null);
      S.places.forEach(function (p) { p._d = null; });
      renderList();
      if (!keepStatus) defaultStatus();
    }
  }

  var firstFix = true;
  function setPosition(lat, lon, acc, sim) {
    S.pos = { lat: lat, lon: lon, acc: acc || 0, sim: !!sim };
    S.places.forEach(function (p) { p._d = haversine(S.pos, p); });
    map.setUser(lat, lon, acc);
    // Si l'on est dans une autre ville du guide, on y bascule (une fois par changement de ville).
    var here = nearCity(S.pos);
    if (here && here !== S.city && here !== S.lastAutoCity) { S.lastAutoCity = here; setCity(here, false); }
    else if (here) S.lastAutoCity = here;
    var nearest = sortedPlaces()[0];
    if (firstFix || sim) {
      firstFix = false;
      if (nearest && nearest._d < 5000) map.setView(lat, lon, 16);
    }
    posStatus();
    updateList();
    checkProximity();
  }

  function posStatus() {
    var nearest = sortedPlaces()[0];
    var c = cityById(S.city);
    if (!nearest) setStatus('');
    else if (nearest._d > 40000) setStatus('à ' + fmtDist(haversine(S.pos, c)));
    else if (S.pos.acc > 80 && !S.pos.sim) setStatus('position imprécise…');
    else setStatus(S.pos.sim ? 'mode démo' : 'vous êtes localisé');
  }

  // Met à jour les distances sur place ; ne reconstruit la liste que si l'ordre change.
  function updateList() {
    var order = sortedPlaces().map(function (p) { return p.id; }).join(',');
    var cards = document.querySelectorAll('.card');
    var domOrder = Array.prototype.map.call(cards, function (c) { return c.getAttribute('data-id'); }).join(',');
    var wantCta = !!(S.pos && sortedPlaces()[0] && sortedPlaces()[0]._d < 40000);
    if (order !== domOrder || !!document.querySelector('[data-act="nearest"]') !== wantCta ||
        (wantCta && !document.querySelector('.card .dist'))) { renderListKeepScroll(); return; }
    Array.prototype.forEach.call(cards, function (c) {
      var p = byId(c.getAttribute('data-id')), d = c.querySelector('.dist');
      if (d) d.innerHTML = fmtDist(p._d) + (fmtWalk(p._d) ? '<small>' + fmtWalk(p._d) + '</small>' : '');
    });
    var cs = document.querySelector('[data-act="nearest"] .cta-sub'), n0 = sortedPlaces()[0];
    if (cs && n0) cs.textContent = n0.name + ' · ' + fmtDist(n0._d);
  }

  function renderListKeepScroll() {
    var l = $('#list'), top = l.scrollTop;
    renderList();
    l.scrollTop = top;
  }

  function setStatus(t) { $('#status').textContent = t; }

  /* ---------- Proximité ---------- */
  function checkProximity() {
    if (!S.autoOffer || !S.pos) return;
    if (S.pos.acc > 80 && !S.pos.sim) return;
    var best = null;
    visiblePlaces().forEach(function (p) {
      if (p._d <= p.radius) {
        if (!S.offered[p.id] && (!best || p._d < best._d)) best = p;
      } else if (p._d > p.radius * 2) {
        delete S.offered[p.id];
      }
    });
    if (best) {
      S.offered[best.id] = true;
      showBanner(best);
    }
  }

  function showBanner(p) {
    S.bannerFor = p.id;
    var b = $('#banner');
    b.hidden = false;
    b.innerHTML = '<strong>Vous êtes près de : ' + esc(p.name) + '</strong>' +
      '<div class="row"><button type="button" data-b="express">▶ Express ' + fmtDur(p.expressSec) + '</button>' +
      '<button type="button" data-b="histoire">▶ Histoire ' + fmtDur(p.histoireSec) + '</button>' +
      '<button type="button" class="alt" data-b="later">Plus tard</button></div>';
    b.onclick = function (e) {
      var t = e.target.closest('button[data-b]');
      if (!t) return;
      var m = t.getAttribute('data-b');
      b.hidden = true;
      if (m !== 'later') startPlayback(p.id, m);
    };
    select(p.id, false);
    try { if (navigator.vibrate) navigator.vibrate(180); } catch (_) {}
  }

  /* ---------- Lecture vocale ---------- */
  function chunkText(text) {
    var out = [];
    text.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (para, pi) {
      var sents = para.match(/[^.!?…]+(?:[.!?…]+["»”)]*|$)/g) || [para];
      var cur = '';
      sents.forEach(function (s) {
        s = s.trim();
        if (!s) return;
        if (cur && (cur.length + s.length + 1) > 200) { out.push({ text: cur, para: pi }); cur = s; }
        else cur = cur ? cur + ' ' + s : s;
      });
      if (cur) out.push({ text: cur, para: pi });
    });
    return out;
  }

  function frenchVoices() {
    if (!('speechSynthesis' in window)) return [];
    return speechSynthesis.getVoices().filter(function (v) { return /^fr/i.test(v.lang); });
  }
  function currentVoice() {
    var vs = frenchVoices();
    if (!vs.length) return null;
    for (var i = 0; i < vs.length; i++) if (vs[i].voiceURI === S.voiceURI) return vs[i];
    var pref = vs.filter(function (v) { return /fr[-_]FR/i.test(v.lang); });
    var pool = pref.length ? pref : vs;
    var local = pool.filter(function (v) { return v.localService; });
    return (local.length ? local : pool)[0];
  }

  function startPlayback(placeId, mode) {
    var p = byId(placeId);
    if (!p) return;
    stopSpeech();
    var pl = S.player;
    pl.placeId = placeId; pl.mode = mode;
    pl.chunks = chunkText(p[mode]);
    pl.i = 0; pl.state = 'playing';
    keepAwake(true);
    buildPlayer(p);
    select(placeId, false);
    setTimeout(speakCurrent, 80);
  }

  function stopSpeech() {
    S.player.token++;
    if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (_) {} }
  }

  function speakCurrent() {
    var pl = S.player;
    if (pl.state !== 'playing') return;
    if (!('speechSynthesis' in window)) { fail('La synthèse vocale n\'est pas disponible sur ce navigateur. Vous pouvez lire le texte ci-dessous.'); return; }
    if (pl.i >= pl.chunks.length) { finish(); return; }
    var u = new SpeechSynthesisUtterance(pl.chunks[pl.i].text);
    var v = currentVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'fr-FR'; }
    u.rate = S.rate;
    var token = ++pl.token, started = false;
    u.onstart = function () { started = true; };
    u.onend = function () {
      if (pl.token !== token || pl.state !== 'playing') return;
      pl.i++; updatePlayer(); speakCurrent();
    };
    u.onerror = function (e) {
      if (pl.token !== token) return;
      if (e.error === 'canceled' || e.error === 'interrupted') return;
      fail('Erreur de synthèse vocale (' + e.error + '). Vous pouvez lire le texte ci-dessous.');
    };
    setTimeout(function () {
      if (pl.token === token && pl.state === 'playing' && !started) {
        fail('La voix ne démarre pas sur cet appareil. Vous pouvez lire le texte ci-dessous.');
      }
    }, 5000);
    try { speechSynthesis.speak(u); } catch (err) { fail('Synthèse vocale indisponible.'); }
    updatePlayer();
  }

  function fail(msg) {
    var pl = S.player;
    pl.state = 'error'; pl.token++;
    try { speechSynthesis.cancel(); } catch (_) {}
    var n = $('#pl-note');
    if (n) { n.hidden = false; n.textContent = msg; }
    var dt = document.querySelector('.player details'); if (dt) dt.open = true;
    updatePlayer();
  }

  function finish() {
    var pl = S.player;
    pl.state = 'done';
    if (!S.tracking) keepAwake(false);
    S.visited.add(pl.placeId);
    store.set('visited', Array.from(S.visited));
    map.setMarkerClass(pl.placeId, 'done', true);
    updatePlayer();
    renderListKeepScroll();
  }

  function pausePlayback() {
    var pl = S.player;
    if (pl.state !== 'playing') return;
    pl.state = 'paused'; stopSpeech(); updatePlayer();
  }
  function resumePlayback() {
    var pl = S.player;
    if (pl.state === 'done') pl.i = 0;
    pl.state = 'playing'; updatePlayer();
    var n = $('#pl-note'); if (n) n.hidden = true;
    setTimeout(speakCurrent, 80);
  }
  function closePlayer() {
    S.player.state = 'idle'; stopSpeech();
    if (!S.tracking) keepAwake(false);
    $('#player').hidden = true;
    $('#app').classList.remove('playing');
  }

  function buildPlayer(p) {
    var pl = S.player, el = $('#player');
    var paras = [];
    pl.chunks.forEach(function (c, i) {
      paras[c.para] = (paras[c.para] || '') + '<span data-i="' + i + '">' + esc(c.text) + '</span> ';
    });
    var noVoice = !('speechSynthesis' in window) || (frenchVoices().length === 0);
    el.hidden = false;
    $('#app').classList.add('playing');
    el.innerHTML =
      '<div class="player-top"><div><strong>' + esc(p.name) + '</strong><span id="pl-meta"></span></div>' +
      '<div class="ctrls"><button type="button" id="pl-speed" class="sm" aria-label="Vitesse">' + S.rate + '×</button>' +
      '<button type="button" id="pl-toggle" aria-label="Lecture / pause">❚❚</button>' +
      '<button type="button" id="pl-stop" aria-label="Fermer le lecteur">■</button></div></div>' +
      '<div class="bar"><i id="pl-bar"></i></div>' +
      '<p class="note" id="pl-note"' + (noVoice ? '' : ' hidden') + '>' +
      (noVoice ? 'Aucune voix française détectée sur cet appareil : installez-en une dans les réglages de synthèse vocale. Le texte reste lisible ci-dessous.' : '') + '</p>' +
      '<div id="pl-next" hidden></div>' +
      '<details' + (noVoice ? ' open' : '') + '><summary>Afficher le texte</summary><div class="transcript">' +
      paras.map(function (t) { return '<p>' + t + '</p>'; }).join('') + '</div>' +
      '<p class="src">Sources : ' + p.sources.map(function (s) {
        return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a>';
      }).join(' · ') + '</p></details>';
    $('#pl-toggle').addEventListener('click', function () {
      var st = S.player.state;
      if (st === 'playing') pausePlayback(); else resumePlayback();
    });
    $('#pl-stop').addEventListener('click', closePlayer);
    $('#pl-speed').addEventListener('click', function () {
      var rates = [0.9, 1, 1.15, 1.3];
      var idx = (rates.indexOf(Number(S.rate)) + 1) % rates.length;
      S.rate = rates[idx]; store.set('rate', S.rate);
      $('#opt-rate').value = String(S.rate);
      this.textContent = S.rate + '×';
      if (S.player.state === 'playing') { stopSpeech(); setTimeout(speakCurrent, 80); }
    });
    updatePlayer();
  }

  function nextPlace() {
    var cur = byId(S.player.placeId), ref = (S.pos && nearCity(S.pos) === S.city) ? S.pos : cur, best = null;
    visiblePlaces().forEach(function (p) {
      if (p.id === S.player.placeId || S.visited.has(p.id)) return;
      var d = haversine(ref, p);
      if (!best || d < best.d) best = { p: p, d: d };
    });
    return best;
  }

  function updatePlayer() {
    var pl = S.player;
    if ($('#player').hidden) return;
    var p = byId(pl.placeId);
    var label = pl.mode === 'express' ? 'Express' : 'Histoire';
    var stateTxt = { playing: 'lecture', paused: 'en pause', done: 'terminé', error: 'texte seul', idle: '' }[pl.state] || '';
    var meta = $('#pl-meta');
    if (meta && p) meta.textContent = label + ' · ' + stateTxt + ' · ' + Math.min(pl.i + 1, pl.chunks.length) + '/' + pl.chunks.length;
    var tg = $('#pl-toggle');
    if (tg) tg.textContent = pl.state === 'playing' ? '❚❚' : (pl.state === 'done' ? '↻' : '▶');
    var bar = $('#pl-bar');
    if (bar) bar.style.width = (pl.state === 'done' ? 100 : Math.round(pl.i / Math.max(1, pl.chunks.length) * 100)) + '%';
    var nx = $('#pl-next');
    if (nx) {
      if (pl.state === 'done') {
        var nxt = nextPlace();
        nx.hidden = false;
        nx.innerHTML = nxt
          ? '<button type="button" class="next" id="pl-go">Prochain lieu : ' + esc(nxt.p.name) + ' · ' + fmtDist(nxt.d) + '</button>'
          : '<p class="note ok">Bravo, vous avez écouté tous les lieux.</p>';
        var go = $('#pl-go');
        if (go) go.onclick = function () { closePlayer(); select(nxt.p.id, true); };
      } else { nx.hidden = true; nx.innerHTML = ''; }
    }
    var spans = document.querySelectorAll('.transcript span');
    for (var i = 0; i < spans.length; i++) {
      spans[i].classList.toggle('cur', pl.state !== 'done' && Number(spans[i].getAttribute('data-i')) === pl.i);
    }
    var cur = document.querySelector('.transcript span.cur');
    var box = document.querySelector('.player details');
    if (cur && box && pl.state === 'playing') box.scrollTop = Math.max(0, cur.offsetTop - box.clientHeight / 3);
  }

  /* ---------- Réglages ---------- */
  function setupSettings() {
    var d = $('#settings');
    $('#opt-auto').checked = S.autoOffer;
    $('#opt-auto').addEventListener('change', function () { S.autoOffer = this.checked; store.set('auto', S.autoOffer); });
    $('#opt-rate').value = String(S.rate);
    $('#opt-rate').addEventListener('change', function () { S.rate = Number(this.value); store.set('rate', S.rate); });
    $('#opt-voice').addEventListener('change', function () { S.voiceURI = this.value; store.set('voice', S.voiceURI); });
    var sim = $('#opt-sim');
    sim.innerHTML = '<option value="">Non (GPS réel)</option>' + S.cities.map(function (c) {
      return '<optgroup label="' + esc(c.name) + '">' + S.places.filter(function (p) { return p.city === c.id; }).map(function (p) {
        return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
    sim.addEventListener('change', function () {
      S.simId = this.value;
      if (S.simId) {
        var p = byId(S.simId);
        S.offered = {};
        if (S.cat !== 'all' && p.cats.indexOf(S.cat) < 0) { S.cat = 'all'; store.set('cat', 'all'); }
        if (p.city !== S.city) setCity(p.city, false); else applyFilter(false);
        S.lastAutoCity = p.city;
        setPosition(p.lat + 0.00008, p.lon, 10, true);
        d.close();
      } else {
        S.pos = null; map.setUser(null);
        S.places.forEach(function (q) { q._d = null; });
        renderList();
        defaultStatus();
        if (S.tracking) { stopTracking(true); toggleTracking(); }
      }
    });
    $('#btn-reset').addEventListener('click', function () {
      S.visited = new Set(); store.set('visited', []);
      S.places.forEach(function (p) { map.setMarkerClass(p.id, 'done', false); });
      renderListKeepScroll();
    });
    if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', fillVoices);
    fillVoices();
  }

  function fillVoices() {
    var sel = $('#opt-voice'), vs = frenchVoices();
    if (!vs.length) { sel.innerHTML = '<option value="">Aucune voix française détectée</option>'; return; }
    var cur = currentVoice();
    sel.innerHTML = vs.map(function (v) {
      return '<option value="' + esc(v.voiceURI) + '"' + (cur && cur.voiceURI === v.voiceURI ? ' selected' : '') + '>' +
        esc(v.name) + ' (' + esc(v.lang) + ')</option>';
    }).join('');
  }

  function openSettings() {
    fillVoices();
    var d = $('#settings');
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }
})();
