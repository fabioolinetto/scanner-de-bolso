/* Scanner de Bolso — document edge detection.
 * Several candidate regions (bright paper, dark paper, "whiteness", edge-enclosed area) are
 * turned into convex hulls, each hull into its largest inscribed quadrilateral, each side is then
 * refined against real image gradients at higher resolution, and the candidates are scored by how
 * strongly the image supports their four sides. */
(function (global) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function toGray(canvas, maxSide) {
    const W = canvas.width, H = canvas.height, s = Math.min(1, maxSide / Math.max(W, H));
    const w = Math.max(16, Math.round(W * s)), h = Math.max(16, Math.round(H * s));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high'; x.drawImage(canvas, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h), sat = new Float32Array(w * h), R = new Float32Array(w * h), Gc = new Float32Array(w * h), B = new Float32Array(w * h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      const r = d[p], gg = d[p + 1], b = d[p + 2]; R[i] = r; Gc[i] = gg; B[i] = b;
      g[i] = 0.299 * r + 0.587 * gg + 0.114 * b;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
      sat[i] = mx ? (mx - mn) / mx : 0;
    }
    return { g, sat, R, Gc, B, w, h, sx: W / w, sy: H / h };
  }

  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      let acc = 0; const o = y * w;
      for (let k = -r; k <= r; k++) acc += src[o + clamp(k, 0, w - 1)];
      for (let x = 0; x < w; x++) { tmp[o + x] = acc / n; acc += src[o + clamp(x + r + 1, 0, w - 1)] - src[o + clamp(x - r, 0, w - 1)]; }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) { out[y * w + x] = acc / n; acc += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x]; }
    }
    return out;
  }

  function sobel(g, w, h) {
    const gx = new Float32Array(w * h), gy = new Float32Array(w * h), mag = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = g[i - w - 1], b = g[i - w], c = g[i - w + 1], d = g[i - 1], f = g[i + 1], k = g[i + w - 1], l = g[i + w], m = g[i + w + 1];
      const X = (c + 2 * f + m) - (a + 2 * d + k), Y = (k + 2 * l + m) - (a + 2 * b + c);
      gx[i] = X; gy[i] = Y; mag[i] = Math.hypot(X, Y);
    }
    return { gx, gy, mag };
  }

  function otsu(arr, lo, hi) {
    const bins = 256, hist = new Float64Array(bins), sc = (bins - 1) / (hi - lo || 1);
    for (let i = 0; i < arr.length; i++) hist[clamp(((arr[i] - lo) * sc) | 0, 0, bins - 1)]++;
    let sum = 0; for (let i = 0; i < bins; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = -1, t = 128;
    for (let i = 0; i < bins; i++) {
      wB += hist[i]; if (!wB) continue; const wF = arr.length - wB; if (!wF) break;
      sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; t = i; }
    }
    return lo + t / sc;
  }

  function percentile(arr, p) {
    const s = Array.from(arr).filter((v, i) => i % 3 === 0).sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0;
  }

  function morph(mask, w, h, r, dilate) { // separable square min/max
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let k = -r; k <= r; k++) { const xx = x + k; const m = xx < 0 || xx >= w ? (dilate ? 0 : 1) : mask[y * w + xx]; if (dilate ? m : !m) { v = dilate ? 1 : 0; break; } }
      tmp[y * w + x] = v;
    }
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
      let v = dilate ? 0 : 1;
      for (let k = -r; k <= r; k++) { const yy = y + k; const m = yy < 0 || yy >= h ? (dilate ? 0 : 1) : tmp[yy * w + x]; if (dilate ? m : !m) { v = dilate ? 1 : 0; break; } }
      out[y * w + x] = v;
    }
    return out;
  }
  const open = (m, w, h, r) => morph(morph(m, w, h, r, false), w, h, r, true);
  const close = (m, w, h, r) => morph(morph(m, w, h, r, true), w, h, r, false);

  /* Biggest sensible connected region of a mask -> its boundary pixels. */
  function bestRegion(mask, w, h) {
    const lab = new Int32Array(w * h).fill(-1), stack = new Int32Array(w * h);
    const cx = w / 2, cy = h / 2; let best = null, id = 0;
    for (let i0 = 0; i0 < w * h; i0++) {
      if (lab[i0] !== -1 || !mask[i0]) continue;
      let sp = 0, area = 0, sx = 0, sy = 0, touch = 0; stack[sp++] = i0; lab[i0] = id;
      while (sp) {
        const i = stack[--sp], x = i % w, y = (i / w) | 0; area++; sx += x; sy += y;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touch++;
        if (x > 0 && lab[i - 1] === -1 && mask[i - 1]) { lab[i - 1] = id; stack[sp++] = i - 1; }
        if (x < w - 1 && lab[i + 1] === -1 && mask[i + 1]) { lab[i + 1] = id; stack[sp++] = i + 1; }
        if (y > 0 && lab[i - w] === -1 && mask[i - w]) { lab[i - w] = id; stack[sp++] = i - w; }
        if (y < h - 1 && lab[i + w] === -1 && mask[i + w]) { lab[i + w] = id; stack[sp++] = i + w; }
      }
      const frac = area / (w * h);
      if (frac > 0.06 && frac < 0.985) {
        const mx = sx / area / w - 0.5, my = sy / area / h - 0.5, off = Math.hypot(mx, my);
        const score = frac * (1.2 - off) * (touch > (w + h) ? 0.6 : 1);
        if (!best || score > best.score) best = { score, id };
      }
      id++;
    }
    if (!best) return null;
    const pts = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (lab[i] !== best.id) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || lab[i - 1] !== best.id || lab[i + 1] !== best.id || lab[i - w] !== best.id || lab[i + w] !== best.id) pts.push([x + 0.5, y + 0.5]);
    }
    return pts;
  }

  function hull(pts) {
    if (pts.length < 4) return null;
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    up.pop(); lo.pop(); return lo.concat(up);
  }

  const area = q => Math.abs(q.reduce((a, p, i) => { const n = q[(i + 1) % q.length]; return a + p[0] * n[1] - n[0] * p[1]; }, 0)) / 2;

  /* Largest quadrilateral with vertices on the hull (hull thinned to <= 22 points). */
  function maxQuad(H) {
    let pts = H;
    if (pts.length > 22) { // keep the most "cornery" points
      const n = pts.length, turn = pts.map((p, i) => {
        const a = pts[(i - 3 + n) % n], b = pts[(i + 3) % n];
        const v1 = [p[0] - a[0], p[1] - a[1]], v2 = [b[0] - p[0], b[1] - p[1]];
        return { i, t: Math.abs(Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1])) };
      }).sort((a, b) => b.t - a.t).slice(0, 22).map(o => o.i).sort((a, b) => a - b);
      pts = turn.map(i => H[i]);
    }
    const n = pts.length; if (n < 4) return null;
    let best = 0, q = null;
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
      const A = area([pts[a], pts[b], pts[c], pts[d]]); if (A > best) { best = A; q = [pts[a], pts[b], pts[c], pts[d]]; }
    }
    return q;
  }

  function order(q) { // TL, TR, BR, BL
    const c = q.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
    const s = q.slice().sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
    let ti = 0; s.forEach((p, i) => { if (p[0] + p[1] < s[ti][0] + s[ti][1]) ti = i; });
    return [0, 1, 2, 3].map(k => s[(ti + k) % 4]);
  }

  function sample(arr, w, h, x, y) {
    const x0 = clamp(Math.floor(x), 0, w - 2), y0 = clamp(Math.floor(y), 0, h - 2), fx = clamp(x - x0, 0, 1), fy = clamp(y - y0, 0, 1), i = y0 * w + x0;
    return arr[i] * (1 - fx) * (1 - fy) + arr[i + 1] * fx * (1 - fy) + arr[i + w] * (1 - fx) * fy + arr[i + w + 1] * fx * fy;
  }

  /* How much of each side is backed by a real edge (gradient across the side). */
  function support(q, G, T) {
    const res = [];
    for (let s = 0; s < 4; s++) {
      const a = q[s], b = q[(s + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 4) return null;
      const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L; let hit = 0, tot = 0;
      for (let t = 0.04; t <= 0.96; t += 1.5 / L) {
        const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t; tot++;
        if (x < 1.5 || y < 1.5 || x > G.w - 2.5 || y > G.h - 2.5) { hit += 0.55; continue; } // side on the photo border: neutral
        let m = 0;
        for (let d = -2; d <= 2; d++) { const px = x + nx * d, py = y + ny * d; const v = Math.abs(sample(G.gx, G.w, G.h, px, py) * nx + sample(G.gy, G.w, G.h, px, py) * ny); if (v > m) m = v; }
        if (m > T) hit++;
      }
      res.push(tot ? hit / tot : 0);
    }
    return res;
  }

  /* Colour difference between a strip just inside and just outside each side. A real paper border
     separates paper from table; a line of text inside the page does not. */
  function contrast(q, G) {
    const cen = q.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]), sw = Math.max(3, Math.min(G.w, G.h) * 0.04), res = [];
    for (let s = 0; s < 4; s++) {
      const a = q[s], b = q[(s + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L; const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if ((cen[0] - mx) * nx + (cen[1] - my) * ny < 0) { nx = -nx; ny = -ny; }
      const acc = [[0, 0, 0, 0], [0, 0, 0, 0]];
      for (let t = 0.1; t <= 0.9; t += 0.04) {
        const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
        for (const [k, sg] of [[0, 1], [1, -1]]) for (let d = 2; d <= 2 + sw; d += 1.5) {
          const px = x + nx * d * sg, py = y + ny * d * sg; if (px < 0 || py < 0 || px > G.w - 2 || py > G.h - 2) continue;
          acc[k][0] += sample(G.R, G.w, G.h, px, py); acc[k][1] += sample(G.Gc, G.w, G.h, px, py); acc[k][2] += sample(G.B, G.w, G.h, px, py); acc[k][3]++;
        }
      }
      if (acc[1][3] < 5 || acc[0][3] < 5) { res.push(0.6); continue; } // side lies on the photo border
      const di = Math.hypot(acc[0][0] / acc[0][3] - acc[1][0] / acc[1][3], acc[0][1] / acc[0][3] - acc[1][1] / acc[1][3], acc[0][2] / acc[0][3] - acc[1][2] / acc[1][3]);
      res.push(clamp(di / 45, 0, 1));
    }
    return res;
  }

  /* Straight lines through edge pixels (Hough), combined into quadrilaterals. */
  function houghQuads(S) {
    const { w, h, gx, gy, mag } = S, T = percentile(mag, 0.86);
    const D = Math.ceil(Math.hypot(w, h)), NT = 180, acc = new Float32Array(NT * (2 * D + 1));
    const cs = [], sn = []; for (let t = 0; t < NT; t++) { cs.push(Math.cos(t * Math.PI / NT)); sn.push(Math.sin(t * Math.PI / NT)); }
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      const i = y * w + x, m = mag[i]; if (m < T) continue;
      const ux = gx[i] / m, uy = gy[i] / m; // non-maximum suppression along the gradient
      if (m < mag[Math.round(y + uy) * w + Math.round(x + ux)] || m < mag[Math.round(y - uy) * w + Math.round(x - ux)]) continue;
      const th = Math.atan2(uy, ux); let t0 = Math.round(((th % Math.PI) + Math.PI) % Math.PI / Math.PI * NT);
      for (let dt = -6; dt <= 6; dt++) { const t = (t0 + dt + NT) % NT, r = Math.round(x * cs[t] + y * sn[t]) + D; acc[t * (2 * D + 1) + r] += 1; }
    }
    const peaks = [], used = new Uint8Array(acc.length), W2 = 2 * D + 1;
    const idx = Array.from(acc.keys()).filter(i => acc[i] > Math.min(w, h) * 0.15).sort((a, b) => acc[b] - acc[a]);
    for (const i of idx) {
      if (peaks.length >= 18) break; if (used[i]) continue;
      const t = (i / W2) | 0, r = i % W2 - D; peaks.push({ t, r, v: acc[i] });
      for (let dt = -5; dt <= 5; dt++) for (let dr = -8; dr <= 8; dr++) { const tt = t + dt, rr = r + dr; let T2 = tt, R2 = rr; if (tt < 0) { T2 = tt + NT; R2 = -rr; } if (tt >= NT) { T2 = tt - NT; R2 = -rr; } const j = T2 * W2 + R2 + D; if (j >= 0 && j < used.length) used[j] = 1; }
    }
    const line = p => ({ c: cs[p.t], s: sn[p.t], r: p.r, t: p.t });
    const L = peaks.map(line), adiff = (a, b) => { const d = Math.abs(a.t - b.t) % NT; return Math.min(d, NT - d); };
    const pairs = [];
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) if (adiff(L[i], L[j]) < 22) {
      // distance between the two lines at the image centre
      const d = Math.abs((w / 2 * L[i].c + h / 2 * L[i].s - L[i].r) - (w / 2 * L[j].c + h / 2 * L[j].s - L[j].r) * Math.sign(L[i].c * L[j].c + L[i].s * L[j].s));
      if (d > Math.min(w, h) * 0.2) pairs.push([L[i], L[j]]);
    }
    const X = (a, b) => { const det = a.c * b.s - a.s * b.c; if (Math.abs(det) < 1e-6) return null; return [(a.r * b.s - b.r * a.s) / det, (a.c * b.r - b.c * a.r) / det]; };
    const quads = [];
    for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
      const [a1, a2] = pairs[i], [b1, b2] = pairs[j]; const ad = adiff(a1, b1); if (ad < 55) continue;
      const pts = [X(a1, b1), X(a1, b2), X(a2, b1), X(a2, b2)]; if (pts.some(p => !p || p[0] < -w * 0.03 || p[1] < -h * 0.03 || p[0] > w * 1.03 || p[1] > h * 1.03)) continue;
      quads.push(order(pts.map(p => [clamp(p[0], 0, w), clamp(p[1], 0, h)])));
      if (quads.length > 900) return quads;
    }
    return quads;
  }

  function angles(q) {
    return q.map((p, i) => {
      const a = q[(i + 3) % 4], b = q[(i + 1) % 4], v1 = [a[0] - p[0], a[1] - p[1]], v2 = [b[0] - p[0], b[1] - p[1]];
      return Math.acos(clamp((v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1), -1, 1)) * 180 / Math.PI;
    });
  }
  function convex(q) {
    let sgn = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4], z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (!sgn) sgn = Math.sign(z); else if (Math.sign(z) !== sgn) return false;
    }
    return true;
  }

  /* Snap each side onto the nearby edge (higher resolution): search across the side for the
     strongest gradient with the side's own polarity, fit a line with RANSAC (robust to a finger or
     an object covering part of the side), then intersect neighbouring lines. */
  function refine(q, G, rf, maxMove) {
    const lines = [], R = Math.max(3, Math.round(Math.min(G.w, G.h) * rf)), cen = q.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
    for (let s = 0; s < 4; s++) {
      const a = q[s], b = q[(s + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
      const mx0 = (a[0] + b[0]) / 2, my0 = (a[1] + b[1]) / 2;
      if ((cen[0] - mx0) * nx + (cen[1] - my0) * ny < 0) { nx = -nx; ny = -ny; } // normal points inward
      const N = Math.min(90, Math.max(14, Math.round(L / 5)));
      const raw = [];
      for (let k = 1; k < N; k++) {
        const t = 0.04 + 0.92 * k / N, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
        const cand = [];
        for (let d = -R; d <= R; d += 0.5) {
          const px = x + nx * d, py = y + ny * d; if (px < 1 || py < 1 || px > G.w - 2 || py > G.h - 2) continue;
          const v = sample(G.gx, G.w, G.h, px, py) * nx + sample(G.gy, G.w, G.h, px, py) * ny;
          cand.push([v, d]);
        }
        raw.push({ x, y, cand });
      }
      // polarity: sign of the strongest response nearest the current side
      let pos = 0, neg = 0;
      for (const r of raw) { let m = null; for (const c of r.cand) if (!m || Math.abs(c[0]) * (1 - Math.abs(c[1]) / (2 * R)) > Math.abs(m[0]) * (1 - Math.abs(m[1]) / (2 * R))) m = c; if (m) { if (m[0] > 0) pos++; else neg++; } }
      const sg = pos >= neg ? 1 : -1;
      let pts = [];
      for (const r of raw) {
        let bm = 0, bd = 0; for (const c of r.cand) { const v = c[0] * sg; if (v > bm) { bm = v; bd = c[1]; } }
        if (bm > G.T) pts.push([r.x + nx * bd, r.y + ny * bd]);
      }
      if (pts.length < Math.max(6, N * 0.3)) { lines.push(null); continue; }
      // RANSAC
      const tol = Math.max(1.5, Math.min(G.w, G.h) * 0.003); let bestIn = null;
      for (let it = 0; it < 80; it++) {
        const p1 = pts[(Math.random() * pts.length) | 0], p2 = pts[(Math.random() * pts.length) | 0];
        const dx = p2[0] - p1[0], dy = p2[1] - p1[1], l = Math.hypot(dx, dy); if (l < L * 0.15) continue;
        const ux = dx / l, uy = dy / l; const inl = pts.filter(p => Math.abs((p[0] - p1[0]) * -uy + (p[1] - p1[1]) * ux) < tol);
        if (!bestIn || inl.length > bestIn.length) bestIn = inl;
      }
      if (!bestIn || bestIn.length < Math.max(5, N * 0.25)) { lines.push(null); continue; }
      const mx = bestIn.reduce((s, p) => s + p[0], 0) / bestIn.length, my = bestIn.reduce((s, p) => s + p[1], 0) / bestIn.length;
      let sxx = 0, sxy = 0, syy = 0; for (const p of bestIn) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
      const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      lines.push({ p: [mx, my], d: [Math.cos(th), Math.sin(th)] });
    }
    const out = [];
    for (let i = 0; i < 4; i++) {
      const l1 = lines[(i + 3) % 4], l2 = lines[i];
      if (!l1 || !l2) { out.push(q[i]); continue; }
      const den = l1.d[0] * l2.d[1] - l1.d[1] * l2.d[0];
      if (Math.abs(den) < 1e-6) { out.push(q[i]); continue; }
      const t = ((l2.p[0] - l1.p[0]) * l2.d[1] - (l2.p[1] - l1.p[1]) * l2.d[0]) / den;
      const P = [l1.p[0] + l1.d[0] * t, l1.p[1] + l1.d[1] * t];
      out.push(Math.hypot(P[0] - q[i][0], P[1] - q[i][1]) < Math.min(G.w, G.h) * maxMove ? [clamp(P[0], 0, G.w), clamp(P[1], 0, G.h)] : q[i]);
    }
    return out;
  }

  function grad(canvas, maxSide) {
    const G = toGray(canvas, maxSide); G.g = boxBlur(G.g, G.w, G.h, 1);
    Object.assign(G, sobel(G.g, G.w, G.h));
    G.T = Math.max(percentile(G.mag, 0.82), 18);
    return G;
  }

  function detect(canvas) {
    const W = canvas.width, H = canvas.height;
    const S = grad(canvas, 380), { w, h } = S;
    const g = boxBlur(S.g, w, h, 1);
    const cands = [];
    const add = (mask, tag) => {
      if (!mask) return; const pts = bestRegion(mask, w, h); if (!pts) return; const hl = hull(pts); if (!hl) return;
      const q = maxQuad(hl); if (q) cands.push({ q: order(q), tag });
    };
    // 1-2: brightness split (paper lighter or darker than the table)
    const t = otsu(g, 0, 255);
    const mB = new Uint8Array(w * h), mD = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) { mB[i] = g[i] > t ? 1 : 0; mD[i] = g[i] <= t ? 1 : 0; }
    add(open(mB, w, h, 2), 'claro'); add(open(mD, w, h, 2), 'escuro');
    // 3: "whiteness" — bright and unsaturated (white paper on a coloured or wooden surface)
    const wh = new Float32Array(w * h); for (let i = 0; i < w * h; i++) wh[i] = g[i] * (1 - Math.min(1, S.sat[i] * 1.6));
    const tw = otsu(wh, 0, 255), mW = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) mW[i] = wh[i] > tw ? 1 : 0;
    add(open(mW, w, h, 2), 'branco');
    // 4: area enclosed by strong edges (works when paper and table have similar brightness)
    const te = Math.max(otsu(S.mag, 0, percentile(S.mag, 0.995) || 1), S.T);
    let E = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) E[i] = S.mag[i] > te ? 1 : 0;
    E = close(E, w, h, 2);
    const reach = new Uint8Array(w * h), st = [];
    for (let x = 0; x < w; x++) { st.push(x, (h - 1) * w + x); } for (let y = 0; y < h; y++) { st.push(y * w, y * w + w - 1); }
    while (st.length) { const i = st.pop(); if (reach[i] || E[i]) continue; reach[i] = 1; const x = i % w; if (x > 0) st.push(i - 1); if (x < w - 1) st.push(i + 1); if (i >= w) st.push(i - w); if (i < w * (h - 1)) st.push(i + w); }
    const mE = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) mE[i] = reach[i] ? 0 : 1;
    add(open(mE, w, h, 1), 'contorno');

    for (const q of houghQuads(S)) cands.push({ q, tag: 'linhas' });

    // score candidates: each side must sit on an edge AND separate two different colours
    let best = null;
    for (const c of cands) {
      const A = area(c.q) / (w * h); if (A < 0.06 || !convex(c.q)) continue;
      const ang = angles(c.q); if (Math.min(...ang) < 40 || Math.max(...ang) > 140) continue;
      const sup = support(c.q, S, S.T * 0.8); if (!sup) continue;
      const con = contrast(c.q, S), side = sup.map((v, i) => v * (0.35 + 0.65 * con[i]));
      const mean = side.reduce((a, b) => a + b, 0) / 4, mn = Math.min(...side);
      let score = (0.55 * mean + 0.45 * mn) * Math.sqrt(Math.min(1, A / 0.3));
      if (A > 0.96) score *= 0.35;
      c.score = score; c.A = A;
      if (!best || score > best.score) best = c;
    }
    // A line of text can look like a page border. Among near-best candidates that contain the
    // best one, prefer the largest: the real page is the outermost strong rectangle.
    if (best) {
      const inside = (q, p) => { let s = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4], z = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); if (!s) s = Math.sign(z); else if (Math.sign(z) !== s) return false; } return true; };
      for (const c of cands) if (c.score >= best.score * 0.78 && c.A > best.A * 1.08 && c.A < 0.96 && best.q.every(p => inside(c.q, [p[0] * 0.98 + c.q.reduce((a, r) => a + r[0], 0) / 4 * 0.02, p[1] * 0.98 + c.q.reduce((a, r) => a + r[1], 0) / 4 * 0.02]))) { if (!best.big || c.A > best.big.A) best.big = c; }
      if (best.big) best = best.big;
    }
    if (!best || best.score < 0.22) {
      const m = 0.07; return { quad: [[W * m, H * m], [W * (1 - m), H * m], [W * (1 - m), H * (1 - m)], [W * m, H * (1 - m)]], ok: false, score: best ? best.score : 0 };
    }
    // refine at higher resolution
    const R = grad(canvas, 1100), k = R.w / w;
    let q = best.q.map(p => [p[0] * k, p[1] * k]);
    q = refine(q, R, 0.045, 0.2); q = refine(q, R, 0.015, 0.05);
    const fx = W / R.w, fy = H / R.h;
    return { quad: order(q).map(p => [clamp(p[0] * fx, 0, W), clamp(p[1] * fy, 0, H)]), ok: true, score: best.score, tag: best.tag };
  }

  global.ScanDetect = { detect };
})(window);
