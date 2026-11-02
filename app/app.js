/* Halte — audioguide géolocalisé (sans serveur, sans compte). */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var store = {
    get: function (k, d) {
      try { var v = localStorage.getItem('halte.' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; }
    },
    set: function (k, v) { try { localStorage.setItem('halte.' + k, JSON.stringify(v)); } catch (_) {} }
  };
  // Ancien nom du projet (préfixe « ta. ») : on récupère les réglages et lieux écoutés une seule fois.
  try {
    ['cat', 'visited', 'rate', 'voice'].forEach(function (k) {
      var old = localStorage.getItem('ta.' + k);
      if (old != null && localStorage.getItem('halte.' + k) == null) localStorage.setItem('halte.' + k, old);
      localStorage.removeItem('ta.' + k);
    });
    ['ta.auto', 'ta.city', 'halte.auto', 'halte.city'].forEach(function (k) { localStorage.removeItem(k); });
  } catch (_) {}
  // Premier lancement : aucune trace d'une visite précédente.
  var firstVisit = (function () {
    try {
      for (var i = 0; i < localStorage.length; i++) if (/^halte\./.test(localStorage.key(i))) return false;
    } catch (_) { return false; }
    return true;
  })();

  var RATES = [0.9, 1, 1.15, 1.3];
  var REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- État ---------- */
  var S = {
    places: [], cities: [], cats: [],
    cat: store.get('cat', 'all'),
    pos: null,          // { lat, lon, acc, sim }
    geo: 'off',         // off | searching | on | denied | error | unavailable
    simId: '', watchId: null, tracking: false, follow: false,
    view: 'home',       // home | place
    sheet: 'peek',      // peek | half | full
    homeSheet: 'peek',
    selected: null, hereId: null, playerOpen: false,
    visited: new Set(store.get('visited', [])),
    rate: Number(store.get('rate', 1)) || 1,
    voiceURI: store.get('voice', ''),
    awake: true,
    player: { placeId: null, mode: null, chunks: [], i: 0, state: 'idle', token: 0, t0: 0 }
  };
  if (RATES.indexOf(S.rate) < 0) S.rate = 1;
  var map, app = $('#app'), sheetEl = $('#sheet'), scrollEl = $('#sheet-scroll');

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
    return min > 90 ? '' : min + ' min à pied';
  }
  function fmtDur(sec) {
    var s = Math.max(10, Math.round(sec / 10) * 10);
    if (s < 60) return s + ' s';
    var m = Math.floor(s / 60), r = s % 60;
    return m + ' min' + (r ? ' ' + r : '');
  }
  function fmtClock(sec) {
    sec = Math.max(0, Math.round(sec));
    var s = sec % 60;
    return Math.floor(sec / 60) + ':' + (s < 10 ? '0' : '') + s;
  }
  function byId(id) { for (var i = 0; i < S.places.length; i++) if (S.places[i].id === id) return S.places[i]; return null; }
  function words(t) { return (t.match(/\S+/g) || []).length; }
  function ic(name, cls) { return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function catById(id) { for (var i = 0; i < S.cats.length; i++) if (S.cats[i].id === id) return S.cats[i]; return null; }
  function tileHtml(p, extra) {
    return '<span class="tile' + (S.visited.has(p.id) ? ' is-done' : '') + (extra ? ' ' + extra : '') + '" data-cat="' + esc(p.cats[0]) + '" aria-hidden="true">' + ic(p.cats[0]) + '</span>';
  }
  function plural(n, one, many) { return n + ' ' + (n > 1 ? many : one); }
  function announce(msg) {
    var l = $('#live');
    l.textContent = '';
    setTimeout(function () { l.textContent = msg; }, 60);
  }
  function setInert(on, except) {
    ['#map', '.topbar', '#btn-locate', '#sheet', '#mini'].forEach(function (s) {
      if (s === except) return;
      var e = $(s);
      if (e) { if (on) e.setAttribute('inert', ''); else e.removeAttribute('inert'); }
    });
  }

  /* ---------- Chargement ---------- */
  function load() {
    if (window.__DATA__) return Promise.resolve(window.__DATA__);
    return fetch('data/lieux.json').then(function (r) { return r.json(); });
  }

  load().then(init).catch(function (e) {
    $('#peek').innerHTML = '<p class="place-tagline">Impossible de charger les données (' + esc(e.message || e) + ').</p>';
  });

  function init(data) {
    S.cities = data.cities;
    S.cats = data.categories;
    S.places = data.places.map(function (p, i) {
      p.order = i;
      p.expressSec = Math.round(words(p.express) / 2.5);
      p.histoireSec = Math.round(words(p.histoire) / 2.5);
      p._d = null;
      return p;
    });

    // Pas de liste de villes : la carte sert de sélecteur. Vue de la France au premier lancement,
    // puis la dernière zone regardée ; position de l'utilisateur dès qu'elle est connue.
    map = new TileMap($('#map'), {
      lat: 46.6, lon: 2.4, zoom: 6, minZoom: 5,
      onMove: onMapMove,
      onUserMove: function () { setFollow(false); }
    });
    S.places.forEach(function (p) {
      map.addMarker(p.id, {
        lat: p.lat, lon: p.lon, cat: p.cats[0], label: pinLabel(p), html: ic(p.cats[0]),
        className: S.visited.has(p.id) ? 'is-done' : '',
        onClick: function (id) { openPlace(id); }
      });
    });

    bindUI();
    bindSheet();
    setupSettings();
    var view = store.get('view', null);
    applyFilter();
    measure();
    requestAnimationFrame(function () {
      map._measure();
      measure();
      if (view && isFinite(view.lat) && isFinite(view.z)) map.setView(view.lat, view.lon, view.z);
      else map.fitPoints(filtered());
      refresh(true);
    });

    if ('serviceWorker' in navigator && !window.__INLINE__ && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }

    // Localisation déjà autorisée : on la relance sans rien demander. Sinon, écran d'accueil au premier lancement.
    var decided = false;
    function decide(granted) {
      if (decided) return;
      decided = true;
      if (granted) { store.set('onboarded', true); startTracking(); }
      else if (firstVisit && !store.get('onboarded', false)) showWelcome();
    }
    try {
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then(function (r) { decide(r.state === 'granted'); })
          .catch(function () { decide(false); });
        setTimeout(function () { decide(false); }, 1500);
      } else decide(false);
    } catch (_) { decide(false); }

    window.__halte = { S: S, map: map, setPosition: setPosition, startPlayback: startPlayback, openPlace: openPlace, setSheet: setSheet };
  }

  function pinLabel(p) { return p.name + (S.visited.has(p.id) ? ', déjà écouté' : ''); }

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

  /* ---------- Catégories et zone affichée ---------- */
  function filtered() {
    return S.places.filter(function (p) { return S.cat === 'all' || p.cats.indexOf(S.cat) >= 0; });
  }
  function visiblePlaces() {
    return filtered().filter(function (p) { return map.inView(p.lat, p.lon, 4); });
  }
  function nearestFrom(ref, list) {
    var best = null;
    (list || filtered()).forEach(function (p) {
      var d = haversine(ref, p);
      if (!best || d < best.d) best = { p: p, d: d };
    });
    return best;
  }
  function sortedVisible() {
    var arr = visiblePlaces(), ref = S.pos || map.center();
    arr.forEach(function (p) { p._s = S.pos ? p._d : haversine(ref, p); });
    arr.sort(function (a, b) { return a._s - b._s; });
    return arr;
  }

  function renderChips() {
    var used = S.cats.filter(function (c) {
      return S.places.some(function (p) { return p.cats.indexOf(c.id) >= 0; });
    });
    if (S.cat !== 'all' && !used.some(function (c) { return c.id === S.cat; })) S.cat = 'all';
    $('#cats').innerHTML = '<button type="button" class="chip" data-cat-filter="all" aria-pressed="' + (S.cat === 'all') + '">Tout</button>' +
      used.map(function (c) {
        return '<button type="button" class="chip" data-cat="' + esc(c.id) + '" data-cat-filter="' + esc(c.id) + '" title="' + esc(c.hint) +
          '" aria-pressed="' + (S.cat === c.id) + '">' + ic(c.id) + esc(c.label) + '</button>';
      }).join('');
  }

  function applyFilter() {
    renderChips();
    var vis = {};
    filtered().forEach(function (p) { vis[p.id] = true; });
    S.places.forEach(function (p) { map.setMarkerVisible(p.id, !!vis[p.id]); });
    refresh(true);
  }

  function setCat(id) {
    S.cat = id;
    store.set('cat', id);
    applyFilter();
  }

  var moveT = null;
  function onMapMove() {
    if (!map) return;
    clearTimeout(moveT);
    moveT = setTimeout(function () {
      var c = map.center();
      store.set('view', { lat: +c.lat.toFixed(5), lon: +c.lon.toFixed(5), z: map.z });
      refresh(false);
    }, 150);
  }

  /* ---------- « Vous y êtes » : le lieu dans le rayon duquel on se trouve ---------- */
  function computeHere() {
    var here = null;
    if (S.pos && (S.pos.sim || S.pos.acc <= 80)) {
      filtered().forEach(function (p) {
        if (p._d != null && p._d <= p.radius && (!here || p._d < here._d)) here = p;
      });
    }
    var id = here ? here.id : null;
    if (id !== S.hereId) {
      if (S.hereId) map.setMarkerClass(S.hereId, 'is-here', false);
      S.hereId = id;
      if (id) { map.setMarkerClass(id, 'is-here', true); announce('Vous êtes à : ' + here.name); }
    }
    return here;
  }

  // Ce que propose le panneau replié : le lieu où l'on est (s'il n'est pas encore écouté),
  // sinon le plus proche pas encore écouté, sinon le plus proche.
  function peekModel() {
    if (!S.pos) return { kind: S.geo === 'on' ? 'off' : S.geo };
    var here = S.hereId ? byId(S.hereId) : null, best = null, bestU = null;
    filtered().forEach(function (p) {
      if (!best || p._d < best._d) best = p;
      if (!S.visited.has(p.id) && (!bestU || p._d < bestU._d)) bestU = p;
    });
    if (here && !S.visited.has(here.id)) return { kind: 'here', p: here };
    var t = bestU || best;
    if (!t) return { kind: 'empty' };
    if (t._d > 40000) return { kind: 'far', p: t };
    return { kind: here === t ? 'here' : 'near', p: t };
  }

  /* ---------- Panneau : carte du haut ---------- */
  function playLabel(p, mode) {
    var pl = S.player;
    if (pl.placeId === p.id && pl.mode === mode && pl.state === 'playing') return { icon: 'pause', text: 'Pause' };
    if (pl.placeId === p.id && pl.mode === mode && pl.state === 'paused') return { icon: 'play', text: 'Reprendre' };
    return { icon: 'play', text: mode === 'express' ? 'Écouter' : 'Version longue' };
  }
  function ctasHtml(p) {
    var a = playLabel(p, 'express'), b = playLabel(p, 'histoire');
    return '<div class="btn-row">' +
      '<button type="button" class="btn btn--primary" data-act="play" data-mode="express" data-id="' + esc(p.id) + '">' + ic(a.icon, 'ic--fill') +
      a.text + (a.text === 'Écouter' ? ' <span class="btn__meta">' + fmtDur(p.expressSec) + '</span>' : '') + '</button>' +
      '<button type="button" class="btn btn--secondary btn--stack" data-act="play" data-mode="histoire" data-id="' + esc(p.id) + '">' +
      (b.text === 'Version longue' ? 'Version longue<span class="btn__meta">' + fmtDur(p.histoireSec) + '</span>' : b.text + '<span class="btn__meta">version longue</span>') + '</button></div>';
  }
  function progressHtml(vis) {
    var k = vis.filter(function (p) { return S.visited.has(p.id); }).length;
    if (!k) return '';
    return '<span class="progress-txt"><span class="ring" style="--p:' + Math.round(k / vis.length * 100) + '" aria-hidden="true"></span>' +
      k + ' sur ' + vis.length + ' écouté' + (k > 1 ? 's' : '') + '</span>';
  }

  function renderPeek(m, vis) {
    var n = vis.length, zone = n ? plural(n, 'lieu', 'lieux') + ' dans cette zone' : 'Aucun lieu dans cette zone';
    var listBtn = '<button type="button" class="btn btn--secondary" data-act="expand">Voir la liste</button>';
    var h = '';
    function head(eyebrow, title, tag) {
      return (eyebrow ? '<p class="peek__label">' + eyebrow + '</p>' : '') + '<h2 class="place-title">' + title + '</h2>' +
        (tag ? '<p class="place-tagline">' + tag + '</p>' : '');
    }
    switch (m.kind) {
      case 'off':
        h = head(esc(zone), 'Écoutez les lieux autour de vous', 'Activez la localisation : Halte vous montre le lieu le plus proche et vous le raconte.') +
          '<div class="btn-row"><button type="button" class="btn btn--primary" data-act="locate">' + ic('locate') + 'Me localiser</button>' + listBtn + '</div>';
        break;
      case 'searching':
        h = head(esc(zone), 'Recherche de votre position…', 'Quelques secondes, de préférence à découvert.') + '<div class="btn-row">' + listBtn + '</div>';
        break;
      case 'denied':
        h = head('', 'Localisation refusée', 'Autorisez-la dans les réglages du navigateur, ou explorez la carte.') + '<div class="btn-row">' + listBtn + '</div>';
        break;
      case 'error':
        h = head('', 'Position indisponible', 'Réessayez dans un instant, ou explorez la carte.') +
          '<div class="btn-row"><button type="button" class="btn btn--primary" data-act="locate">' + ic('locate') + 'Réessayer</button>' + listBtn + '</div>';
        break;
      case 'unavailable':
        h = head(esc(zone), 'Localisation indisponible', 'Cet appareil ne donne pas sa position : explorez la carte.') + '<div class="btn-row">' + listBtn + '</div>';
        break;
      case 'empty':
        h = head('', 'Aucun lieu pour ce filtre', '') +
          '<div class="btn-row"><button type="button" class="btn btn--secondary" data-act="cat-all">Voir toutes les catégories</button></div>';
        break;
      case 'far':
        h = '<p class="peek__label">Aucun lieu près de vous</p>' +
          '<button type="button" class="peek__open" data-act="open" data-id="' + esc(m.p.id) + '"><h2 class="place-title">' + esc(m.p.name) + '</h2>' +
          '<p class="place-tagline">Le plus proche, à <b data-dist>' + fmtDist(m.p._d) + '</b></p></button>' +
          '<div class="btn-row"><button type="button" class="btn btn--primary" data-act="open" data-id="' + esc(m.p.id) + '">Voir sur la carte</button>' + listBtn + '</div>';
        break;
      default: // here | near
        var p = m.p;
        h = '<div class="peek__top">' + (m.kind === 'here'
          ? '<span class="badge badge--here">Vous y êtes</span>'
          : '<span class="peek__label">Le plus proche · <b data-dist>' + fmtDist(p._d) + '</b> · <span data-walk>' + fmtWalk(p._d) + '</span></span>') +
          progressHtml(vis) + '</div>' +
          '<button type="button" class="peek__open" data-act="open" data-id="' + esc(p.id) + '" aria-label="' + esc(p.name) + ' : voir la fiche">' +
          '<h2 class="place-title">' + esc(p.name) + '</h2><p class="place-tagline">' + esc(p.tagline) + '</p></button>' +
          ctasHtml(p) +
          (n > 1 ? '<button type="button" class="more" data-act="expand">Voir les ' + n + ' lieux autour' + ic('up') + '</button>' : '');
    }
    $('#peek').innerHTML = '<div class="peek" data-kind="' + m.kind + '"' + (m.p ? ' data-id="' + esc(m.p.id) + '"' : '') + '>' + h + '</div>';
  }

  function updatePeekDist(m) {
    if (!m.p) return;
    var d = $('#peek [data-dist]'), w = $('#peek [data-walk]');
    if (d) d.textContent = fmtDist(m.p._d);
    if (w) w.textContent = fmtWalk(m.p._d);
  }

  /* ---------- Panneau : liste ---------- */
  function rowSub(p) {
    if (S.hereId === p.id) return '<span class="place__here">Vous y êtes</span> · ' + esc(p.tagline);
    var d = p._d != null && p._d <= 40000 ? '<b class="d">' + fmtDist(p._d) + '</b> · ' : '';
    return d + (S.visited.has(p.id) ? 'Écouté' : esc(p.tagline));
  }
  function rowPlay(p) {
    var a = playLabel(p, 'express');
    var label = a.text === 'Pause' ? 'Mettre en pause' : a.text === 'Reprendre' ? 'Reprendre' : 'Écouter ' + p.name + ' (' + fmtDur(p.expressSec) + ')';
    return '<button type="button" class="icon-btn" data-act="play" data-mode="express" data-id="' + esc(p.id) + '" aria-label="' + esc(label) + '">' +
      ic(a.icon, 'ic--fill') + '</button>';
  }
  function renderList(vis) {
    var html = vis.map(function (p) {
      return '<li class="place' + (S.hereId === p.id ? ' is-here' : '') + '" data-id="' + esc(p.id) + '">' +
        '<button type="button" class="place__main" data-act="open" data-id="' + esc(p.id) + '">' + tileHtml(p) +
        '<span class="place__text"><span class="place__name">' + esc(p.name) + '</span><span class="place__sub">' + rowSub(p) + '</span></span></button>' +
        rowPlay(p) + '</li>';
    }).join('');
    if (!vis.length) {
      var n = nearestFrom(S.pos || map.center());
      html = '<li class="empty"><p>Aucun lieu dans cette zone de la carte.</p>' + (n
        ? '<button type="button" class="btn btn--secondary btn--sm goto" data-act="open" data-id="' + esc(n.p.id) + '">Voir le plus proche : ' +
          esc(n.p.name) + ' · ' + fmtDist(n.d) + '</button>' : '') + '</li>';
    }
    $('#list').innerHTML = html;
  }
  function updateListDist() {
    $$('#list .place').forEach(function (li) {
      var p = byId(li.getAttribute('data-id')), d = li.querySelector('.d');
      if (d && p._d != null) d.textContent = fmtDist(p._d);
    });
  }
  function renderListHead(vis) {
    $('#list-title').textContent = S.pos ? 'Autour de vous' : 'Dans cette zone';
    var k = vis.filter(function (p) { return S.visited.has(p.id); }).length;
    $('#list-sub').textContent = vis.length ? plural(vis.length, 'lieu', 'lieux') + (k ? ' · ' + k + ' écouté' + (k > 1 ? 's' : '') : '') : 'Aucun lieu ici';
    var r = $('#list-ring');
    r.hidden = !k;
    r.style.setProperty('--p', vis.length ? Math.round(k / vis.length * 100) : 0);
  }

  var listKey = '', peekKey = '';
  function refresh(force) {
    if (!map) return;
    computeHere();
    var vis = sortedVisible(), m = peekModel(), pl = S.player;
    var playKey = pl.placeId + ':' + pl.mode + ':' + pl.state;
    var pk = [m.kind, m.p ? m.p.id : '', vis.length, S.visited.size, S.cat, playKey].join('|');
    if (force || pk !== peekKey) { peekKey = pk; renderPeek(m, vis); } else updatePeekDist(m);
    var lk = vis.map(function (p) { return p.id; }).join(',') + '|' + S.hereId + '|' + S.visited.size + '|' + playKey + '|' + !!S.pos;
    if (force || lk !== listKey) {
      listKey = lk;
      var top = scrollEl.scrollTop;
      renderList(vis);
      if (S.view === 'home') scrollEl.scrollTop = top;
    } else updateListDist();
    renderListHead(vis);
    if (S.view === 'place') updatePlaceDist();
  }

  /* ---------- Panneau du bas : 3 hauteurs ---------- */
  var H = { peek: 220, half: 420, full: 640 }, probe = null;
  function safeBottom() {
    if (!probe) {
      probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none';
      document.body.appendChild(probe);
    }
    return probe.offsetHeight || 0;
  }
  function miniSpace() { return $('#mini').hidden ? 0 : 82; }
  function measure() {
    var vh = app.clientHeight;
    app.style.setProperty('--mini-space', miniSpace() + 'px');
    H.full = sheetEl.offsetHeight || vh;
    H.half = Math.min(H.full, Math.round(vh * 0.58));
    var el = S.view === 'place' ? $('#place') : $('#peek');
    H.peek = Math.min(H.full, $('#sheet-handle').offsetHeight - 8 + el.offsetHeight + safeBottom() + miniSpace() + 6);
    if (map) {
      var tb = $('.topbar').getBoundingClientRect(), ar = app.getBoundingClientRect();
      map.setPadding(Math.round(tb.bottom - ar.top + 6), Math.round(H.peek));
    }
    applySheet();
  }
  function applySheet(vis) {
    var v = vis == null ? H[S.sheet] : vis;
    sheetEl.style.transform = 'translateY(' + Math.max(0, Math.round(H.full - v)) + 'px)';
    app.style.setProperty('--sheet-y', Math.round(Math.min(v, H.full)) + 'px');
  }
  function setSheet(st) {
    if (S.view === 'place') st = 'peek';
    S.sheet = st;
    sheetEl.setAttribute('data-state', st);
    app.classList.toggle('sheet-up', st !== 'peek');
    var h = $('#sheet-handle');
    h.setAttribute('aria-expanded', String(st !== 'peek'));
    h.setAttribute('aria-label', st === 'peek' ? 'Agrandir la liste des lieux' : 'Réduire la liste des lieux');
    if (st === 'peek') { $('#list-section').setAttribute('inert', ''); scrollEl.scrollTop = 0; }
    else $('#list-section').removeAttribute('inert');
    applySheet();
  }
  function toggleSheet() {
    if (S.view === 'place') return;
    setSheet(S.sheet === 'peek' ? 'half' : 'peek');
  }

  // Glisser le panneau : depuis la poignée, ou depuis n'importe où dans le panneau quand son contenu
  // est tout en haut (vers le bas = réduire / fermer la fiche ; vers le haut = agrandir la liste).
  // Souris et stylet : événements « pointer ». Doigt : événements « touch » (pour reprendre la main
  // sur le défilement du contenu quand on tire vers le bas).
  function bindSheet() {
    var d = null, suppressClick = false;
    function begin(y, t, onHandle) {
      d = { y0: y, v0: H[S.sheet], y: y, t: t, vel: 0, vis: H[S.sheet], moved: false, handle: onHandle };
    }
    function move(y, t) {
      var dy = d.y0 - y;
      if (!d.moved) { d.moved = true; sheetEl.classList.add('dragging'); }
      var dt = Math.max(1, t - d.t);
      d.vel = 0.7 * ((d.y - y) / dt) + 0.3 * d.vel;
      d.y = y; d.t = t;
      var max = S.view === 'place' ? H.peek : H.full;
      d.vis = Math.max(H.peek * 0.3, Math.min(max, d.v0 + dy));
      applySheet(d.vis);
    }
    function finish() {
      var dd = d;
      d = null;
      sheetEl.classList.remove('dragging');
      if (!dd || !dd.moved) return;
      suppressClick = true;
      setTimeout(function () { suppressClick = false; }, 0);
      if (S.view === 'place') {
        if (dd.vis < H.peek * 0.8 || dd.vel < -0.35) uiBack('place'); else applySheet();
        return;
      }
      var st = ['peek', 'half', 'full'].map(function (s) { return { s: s, h: H[s] }; }), t;
      if (dd.vel > 0.35) t = st.filter(function (x) { return x.h > dd.vis + 1; })[0] || st[2];
      else if (dd.vel < -0.35) t = st[0]; // vers le bas d'un geste : on replie franchement
      else t = st.reduce(function (a, b) { return Math.abs(b.h - dd.vis) < Math.abs(a.h - dd.vis) ? b : a; });
      setSheet(t.s);
    }
    // Un glissé ne doit pas déclencher le bouton sous le doigt.
    sheetEl.addEventListener('click', function (e) {
      if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; }
    }, true);

    /* Souris, stylet */
    var pid = null;
    sheetEl.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch' || e.button > 0) return;
      var onHandle = !!e.target.closest('#sheet-handle');
      if (!onHandle) {
        if (e.target.closest('button, a, select, summary, input')) return;
        if (scrollEl.scrollTop > 0) return;
      }
      pid = e.pointerId;
      begin(e.clientY, e.timeStamp, onHandle);
    });
    window.addEventListener('pointermove', function (e) {
      if (!d || e.pointerId !== pid) return;
      if (!d.moved && Math.abs(d.y0 - e.clientY) < 6) return;
      move(e.clientY, e.timeStamp);
    });
    function pend(e) {
      if (!d || e.pointerId !== pid) return;
      pid = null;
      if (!d.moved) { var h = d.handle; d = null; if (h && e.type === 'pointerup') toggleSheet(); return; }
      finish();
    }
    window.addEventListener('pointerup', pend);
    window.addEventListener('pointercancel', pend);

    /* Doigt */
    var tc = null; // { id, y0, mode: null | 'sheet' | 'scroll', handle }
    sheetEl.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { tc = null; if (d) finish(); return; }
      var t = e.touches[0];
      tc = { id: t.identifier, y0: t.clientY, mode: null, handle: !!e.target.closest('#sheet-handle'), top: scrollEl.scrollTop <= 0 };
    }, { passive: true });
    sheetEl.addEventListener('touchmove', function (e) {
      if (!tc || tc.mode === 'scroll') return;
      var t = null;
      for (var i = 0; i < e.touches.length; i++) if (e.touches[i].identifier === tc.id) t = e.touches[i];
      if (!t) return;
      var dy = t.clientY - tc.y0; // > 0 : le doigt descend
      if (!tc.mode) {
        var scrollable = scrollEl.scrollHeight > scrollEl.clientHeight + 1 && getComputedStyle(scrollEl).overflowY !== 'hidden';
        var atTop = scrollEl.scrollTop <= 0 && tc.top;
        // Le doigt descend et le contenu est en haut : on tire le panneau.
        var wantSheet = tc.handle || !scrollable || (dy > 0 && atTop);
        if (!wantSheet && dy > 0 && !atTop) { tc.mode = 'scroll'; return; }
        if (!wantSheet && dy < 0 && Math.abs(dy) >= 4) {
          // Vers le haut : on agrandit la liste tant qu'elle n'est pas en plein écran, sinon on fait défiler.
          if (S.view === 'home' && S.sheet !== 'full') wantSheet = true; else { tc.mode = 'scroll'; return; }
        }
        if (e.cancelable && (wantSheet || dy >= 0)) e.preventDefault();
        if (!wantSheet || Math.abs(dy) < 6) return;
        tc.mode = 'sheet';
        begin(tc.y0, e.timeStamp, tc.handle);
      }
      if (e.cancelable) e.preventDefault();
      move(t.clientY, e.timeStamp);
    }, { passive: false });
    function tend(e) {
      if (!tc) return;
      var c = tc;
      tc = null;
      if (c.mode === 'sheet') { finish(); if (e.cancelable) e.preventDefault(); return; }
      if (!c.mode && c.handle && e.type === 'touchend') { if (e.cancelable) e.preventDefault(); toggleSheet(); }
    }
    sheetEl.addEventListener('touchend', tend, { passive: false });
    sheetEl.addEventListener('touchcancel', tend, { passive: false });

    // Clavier / lecteur d'écran (pas de pointeur) : bascule replié ↔ moitié.
    $('#sheet-handle').addEventListener('click', function (e) { if (e.detail === 0) toggleSheet(); });
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () { measure(); });
      ro.observe($('#peek')); ro.observe($('#place')); ro.observe(app);
    }
    window.addEventListener('resize', measure);
  }

  /* ---------- Historique : le bouton « retour » ferme la fiche ou le lecteur ---------- */
  var layers = [], afterPop = null;
  function pushLayer(name) {
    layers.push(name);
    try { history.pushState({ halte: name }, ''); } catch (_) {}
  }
  function uiBack(name) {
    var i = layers.lastIndexOf(name);
    if (i < 0) { closeLayer(name); return; }
    if (i === layers.length - 1 && history.state && history.state.halte === name) { history.back(); return; }
    layers.splice(i, 1);
    closeLayer(name);
  }
  function closeLayer(name) {
    if (name === 'place') closePlace();
    else if (name === 'player') minimizePlayer();
  }
  window.addEventListener('popstate', function () {
    var name = layers.pop();
    if (name) closeLayer(name);
    if (afterPop) { var f = afterPop; afterPop = null; f(); }
  });

  /* ---------- Fiche lieu ---------- */
  function routeUrl(p) {
    var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return ios ? 'https://maps.apple.com/?daddr=' + p.lat + ',' + p.lon + '&dirflg=w'
      : 'https://www.google.com/maps/dir/?api=1&destination=' + p.lat + ',' + p.lon + '&travelmode=walking';
  }
  function placeMeta(p) {
    var parts = [];
    if (S.hereId === p.id) parts.push('<span class="badge badge--here">Vous y êtes</span>');
    else if (p._d != null) parts.push('<span><b data-dist>' + fmtDist(p._d) + '</b>' + (fmtWalk(p._d) ? ' · <span data-walk>' + fmtWalk(p._d) + '</span>' : '') + '</span>');
    if (S.visited.has(p.id)) parts.push('<span class="done-txt">' + ic('check', 'ic--sm') + 'Écouté</span>');
    return parts.join('');
  }
  function renderPlace() {
    var p = byId(S.selected);
    if (!p) return;
    var tags = p.cats.map(function (id) {
      var c = catById(id);
      return c ? '<span class="tag" data-cat="' + esc(id) + '">' + ic(id) + esc(c.label) + '</span>' : '';
    }).join('');
    var a = playLabel(p, 'express'), b = playLabel(p, 'histoire');
    $('#place').innerHTML = '<article class="fiche" data-id="' + esc(p.id) + '">' +
      '<button type="button" class="icon-btn fiche__close" data-act="close" aria-label="Fermer la fiche">' + ic('close') + '</button>' +
      '<div class="tags">' + tags + '</div>' +
      '<h2 class="place-title" tabindex="-1">' + esc(p.name) + '</h2>' +
      '<p class="place-tagline">' + esc(p.tagline) + '</p>' +
      '<p class="place-meta">' + placeMeta(p) + '</p>' +
      '<button type="button" class="btn btn--primary btn--block" data-act="play" data-mode="express" data-id="' + esc(p.id) + '">' + ic(a.icon, 'ic--fill') + a.text +
      (a.text === 'Écouter' ? ' <span class="btn__meta">' + fmtDur(p.expressSec) + '</span>' : '') + '</button>' +
      '<div class="btn-row">' +
      '<button type="button" class="btn btn--secondary btn--stack" data-act="play" data-mode="histoire" data-id="' + esc(p.id) + '">' +
      (b.text === 'Version longue' ? 'Version longue<span class="btn__meta">' + fmtDur(p.histoireSec) + '</span>' : b.text + '<span class="btn__meta">version longue</span>') + '</button>' +
      '<a class="btn btn--secondary" href="' + esc(routeUrl(p)) + '" target="_blank" rel="noopener">' + ic('route') + 'Itinéraire</a></div>' +
      '<details class="sources"><summary>' + ic('doc') + '<span>Sources (' + p.sources.length + ')</span></summary><ul>' +
      p.sources.map(function (s) { return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a></li>'; }).join('') +
      '</ul></details></article>';
  }
  function updatePlaceDist() {
    var p = byId(S.selected);
    if (!p) return;
    var meta = $('#place .place-meta');
    if (!meta) return;
    var d = meta.querySelector('[data-dist]');
    if ((S.hereId === p.id) !== !!meta.querySelector('.badge--here') || (!d && p._d != null)) { meta.innerHTML = placeMeta(p); return; }
    if (d) d.textContent = fmtDist(p._d);
    var w = meta.querySelector('[data-walk]');
    if (w) w.textContent = fmtWalk(p._d);
  }
  function openPlace(id) {
    var p = byId(id);
    if (!p) return;
    if (S.view !== 'place') { S.homeSheet = S.sheet; pushLayer('place'); }
    if (S.selected && S.selected !== id) map.setMarkerClass(S.selected, 'pin--sel', false);
    S.selected = id;
    map.setMarkerClass(id, 'pin--sel', true);
    S.view = 'place';
    $('#view-home').hidden = true;
    $('#view-place').hidden = false;
    sheetEl.setAttribute('data-view', 'place');
    renderPlace();
    scrollEl.scrollTop = 0;
    setSheet('peek');
    measure();
    setFollow(false);
    map.flyTo(p.lat, p.lon, Math.max(map.z, 16));
    var t = $('#place .place-title');
    if (t) try { t.focus({ preventScroll: true }); } catch (_) {}
  }
  function closePlace() {
    if (S.view !== 'place') return;
    S.view = 'home';
    if (S.selected) map.setMarkerClass(S.selected, 'pin--sel', false);
    var last = S.selected;
    S.selected = null;
    $('#view-place').hidden = true;
    $('#view-home').hidden = false;
    sheetEl.setAttribute('data-view', 'home');
    setSheet(S.homeSheet || 'peek');
    measure();
    refresh(true);
    // Rend le focus à l'élément d'où l'on venait (clavier, lecteur d'écran).
    var b = (S.sheet !== 'peek' && $('#list [data-id="' + last + '"] .place__main')) || $('#peek .peek__open') || $('#sheet-handle');
    if (b) try { b.focus({ preventScroll: true }); } catch (_) {}
  }

  /* ---------- Position ---------- */
  function setFollow(on) {
    S.follow = !!on && S.tracking;
    var b = $('#btn-locate');
    b.setAttribute('aria-pressed', String(S.follow));
    b.setAttribute('aria-label', S.tracking ? (S.follow ? 'La carte suit votre position' : 'Recentrer sur ma position') : 'Me localiser');
  }
  function startTracking() {
    if (S.tracking) return;
    if (!navigator.geolocation) { S.geo = 'unavailable'; refresh(true); return; }
    S.tracking = true;
    S.geo = S.pos ? 'on' : 'searching';
    setFollow(true);
    keepAwake(true);
    refresh(true);
    S.watchId = navigator.geolocation.watchPosition(function (g) {
      if (S.simId) return;
      S.geo = 'on';
      setPosition(g.coords.latitude, g.coords.longitude, g.coords.accuracy, false);
    }, function (err) {
      if (err.code === 1) { S.geo = 'denied'; stopTracking(); }
      else if (!S.pos) S.geo = 'error';
      refresh(true);
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }
  function stopTracking() {
    if (S.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(S.watchId);
    S.watchId = null;
    S.tracking = false;
    setFollow(false);
    if (S.player.state !== 'playing') keepAwake(false);
    if (!S.simId) {
      S.pos = null;
      map.setUser(null);
      S.places.forEach(function (p) { p._d = null; });
    }
    refresh(true);
  }
  function onLocate() {
    if (!S.tracking && !S.simId) { startTracking(); return; }
    setFollow(true);
    if (S.pos) {
      if (S.view === 'place') uiBack('place');
      map.flyTo(S.pos.lat, S.pos.lon, Math.max(map.z, 16));
    }
  }

  // Cadre de départ : vous + jusqu'à 3 lieux proches (à moins de 3 km), sinon vous + le plus proche.
  function frameUser() {
    var near = filtered().slice().sort(function (a, b) { return a._d - b._d; });
    var pts = near.filter(function (p) { return p._d < 3000; }).slice(0, 3);
    if (!pts.length && near.length && near[0]._d < 40000) pts = [near[0]];
    if (pts.length) map.fitPoints([S.pos].concat(pts), 60, 16);
    else map.setView(S.pos.lat, S.pos.lon, 15);
  }

  var firstFix = true;
  function setPosition(lat, lon, acc, sim) {
    S.pos = { lat: lat, lon: lon, acc: acc || 0, sim: !!sim };
    S.geo = 'on';
    S.places.forEach(function (p) { p._d = haversine(S.pos, p); });
    map.setUser(lat, lon, acc);
    if (firstFix || sim) {
      firstFix = false;
      if (S.view === 'place' && sim) uiBack('place');
      frameUser();
      if (S.tracking) setFollow(true);
    } else if (S.follow && S.view === 'home' && !map.inView(lat, lon, -60)) {
      map.flyTo(lat, lon);
    }
    refresh(false);
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
    out.forEach(function (c) { c.words = words(c.text); });
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
    pl.i = 0; pl.state = 'playing'; pl.t0 = 0;
    keepAwake(true);
    buildPlayer(p);
    showMini();
    announce('Lecture : ' + p.name);
    setTimeout(speakCurrent, 80);
    syncPlayingUI();
  }

  function stopSpeech() {
    S.player.token++;
    if ('speechSynthesis' in window) { try { speechSynthesis.cancel(); } catch (_) {} }
  }

  function speakCurrent() {
    var pl = S.player;
    if (pl.state !== 'playing') return;
    if (!('speechSynthesis' in window)) { fail('La lecture à voix haute n\'est pas disponible sur ce navigateur. Vous pouvez lire le texte ci-dessous.'); return; }
    if (pl.i >= pl.chunks.length) { finish(); return; }
    var u = new SpeechSynthesisUtterance(pl.chunks[pl.i].text);
    var v = currentVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'fr-FR'; }
    u.rate = S.rate;
    var token = ++pl.token, started = false;
    u.onstart = function () { started = true; if (pl.token === token) pl.t0 = performance.now(); };
    u.onend = function () {
      if (pl.token !== token || pl.state !== 'playing') return;
      pl.i++; pl.t0 = 0;
      updatePlayer();
      speakCurrent();
    };
    u.onerror = function (e) {
      if (pl.token !== token) return;
      if (e.error === 'canceled' || e.error === 'interrupted') return;
      fail('La voix du téléphone ne répond pas. Vous pouvez lire le texte ci-dessous, ou réessayer.');
    };
    setTimeout(function () {
      if (pl.token === token && pl.state === 'playing' && !started) {
        fail('La voix ne démarre pas sur cet appareil. Vous pouvez lire le texte ci-dessous, ou réessayer.');
      }
    }, 5000);
    try { speechSynthesis.speak(u); } catch (err) { fail('La lecture à voix haute n\'est pas disponible. Vous pouvez lire le texte ci-dessous.'); }
    updatePlayer();
  }

  function fail(msg) {
    var pl = S.player;
    pl.state = 'error'; pl.token++; pl.t0 = 0;
    try { speechSynthesis.cancel(); } catch (_) {}
    var n = $('#pl-note');
    n.hidden = false;
    n.className = 'note';
    n.textContent = msg;
    updatePlayer();
    syncPlayingUI();
    openPlayer();
  }

  function finish() {
    var pl = S.player;
    pl.state = 'done'; pl.t0 = 0;
    if (!S.tracking) keepAwake(false);
    var first = !S.visited.has(pl.placeId);
    S.visited.add(pl.placeId);
    store.set('visited', Array.from(S.visited));
    var p = byId(pl.placeId);
    map.setMarkerClass(pl.placeId, 'is-done', true);
    map.setMarkerLabel(pl.placeId, pinLabel(p));
    if (first) announce('Lieu écouté : ' + p.name);
    updatePlayer();
    syncPlayingUI();
  }

  function pausePlayback() {
    var pl = S.player;
    if (pl.state !== 'playing') return;
    pl.state = 'paused'; pl.t0 = 0;
    stopSpeech();
    updatePlayer();
    syncPlayingUI();
  }
  function resumePlayback() {
    var pl = S.player;
    if (pl.state === 'done') pl.i = 0;
    pl.state = 'playing'; pl.t0 = 0;
    $('#pl-note').hidden = true;
    keepAwake(true);
    updatePlayer();
    syncPlayingUI();
    setTimeout(speakCurrent, 80);
  }
  function togglePlayback() {
    if (S.player.state === 'playing') pausePlayback(); else resumePlayback();
  }
  // Arrête la lecture et cache le mini-lecteur (le lecteur plein écran est fermé par l'appelant).
  function stopPlayback() {
    S.player.state = 'idle';
    stopSpeech();
    if (!S.tracking) keepAwake(false);
    hideMini();
    syncPlayingUI();
  }
  function restartChunk() {
    var pl = S.player;
    pl.t0 = 0;
    if (pl.state === 'playing') { stopSpeech(); setTimeout(speakCurrent, 60); }
    updatePlayer();
  }
  function prevChunk() {
    var pl = S.player;
    if (!pl.chunks.length) return;
    if (pl.state === 'done') { pl.i = pl.chunks.length - 1; pl.state = 'playing'; }
    else if (!(pl.state === 'playing' && pl.t0 && performance.now() - pl.t0 > 2500)) pl.i = Math.max(0, pl.i - 1);
    restartChunk();
  }
  function nextChunk() {
    var pl = S.player;
    if (!pl.chunks.length || pl.state === 'done') return;
    if (pl.i >= pl.chunks.length - 1) { stopSpeech(); finish(); return; }
    pl.i++;
    restartChunk();
  }
  function setRate(r) {
    S.rate = r;
    store.set('rate', r);
    $$('#opt-rate button').forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-rate')) === r)); });
    $('#pl-speed').textContent = 'Vitesse ' + String(r).replace('.', ',') + '×';
    if (S.player.state === 'playing') restartChunk(); else updateTimes();
  }

  /* ---------- Lecteur : temps, mini-lecteur, plein écran ---------- */
  function chunkSec(c) { return c.words / 2.5 / S.rate; }
  function totalSec() { return S.player.chunks.reduce(function (s, c) { return s + chunkSec(c); }, 0); }
  function elapsedSec() {
    var pl = S.player, s = 0;
    if (pl.state === 'done') return totalSec();
    for (var j = 0; j < pl.i && j < pl.chunks.length; j++) s += chunkSec(pl.chunks[j]);
    if (pl.state === 'playing' && pl.t0 && pl.chunks[pl.i]) s += Math.min(chunkSec(pl.chunks[pl.i]), (performance.now() - pl.t0) / 1000);
    return s;
  }
  function modeLabel() { return S.player.mode === 'express' ? 'Version courte' : 'Version longue'; }
  function updateTimes() {
    var pl = S.player;
    if (pl.state === 'idle' || !pl.chunks.length) return;
    var tot = totalSec(), el = Math.min(tot, elapsedSec()), pct = tot ? el / tot * 100 : 0;
    $('#pl-elapsed').textContent = fmtClock(el);
    $('#pl-remain').textContent = '−' + fmtClock(tot - el);
    $('#pl-bar').style.width = pct.toFixed(1) + '%';
    $('#pl-knob').style.left = pct.toFixed(1) + '%';
    $('#mini-bar').style.width = pct.toFixed(1) + '%';
    var sub = pl.state === 'done' ? 'Écouté ✓' : pl.state === 'error' ? 'Texte seul' :
      (pl.state === 'paused' ? 'En pause' : modeLabel()) + ' · reste ' + fmtClock(tot - el);
    $('#mini-sub').textContent = sub;
  }
  setInterval(function () { if (S.player.state === 'playing') updateTimes(); }, 500);

  function nextPlace() {
    var cur = byId(S.player.placeId), ref = S.pos || cur, best = null;
    filtered().forEach(function (p) {
      if (p.id === S.player.placeId || S.visited.has(p.id)) return;
      var d = haversine(ref, p);
      if (!best || d < best.d) best = { p: p, d: d };
    });
    return best;
  }

  function buildPlayer(p) {
    var pl = S.player, paras = [];
    pl.chunks.forEach(function (c, i) {
      paras[c.para] = (paras[c.para] || '') + '<span data-i="' + i + '">' + esc(c.text) + '</span> ';
    });
    $('#pl-tile').setAttribute('data-cat', p.cats[0]);
    $('#pl-tile').innerHTML = ic(p.cats[0]);
    $('#mini-tile').setAttribute('data-cat', p.cats[0]);
    $('#mini-tile').innerHTML = ic(p.cats[0]);
    $('#pl-title').textContent = p.name;
    $('#mini-title').textContent = p.name;
    $('#pl-meta').textContent = p.cats.map(function (id) { var c = catById(id); return c ? c.label : ''; }).join(' · ');
    $('#pl-mode').textContent = modeLabel();
    $('#pl-speed').textContent = 'Vitesse ' + String(S.rate).replace('.', ',') + '×';
    $('#pl-src').lastChild.textContent = 'Sources (' + p.sources.length + ')';
    var noVoice = !('speechSynthesis' in window) || frenchVoices().length === 0;
    var n = $('#pl-note');
    n.className = 'note';
    n.hidden = !noVoice;
    n.textContent = noVoice ? 'Aucune voix française détectée sur ce téléphone : installez-en une dans ses réglages (synthèse vocale). Le texte reste lisible ci-dessous.' : '';
    $('#pl-text').innerHTML = paras.map(function (t) { return '<p>' + t + '</p>'; }).join('') +
      '<h3 class="src-title" id="pl-sources">Sources</h3><ul class="src-list">' + p.sources.map(function (s) {
        return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + '</a></li>';
      }).join('') + '</ul>';
    $('#pl-text').scrollTop = 0;
    updatePlayer();
  }

  function updatePlayer() {
    var pl = S.player;
    if (pl.state === 'idle') return;
    var tgIcon = pl.state === 'playing' ? 'pause' : pl.state === 'done' ? 'back' : 'play';
    var tgLabel = pl.state === 'playing' ? 'Pause' : pl.state === 'done' ? 'Réécouter' : 'Lecture';
    [['#pl-toggle', 'ic--fill'], ['#mini-toggle', 'ic--fill']].forEach(function (x) {
      var b = $(x[0]);
      b.innerHTML = ic(tgIcon, tgIcon === 'back' ? '' : x[1]);
      b.setAttribute('aria-label', tgLabel);
    });
    $('#pl-mode').textContent = modeLabel();
    var spans = $$('#pl-text span[data-i]');
    spans.forEach(function (s) {
      var i = Number(s.getAttribute('data-i'));
      s.classList.toggle('cur', pl.state !== 'done' && i === pl.i);
      s.classList.toggle('fut', pl.state !== 'done' && i > pl.i);
    });
    var nx = $('#pl-next');
    if (pl.state === 'done') {
      var nxt = nextPlace();
      nx.hidden = false;
      nx.innerHTML = nxt
        ? '<button type="button" class="btn btn--primary btn--block" id="pl-go" data-id="' + esc(nxt.p.id) + '">Prochain lieu : ' + esc(nxt.p.name) + ' · ' + fmtDist(nxt.d) + '</button>'
        : '<p class="note ok">Bravo, vous avez écouté tous les lieux.</p>';
    } else { nx.hidden = true; nx.innerHTML = ''; }
    scrollToCurrent();
    updateTimes();
  }
  var lastScrolled = -1;
  function scrollToCurrent(force) {
    var pl = S.player, box = $('#pl-text');
    if (!S.playerOpen || pl.state === 'done') return;
    if (!force && lastScrolled === pl.i) return;
    lastScrolled = pl.i;
    var cur = box.querySelector('span.cur');
    if (cur) box.scrollTop = Math.max(0, cur.offsetTop - box.clientHeight / 3);
  }
  // Met à jour les boutons « Écouter » de la carte du haut, de la liste et de la fiche.
  function syncPlayingUI() {
    refresh(false);
    if (S.view === 'place') renderPlace();
  }

  function showMini() {
    var m = $('#mini');
    if (!m.hidden) return;
    m.hidden = false;
    measure();
  }
  function hideMini() {
    var m = $('#mini');
    if (m.hidden) return;
    m.hidden = true;
    measure();
  }
  function openPlayer() {
    var el = $('#player');
    if (S.playerOpen) return;
    S.playerOpen = true;
    pushLayer('player');
    el.hidden = false;
    el.getBoundingClientRect();
    el.classList.add('open');
    setInert(true);
    lastScrolled = -1;
    scrollToCurrent(true);
    try { $('#pl-min').focus({ preventScroll: true }); } catch (_) {}
  }
  function minimizePlayer() {
    var el = $('#player');
    if (!S.playerOpen) return;
    S.playerOpen = false;
    el.classList.remove('open');
    setInert(false);
    var hide = function () { if (!S.playerOpen) el.hidden = true; };
    if (REDUCED) hide(); else setTimeout(hide, 280);
    var m = $('#mini-open');
    if (!$('#mini').hidden) try { m.focus({ preventScroll: true }); } catch (_) {}
  }
  function goNext(id) {
    stopPlayback();
    if (S.playerOpen && layers[layers.length - 1] === 'player' && history.state && history.state.halte === 'player') {
      afterPop = function () { openPlace(id); };
      history.back();
    } else {
      uiBack('player');
      openPlace(id);
    }
  }

  /* ---------- Interface : événements ---------- */
  function onSheetClick(e) {
    var b = e.target.closest('[data-act], [data-cat-filter]');
    if (!b) return;
    if (b.hasAttribute('data-cat-filter')) { setCat(b.getAttribute('data-cat-filter')); return; }
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    if (act === 'open') openPlace(id);
    else if (act === 'play') {
      var pl = S.player, mode = b.getAttribute('data-mode');
      if (pl.placeId === id && pl.mode === mode && (pl.state === 'playing' || pl.state === 'paused')) togglePlayback();
      else startPlayback(id, mode);
    }
    else if (act === 'expand') setSheet('half');
    else if (act === 'collapse') setSheet('peek');
    else if (act === 'locate') onLocate();
    else if (act === 'close') uiBack('place');
    else if (act === 'cat-all') setCat('all');
  }

  function bindUI() {
    sheetEl.addEventListener('click', onSheetClick);
    $('#btn-locate').addEventListener('click', onLocate);
    $('#btn-settings').addEventListener('click', openSettings);
    $('#mini-open').addEventListener('click', openPlayer);
    $('#mini-toggle').addEventListener('click', togglePlayback);
    $('#pl-toggle').addEventListener('click', togglePlayback);
    $('#pl-min').addEventListener('click', function () { uiBack('player'); });
    $('#pl-stop').addEventListener('click', function () { stopPlayback(); uiBack('player'); });
    $('#pl-prev').addEventListener('click', prevChunk);
    $('#pl-fwd').addEventListener('click', nextChunk);
    $('#pl-speed').addEventListener('click', function () { setRate(RATES[(RATES.indexOf(S.rate) + 1) % RATES.length]); });
    $('#pl-src').addEventListener('click', function () {
      var t = $('#pl-sources');
      if (t) $('#pl-text').scrollTop = t.offsetTop - 8;
    });
    $('#pl-next').addEventListener('click', function (e) {
      var g = e.target.closest('#pl-go');
      if (g) goNext(g.getAttribute('data-id'));
    });
    // Toucher la carte (sans la faire glisser) ferme la fiche.
    var down = null;
    $('#map').addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY }; });
    $('#map').addEventListener('pointerup', function (e) {
      if (!down || e.target.closest('.pin, .cluster, a')) { down = null; return; }
      var moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
      down = null;
      if (moved < 8 && S.view === 'place') uiBack('place');
      else if (moved < 8 && S.sheet !== 'peek') setSheet('peek');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || $('#settings').open) return;
      if (S.playerOpen) uiBack('player');
      else if (S.view === 'place') uiBack('place');
      else if (S.sheet !== 'peek') setSheet('peek');
    });
    $('#welcome-locate').addEventListener('click', function () { hideWelcome(); startTracking(); });
    $('#welcome-skip').addEventListener('click', hideWelcome);
  }

  /* ---------- Premier lancement ---------- */
  function showWelcome() {
    $('#welcome').hidden = false;
    setInert(true);
    try { $('#welcome .welcome__inner').focus({ preventScroll: true }); } catch (_) {}
  }
  function hideWelcome() {
    store.set('onboarded', true);
    $('#welcome').hidden = true;
    setInert(false);
  }

  /* ---------- Réglages ---------- */
  function setupSettings() {
    var d = $('#settings');
    $('#opt-voice').addEventListener('change', function () { S.voiceURI = this.value; store.set('voice', S.voiceURI); });
    $('#opt-rate').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-rate]');
      if (b) setRate(Number(b.getAttribute('data-rate')));
    });
    setRate(S.rate);
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
        if (S.cat !== 'all' && p.cats.indexOf(S.cat) < 0) setCat('all');
        d.close();
        setPosition(p.lat + 0.00008, p.lon, 10, true);
      } else {
        S.pos = null;
        S.geo = S.tracking ? 'searching' : 'off';
        map.setUser(null);
        S.places.forEach(function (q) { q._d = null; });
        refresh(true);
        if (S.tracking) { stopTracking(); startTracking(); }
      }
    });
    $('#btn-reset').addEventListener('click', function () {
      if (!S.visited.size) return;
      $('#reset-q').textContent = 'Effacer ' + (S.visited.size > 1 ? 'les ' + S.visited.size + ' lieux écoutés' : 'le lieu écouté') + ' ?';
      $('#reset-ask').hidden = true;
      $('#reset-confirm').hidden = false;
      $('#reset-no').focus();
    });
    $('#reset-no').addEventListener('click', resetBox);
    $('#reset-yes').addEventListener('click', function () {
      S.visited = new Set();
      store.set('visited', []);
      S.places.forEach(function (p) { map.setMarkerClass(p.id, 'is-done', false); map.setMarkerLabel(p.id, pinLabel(p)); });
      resetBox();
      refresh(true);
      if (S.view === 'place') renderPlace();
    });
    if ('speechSynthesis' in window && speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', fillVoices);
    fillVoices();
  }
  function resetBox() {
    var n = S.visited.size;
    $('#visited-count').textContent = n ? plural(n, 'lieu écouté', 'lieux écoutés') : 'Aucun pour l\'instant';
    $('#btn-reset').disabled = !n;
    $('#reset-ask').hidden = false;
    $('#reset-confirm').hidden = true;
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
    resetBox();
    var d = $('#settings');
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }
})();
