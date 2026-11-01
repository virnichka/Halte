/* Mini carte à tuiles (sans dépendance) : glisser, zoom, pastilles regroupées, position de l'utilisateur.
   Marges haut/bas (panneau du bas) : le « centre » de la carte est le centre de la zone visible. */
(function (global) {
  'use strict';
  var TILE = 256;
  function lon2x(lon, z) { return (lon + 180) / 360 * TILE * Math.pow(2, z); }
  function lat2y(lat, z) {
    var s = Math.sin(lat * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * Math.pow(2, z);
  }
  function x2lon(x, z) { return x / (TILE * Math.pow(2, z)) * 360 - 180; }
  function y2lat(y, z) {
    var n = Math.PI - 2 * Math.PI * y / (TILE * Math.pow(2, z));
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function reducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function TileMap(el, opts) {
    opts = opts || {};
    this.el = el;
    this.minZoom = opts.minZoom || 11;
    this.maxZoom = opts.maxZoom || 18;
    this.tileUrl = opts.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    this.z = opts.zoom || 15;
    this.cx = lon2x(opts.lon || 1.444, this.z);
    this.cy = lat2y(opts.lat || 43.6045, this.z);
    this.pad = { top: 0, bottom: 0 };
    this.tiles = {};
    this.markers = {};
    this.userPos = null;
    this.onMove = opts.onMove || null;
    this.onUserMove = opts.onUserMove || null;
    this.clusterRadius = opts.clusterRadius || 40;
    this._clusters = [];
    this._clusterKey = '';
    this._clusterEls = [];
    this._anim = 0;

    el.classList.add('tm');
    this.tilePane = document.createElement('div');
    this.tilePane.className = 'tm-tiles';
    this.overlay = document.createElement('div');
    this.overlay.className = 'tm-overlay';
    el.insertBefore(this.overlay, el.firstChild);
    el.insertBefore(this.tilePane, el.firstChild);

    this.accEl = document.createElement('div');
    this.accEl.className = 'me-acc';
    this.accEl.hidden = true;
    this.dotEl = document.createElement('div');
    this.dotEl.className = 'me';
    this.dotEl.hidden = true;
    this.dotEl.setAttribute('role', 'img');
    this.dotEl.setAttribute('aria-label', 'Votre position');
    this.overlay.appendChild(this.accEl);
    this.overlay.appendChild(this.dotEl);

    this._measure();
    this._bind();
    var self = this;
    if (global.ResizeObserver) {
      new ResizeObserver(function () { self._measure(); self.render(); }).observe(el);
    } else {
      global.addEventListener('resize', function () { self._measure(); self.render(); });
    }
    this.render();
  }

  TileMap.prototype._measure = function () {
    var r = this.el.getBoundingClientRect();
    this.w = r.width || 300;
    this.h = r.height || 300;
  };

  // Décalage vertical entre le centre de l'écran et le centre de la zone visible (hors panneau).
  TileMap.prototype._off = function () { return (this.pad.top - this.pad.bottom) / 2; };

  TileMap.prototype.setPadding = function (top, bottom) {
    if (this.pad.top === top && this.pad.bottom === bottom) return;
    this.pad = { top: top, bottom: bottom };
    if (this.onMove) this.onMove();
  };

  TileMap.prototype.project = function (lat, lon) {
    return { x: lon2x(lon, this.z) - this.cx + this.w / 2, y: lat2y(lat, this.z) - this.cy + this.h / 2 };
  };

  TileMap.prototype.center = function () {
    return { lat: y2lat(this.cy + this._off(), this.z), lon: x2lon(this.cx, this.z) };
  };

  TileMap.prototype.setView = function (lat, lon, z) {
    this._anim++;
    if (z != null) this.z = clamp(Math.round(z), this.minZoom, this.maxZoom);
    this.cx = lon2x(lon, this.z);
    this.cy = lat2y(lat, this.z) - this._off();
    this.render();
  };

  // Déplacement animé (même zoom, distance raisonnable) ; sinon saut direct.
  TileMap.prototype.flyTo = function (lat, lon, z) {
    z = z == null ? this.z : clamp(Math.round(z), this.minZoom, this.maxZoom);
    if (z !== this.z || reducedMotion()) { this.setView(lat, lon, z); return; }
    var tx = lon2x(lon, z), ty = lat2y(lat, z) - this._off(), sx = this.cx, sy = this.cy;
    if (Math.hypot(tx - sx, ty - sy) > Math.max(this.w, this.h) * 2) { this.setView(lat, lon, z); return; }
    var self = this, id = ++this._anim, t0 = null, D = 300;
    function step(now) {
      if (id !== self._anim) return;
      if (t0 == null) t0 = now;
      var k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
      self.cx = sx + (tx - sx) * e;
      self.cy = sy + (ty - sy) * e;
      self.render();
      if (k < 1) global.requestAnimationFrame(step);
    }
    global.requestAnimationFrame(step);
  };

  TileMap.prototype.fitPoints = function (pts, pad, maxZoom) {
    pad = pad || 36;
    if (!pts.length) return;
    this._anim++;
    var top = maxZoom ? Math.min(maxZoom, this.maxZoom) : this.maxZoom;
    var availH = this.h - this.pad.top - this.pad.bottom;
    for (var z = top; z >= this.minZoom; z--) {
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (var i = 0; i < pts.length; i++) {
        var x = lon2x(pts[i].lon, z), y = lat2y(pts[i].lat, z);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      if (maxX - minX <= this.w - pad * 2 && maxY - minY <= availH - pad * 2) {
        this.z = z;
        this.cx = (minX + maxX) / 2;
        this.cy = (minY + maxY) / 2 - this._off();
        this.render();
        return;
      }
    }
    this.z = this.minZoom;
    this.render();
  };

  TileMap.prototype.zoomBy = function (dz, clientX, clientY) {
    var nz = clamp(this.z + dz, this.minZoom, this.maxZoom);
    if (nz === this.z) return;
    this._anim++;
    var ax = this.w / 2, ay = this.h / 2 + this._off();
    if (clientX != null) {
      var r = this.el.getBoundingClientRect();
      ax = clientX - r.left; ay = clientY - r.top;
    }
    var lon = x2lon(this.cx + (ax - this.w / 2), this.z);
    var lat = y2lat(this.cy + (ay - this.h / 2), this.z);
    this.z = nz;
    this.cx = lon2x(lon, nz) - (ax - this.w / 2);
    this.cy = lat2y(lat, nz) - (ay - this.h / 2);
    this.render();
  };

  TileMap.prototype._userMoved = function () { if (this.onUserMove) this.onUserMove(); };

  TileMap.prototype._bind = function () {
    var self = this, el = this.el, pts = {}, count = 0, lastDist = 0, moved = 0, notified = false;
    el.style.touchAction = 'none';
    function dist() {
      var ids = Object.keys(pts);
      var a = pts[ids[0]], b = pts[ids[1]];
      return Math.hypot(a.x - b.x, a.y - b.y);
    }
    function ignore(t) { return t.closest('.pin') || t.closest('.cluster') || t.closest('a, button'); }
    el.addEventListener('pointerdown', function (e) {
      if (ignore(e.target)) return;
      self._anim++;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      if (!pts[e.pointerId]) count++;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (count === 1) { moved = 0; notified = false; }
      if (count === 2) lastDist = dist();
    });
    el.addEventListener('pointermove', function (e) {
      var prev = pts[e.pointerId];
      if (!prev) return;
      var cur = { x: e.clientX, y: e.clientY };
      pts[e.pointerId] = cur;
      if (count === 1) {
        self.cx -= cur.x - prev.x;
        self.cy -= cur.y - prev.y;
        moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
        if (!notified && moved > 6) { notified = true; self._userMoved(); }
        self.render();
      } else if (count === 2 && lastDist) {
        var d = dist(), ratio = d / lastDist;
        if (ratio > 1.4) { self.zoomBy(1); lastDist = d; self._userMoved(); }
        else if (ratio < 0.72) { self.zoomBy(-1); lastDist = d; self._userMoved(); }
      }
    });
    function up(e) {
      if (pts[e.pointerId]) { delete pts[e.pointerId]; count = Math.max(0, count - 1); }
      lastDist = 0;
    }
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (self._wheelLock) return;
      self._wheelLock = true;
      setTimeout(function () { self._wheelLock = false; }, 220);
      self.zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
      self._userMoved();
    }, { passive: false });
    el.addEventListener('dblclick', function (e) {
      if (ignore(e.target)) return;
      self.zoomBy(1, e.clientX, e.clientY);
      self._userMoved();
    });
  };

  TileMap.prototype.addMarker = function (id, o) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pin' + (o.className ? ' ' + o.className : '');
    if (o.cat) b.setAttribute('data-cat', o.cat);
    b.setAttribute('data-id', id);
    b.setAttribute('aria-label', o.label || id);
    b.innerHTML = o.html || '';
    if (o.onClick) b.addEventListener('click', function (e) { e.stopPropagation(); o.onClick(id); });
    this.overlay.appendChild(b);
    this.markers[id] = { el: b, lat: o.lat, lon: o.lon };
    this._clusterKey = '';
    this.render();
    return b;
  };

  TileMap.prototype.setMarkerClass = function (id, cls, on) {
    var m = this.markers[id];
    if (!m || m.el.classList.contains(cls) === !!on) return;
    m.el.classList.toggle(cls, !!on);
    if (cls === 'pin--sel' || cls === 'is-here') { this._clusterKey = ''; this.render(); }
  };

  TileMap.prototype.setMarkerVisible = function (id, on) {
    var m = this.markers[id];
    if (m && m.el.hidden !== !on) { m.el.hidden = !on; this._clusterKey = ''; this.render(); }
  };

  TileMap.prototype.setMarkerLabel = function (id, label) {
    var m = this.markers[id];
    if (m) m.el.setAttribute('aria-label', label);
  };

  TileMap.prototype.setUser = function (lat, lon, acc) {
    this.userPos = lat == null ? null : { lat: lat, lon: lon, acc: acc || 0 };
    this.render();
  };

  // Regroupe les pastilles trop proches à l'écran en une pastille « nombre ».
  // Calcul en coordonnées du monde au zoom courant : il ne change pas quand on fait glisser la carte.
  TileMap.prototype._cluster = function () {
    var z = this.z, R = this.clusterRadius, groups = [], ids = Object.keys(this.markers);
    for (var i = 0; i < ids.length; i++) {
      var m = this.markers[ids[i]];
      if (m.el.hidden) continue;
      var x = lon2x(m.lon, z), y = lat2y(m.lat, z);
      if (m.el.classList.contains('pin--sel') || m.el.classList.contains('is-here')) {
        groups.push({ ids: [ids[i]], x: x, y: y, solo: true });
        continue;
      }
      var g = null;
      for (var j = 0; j < groups.length; j++) {
        if (!groups[j].solo && Math.abs(groups[j].x - x) < R && Math.abs(groups[j].y - y) < R) { g = groups[j]; break; }
      }
      if (g) {
        g.ids.push(ids[i]);
        g.x += (x - g.x) / g.ids.length; g.y += (y - g.y) / g.ids.length;
      } else groups.push({ ids: [ids[i]], x: x, y: y });
    }
    this._clusters = groups.filter(function (g) { return g.ids.length > 1; });
    var inCluster = {};
    this._clusters.forEach(function (g) { g.ids.forEach(function (id) { inCluster[id] = true; }); });
    for (var k in this.markers) this.markers[k].el.classList.toggle('clustered', !!inCluster[k]);
    var self = this;
    while (this._clusterEls.length < this._clusters.length) {
      (function () {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'cluster';
        b.innerHTML = '<span></span>';
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          var g = b._group;
          if (!g) return;
          var pts = g.ids.map(function (id) { return self.markers[id]; });
          var z0 = self.z;
          self.fitPoints(pts, 60);
          if (self.z <= z0) self.setView(y2lat(g.y, z0), x2lon(g.x, z0), z0 + 2);
          self._userMoved();
        });
        self.overlay.appendChild(b);
        self._clusterEls.push(b);
      })();
    }
    this._clusterEls.forEach(function (b, i) {
      var g = self._clusters[i];
      b._group = g || null;
      b.hidden = !g;
      if (g) {
        b.firstChild.textContent = g.ids.length;
        b.setAttribute('aria-label', g.ids.length + ' lieux : zoomer');
      }
    });
  };

  // Point dans la zone visible (entre les marges), avec une tolérance en pixels.
  TileMap.prototype.inView = function (lat, lon, tol) {
    var p = this.project(lat, lon);
    tol = tol || 0;
    return p.x >= -tol && p.x <= this.w + tol && p.y >= this.pad.top - tol && p.y <= this.h - this.pad.bottom + tol;
  };

  TileMap.prototype.render = function () {
    var z = this.z, n = Math.pow(2, z);
    var left = this.cx - this.w / 2, top = this.cy - this.h / 2;
    var x0 = Math.floor(left / TILE), x1 = Math.floor((left + this.w) / TILE);
    var y0 = Math.floor(top / TILE), y1 = Math.floor((top + this.h) / TILE);
    var need = {};
    for (var ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (var tx = x0; tx <= x1; tx++) {
        var wx = ((tx % n) + n) % n;
        var key = z + '/' + tx + '/' + ty;
        need[key] = true;
        var img = this.tiles[key];
        if (!img) {
          img = new Image();
          img.className = 'tm-tile';
          img.alt = '';
          img.draggable = false;
          img.decoding = 'async';
          img.referrerPolicy = 'strict-origin-when-cross-origin';
          (function (im) { im.onerror = function () { im.style.visibility = 'hidden'; }; })(img);
          img.src = this.tileUrl.replace('{z}', z).replace('{x}', wx).replace('{y}', ty);
          this.tilePane.appendChild(img);
          this.tiles[key] = img;
        }
        img.style.transform = 'translate(' + Math.round(tx * TILE - left) + 'px,' + Math.round(ty * TILE - top) + 'px)';
      }
    }
    for (var k in this.tiles) {
      if (!need[k]) { this.tiles[k].remove(); delete this.tiles[k]; }
    }
    for (var id in this.markers) {
      var m = this.markers[id], p = this.project(m.lat, m.lon);
      m.el.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px)';
    }
    if (this._clusterKey !== String(z)) { this._clusterKey = String(z); this._cluster(); }
    for (var c = 0; c < this._clusters.length; c++) {
      var g = this._clusters[c];
      this._clusterEls[c].style.transform = 'translate(' + (g.x - left).toFixed(1) + 'px,' + (g.y - top).toFixed(1) + 'px)';
    }
    if (this.userPos) {
      var u = this.project(this.userPos.lat, this.userPos.lon);
      var mpp = 156543.03392 * Math.cos(this.userPos.lat * Math.PI / 180) / n;
      var r = Math.max(11, this.userPos.acc / mpp);
      this.dotEl.hidden = false;
      this.accEl.hidden = false;
      this.dotEl.style.transform = 'translate(' + u.x.toFixed(1) + 'px,' + u.y.toFixed(1) + 'px)';
      this.accEl.style.width = this.accEl.style.height = (r * 2).toFixed(0) + 'px';
      this.accEl.style.transform = 'translate(' + (u.x - r).toFixed(1) + 'px,' + (u.y - r).toFixed(1) + 'px)';
    } else {
      this.dotEl.hidden = true;
      this.accEl.hidden = true;
    }
    if (this.onMove) this.onMove();
  };

  global.TileMap = TileMap;
})(window);
