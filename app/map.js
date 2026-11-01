/* Mini carte à tuiles (sans dépendance) : glisser, zoom, marqueurs, position utilisateur. */
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

  function TileMap(el, opts) {
    opts = opts || {};
    this.el = el;
    this.minZoom = opts.minZoom || 11;
    this.maxZoom = opts.maxZoom || 18;
    this.tileUrl = opts.tileUrl || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    this.z = opts.zoom || 15;
    this.cx = lon2x(opts.lon || 1.444, this.z);
    this.cy = lat2y(opts.lat || 43.6045, this.z);
    this.tiles = {};
    this.markers = {};
    this.userPos = null;

    el.classList.add('tm');
    this.tilePane = document.createElement('div');
    this.tilePane.className = 'tm-tiles';
    this.overlay = document.createElement('div');
    this.overlay.className = 'tm-overlay';
    el.insertBefore(this.overlay, el.firstChild);
    el.insertBefore(this.tilePane, el.firstChild);

    this.accEl = document.createElement('div');
    this.accEl.className = 'tm-acc';
    this.accEl.hidden = true;
    this.dotEl = document.createElement('div');
    this.dotEl.className = 'tm-user';
    this.dotEl.hidden = true;
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

  TileMap.prototype.project = function (lat, lon) {
    return { x: lon2x(lon, this.z) - this.cx + this.w / 2, y: lat2y(lat, this.z) - this.cy + this.h / 2 };
  };

  TileMap.prototype.center = function () {
    return { lat: y2lat(this.cy, this.z), lon: x2lon(this.cx, this.z) };
  };

  TileMap.prototype.setView = function (lat, lon, z) {
    if (z != null) this.z = clamp(z, this.minZoom, this.maxZoom);
    this.cx = lon2x(lon, this.z);
    this.cy = lat2y(lat, this.z);
    this.render();
  };

  TileMap.prototype.fitPoints = function (pts, pad) {
    pad = pad || 36;
    if (!pts.length) return;
    for (var z = this.maxZoom; z >= this.minZoom; z--) {
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (var i = 0; i < pts.length; i++) {
        var x = lon2x(pts[i].lon, z), y = lat2y(pts[i].lat, z);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      if (maxX - minX <= this.w - pad * 2 && maxY - minY <= this.h - pad * 2) {
        this.z = z;
        this.cx = (minX + maxX) / 2;
        this.cy = (minY + maxY) / 2;
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
    var ax = this.w / 2, ay = this.h / 2;
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

  TileMap.prototype._bind = function () {
    var self = this, el = this.el, pts = {}, count = 0, lastDist = 0;
    el.style.touchAction = 'none';
    function dist() {
      var ids = Object.keys(pts);
      var a = pts[ids[0]], b = pts[ids[1]];
      return Math.hypot(a.x - b.x, a.y - b.y);
    }
    el.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.tm-ctrl') || e.target.closest('.tm-marker')) return;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      if (!pts[e.pointerId]) count++;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
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
        self.render();
      } else if (count === 2 && lastDist) {
        var d = dist(), ratio = d / lastDist;
        if (ratio > 1.6) { self.zoomBy(1); lastDist = d; }
        else if (ratio < 0.62) { self.zoomBy(-1); lastDist = d; }
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
    }, { passive: false });
    el.addEventListener('dblclick', function (e) {
      if (e.target.closest('.tm-ctrl') || e.target.closest('.tm-marker')) return;
      self.zoomBy(1, e.clientX, e.clientY);
    });
  };

  TileMap.prototype.addMarker = function (id, o) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tm-marker' + (o.className ? ' ' + o.className : '');
    b.setAttribute('aria-label', o.label || id);
    b.innerHTML = o.html || '';
    if (o.onClick) b.addEventListener('click', function (e) { e.stopPropagation(); o.onClick(id); });
    this.overlay.appendChild(b);
    this.markers[id] = { el: b, lat: o.lat, lon: o.lon };
    this.render();
    return b;
  };

  TileMap.prototype.setMarkerClass = function (id, cls, on) {
    var m = this.markers[id];
    if (m) m.el.classList.toggle(cls, !!on);
  };

  TileMap.prototype.setUser = function (lat, lon, acc) {
    this.userPos = lat == null ? null : { lat: lat, lon: lon, acc: acc || 0 };
    this.render();
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
    if (this.userPos) {
      var u = this.project(this.userPos.lat, this.userPos.lon);
      var mpp = 156543.03392 * Math.cos(this.userPos.lat * Math.PI / 180) / n;
      var r = Math.max(8, this.userPos.acc / mpp);
      this.dotEl.hidden = false;
      this.accEl.hidden = false;
      this.dotEl.style.transform = 'translate(' + u.x.toFixed(1) + 'px,' + u.y.toFixed(1) + 'px)';
      this.accEl.style.width = this.accEl.style.height = (r * 2).toFixed(0) + 'px';
      this.accEl.style.transform = 'translate(' + (u.x - r).toFixed(1) + 'px,' + (u.y - r).toFixed(1) + 'px)';
    } else {
      this.dotEl.hidden = true;
      this.accEl.hidden = true;
    }
  };

  global.TileMap = TileMap;
})(window);
