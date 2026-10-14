/* Scanner de Bolso — telas, armazenamento, recorte, envio. */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const FILTERS = { magico: 'Mágico', pb: 'Preto e branco', cinza: 'Cinza', original: 'Original' };
const CAP = window.Capacitor;
const NATIVE = !!(CAP && CAP.isNativePlatform && CAP.isNativePlatform());
const plug = n => (NATIVE && CAP.registerPlugin) ? CAP.registerPlugin(n) : null;
const Camera = plug('Camera'), Filesystem = plug('Filesystem'), Share = plug('Share'), App = plug('App');
const HANDLE = '#ffc41f';

/* ---------------- interface helpers ---------------- */
let toastT;
function toast(msg, ms = 2800) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms); }
async function busy(msg, fn) { $('#busyMsg').textContent = msg; $('#busy').hidden = false; await frame(); try { return await fn(); } finally { $('#busy').hidden = true; } }
const setBusyMsg = m => { $('#busyMsg').textContent = m; };
const plural = n => n === 1 ? '1 página' : n + ' páginas';
function fmtWhen(ts) {
  const d = new Date(ts), now = new Date(), z = n => String(n).padStart(2, '0');
  const hm = `${z(d.getHours())}:${z(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return 'hoje, ' + hm;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'ontem, ' + hm;
  return `${z(d.getDate())}/${z(d.getMonth() + 1)}/${d.getFullYear()}, ${hm}`;
}
function defaultName() { const d = new Date(), z = n => String(n).padStart(2, '0'); return `Scan ${z(d.getDate())}-${z(d.getMonth() + 1)}-${d.getFullYear()} ${z(d.getHours())}h${z(d.getMinutes())}`; }
const safeName = n => (n || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Documento';

let confirmCb = null;
function confirmSheet(title, text, yes, cb) { $('#cTitle').textContent = title; $('#cText').textContent = text; $('#cYes').textContent = yes; confirmCb = cb; $('#confirmSheet').hidden = false; }
$('#cNo').onclick = () => { $('#confirmSheet').hidden = true; confirmCb = null; };
$('#cYes').onclick = async () => { $('#confirmSheet').hidden = true; const cb = confirmCb; confirmCb = null; if (cb) await cb(); };
$$('.sheetwrap').forEach(w => w.addEventListener('click', e => { if (e.target === w) w.hidden = true; }));

/* ---------------- state ---------------- */
let cur = null;   // documento aberto: {id, name, createdAt, pages:[page], stored:bool}
let viewIdx = -1, ed = null;

/* ---------------- Meus documentos ---------------- */
async function renderHome() {
  let docs = [];
  try { docs = await Store.listDocs(); } catch (e) { toast('Não consegui ler os documentos guardados.'); }
  $('#docCount').textContent = docs.length;
  const L = $('#docList'); L.innerHTML = '';
  if (!docs.length) {
    L.innerHTML = `<div class="empty"><img src="icons/icon-192.png" alt=""><h2>Nenhum documento ainda</h2><p>Toque em <b>Escanear</b> para fotografar a primeira página. Tudo fica guardado aqui no celular.</p></div>`;
    return;
  }
  for (const d of docs) {
    const b = document.createElement('button'); b.className = 'docrow';
    b.innerHTML = `<img class="cover" alt="" src="${d.cover || 'icons/icon-192.png'}"><span class="info"><span class="name"></span><span class="when">${plural(d.pageIds.length)} · ${fmtWhen(d.updatedAt)}</span></span><svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>`;
    b.querySelector('.name').textContent = d.name;
    b.onclick = () => openDoc(d.id);
    L.appendChild(b);
  }
}
function showHome() { $('#doc').hidden = true; $('#home').hidden = false; cur = null; renderHome(); }

function newDoc() {
  cur = { id: Store.uid(), name: defaultName(), createdAt: Date.now(), pages: [], stored: false };
  showDoc();
}
async function openDoc(id) {
  const d = await Store.getDoc(id); if (!d) { toast('Documento não encontrado.'); renderHome(); return; }
  await busy('Abrindo…', async () => {
    const pages = [];
    for (let i = 0; i < d.pageIds.length; i++) {
      setBusyMsg(`Abrindo página ${i + 1} de ${d.pageIds.length}…`);
      const r = await Store.getPage(d.pageIds[i]); if (!r) continue;
      const p = { id: r.id, quad: r.quad, rot: r.rot || 0, filter: r.filter || 'magico', srcBlob: r.src, outBlob: r.out, src: null, stored: true };
      try { p.filtered = await blobToCanvas(r.out, 4000); p.rot = 0; compose(p); p.rot = r.rot || 0; p.out = p.filtered; }
      catch (e) { p.filtered = mk(300, 400); compose(p); }
      p.ver = 0; pages.push(p); await frame();
    }
    cur = { id: d.id, name: d.name, createdAt: d.createdAt, pages, stored: true };
  });
  showDoc();
}
/* A página guardada já tem a rotação aplicada no "out"; ao reprocessar, partimos do original. */

/* ---------------- Documento ---------------- */
const ADD_ICON = '<svg viewBox="0 0 24 24"><path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.6"/><path d="M19.5 1.5v5M17 4h5"/></svg>';
function showDoc() {
  $('#home').hidden = true; $('#doc').hidden = false;
  $('#docName').value = cur.name; renderDoc(); setSave(cur.stored ? 'saved' : 'new');
}
function renderDoc() {
  const n = cur.pages.length;
  $('#pageCount').textContent = plural(n);
  $('#bOut').disabled = !n;
  const g = $('#pageGrid'); g.innerHTML = '';
  cur.pages.forEach((p, i) => {
    const b = document.createElement('button'); b.className = 'card'; b.setAttribute('aria-label', 'Abrir página ' + (i + 1));
    b.innerHTML = `<div class="pg"><img alt="" src="${p.thumb}"></div><div class="cap"><span class="num">${String(i + 1).padStart(2, '0')}</span><span>${FILTERS[p.filter]}</span></div>`;
    b.onclick = () => openViewer(i); g.appendChild(b);
  });
  const add = document.createElement('label'); add.className = 'card addcard pick'; add.dataset.pick = 'cam';
  add.innerHTML = `<div class="pg">${ADD_ICON}<span>${n ? 'Adicionar página' : 'Fotografar a primeira página'}</span></div><div class="cap"><span class="num">${String(n + 1).padStart(2, '0')}</span><span>câmera</span></div><input type="file" class="inCam" accept="image/*" capture="environment" aria-label="Adicionar página">`;
  g.appendChild(add);
}
function setSave(state) {
  const el = $('#saveState'); el.className = 'savestate';
  if (state === 'saving') { el.textContent = 'Salvando…'; el.classList.add('saving'); }
  else if (state === 'saved') { el.textContent = 'Salvo no aparelho'; el.classList.add('saved'); }
  else if (state === 'error') { el.textContent = 'Não foi possível salvar'; }
  else el.textContent = 'Ainda sem páginas';
}
$('#docBack').onclick = () => showHome();
$('#docName').addEventListener('focus', e => setTimeout(() => e.target.select(), 0));
$('#docName').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('#docName').addEventListener('change', () => { if (!cur) return; cur.name = $('#docName').value.trim() || defaultName(); $('#docName').value = cur.name; if (cur.pages.length) save(); });

/* ---------------- gravação (fila: uma gravação de cada vez) ---------------- */
let chain = Promise.resolve(), pending = 0;
function save(extra) {
  const doc = cur; if (!doc) return chain;
  pending++; setSave('saving');
  chain = chain.then(async () => {
    if (extra) await extra();
    for (const p of doc.pages) {
      if (p.stored && !p.dirtySrc && !p.dirtyOut) continue;
      if (p.dirtySrc || !p.srcBlob) { p.srcBlob = await canvasToBlob(p.src, 0.92); p.dirtySrc = false; }
      if (p.dirtyOut || !p.outBlob) { p.outBlob = await canvasToBlob(p.out, 0.9); p.dirtyOut = false; }
      await Store.putPage({ id: p.id, docId: doc.id, src: p.srcBlob, out: p.outBlob, quad: p.quad, rot: p.rot, filter: p.filter });
      p.stored = true;
    }
    if (doc.pages.length) {
      await Store.putDoc({ id: doc.id, name: doc.name, createdAt: doc.createdAt, updatedAt: Date.now(), pageIds: doc.pages.map(p => p.id), cover: coverOf(doc.pages[0]) });
      doc.stored = true;
    }
  }).then(() => { if (--pending === 0 && cur === doc) setSave(doc.pages.length ? 'saved' : 'new'); },
           e => { pending--; console.error(e); if (cur === doc) setSave('error'); toast('Não foi possível salvar. Verifique o espaço livre no celular.'); });
  return chain;
}
function coverOf(p) { const o = p.out, s = 140 / Math.max(o.width, o.height), c = mk(o.width * s, o.height * s); const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(o, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.72); }

/* ---------------- menu do documento ---------------- */
$('#docMenu').onclick = () => { $('#menuSheet').hidden = false; };
$('#mClose').onclick = () => { $('#menuSheet').hidden = true; };
$('#mRename').onclick = () => { $('#menuSheet').hidden = true; const i = $('#docName'); i.focus(); };
$('#mOut').onclick = () => { $('#menuSheet').hidden = true; openOut(); };
$('#mDelete').onclick = () => {
  $('#menuSheet').hidden = true;
  confirmSheet('Excluir este documento?', `“${cur.name}” e ${plural(cur.pages.length)} serão apagados do celular. Isso não pode ser desfeito.`, 'Excluir documento', async () => {
    const id = cur.id; await chain; await Store.deleteDoc(id); toast('Documento excluído'); showHome();
  });
};

/* ---------------- entrada de fotos ---------------- */
function newPageFrom(src) { const r = ScanDetect.detect(src); return { id: Store.uid(), src, quad: r.quad, found: r.ok, rot: 0, filter: 'magico', dirtySrc: true, dirtyOut: true, stored: false, ver: 0 }; }
async function addOne(blob) {
  const page = await busy('Procurando as bordas…', async () => newPageFrom(await blobToCanvas(blob)));
  openEditor(page, true);
}
async function addMany(blobs) {
  if (blobs.length === 1) return addOne(blobs[0]);
  let n = 0;
  await busy('Processando…', async () => {
    for (const b of blobs) {
      setBusyMsg(`Processando ${++n} de ${blobs.length}…`); await frame();
      try { const p = newPageFrom(await blobToCanvas(b)); processAll(p); p.warped = null; p.srcData = null; cur.pages.push(p); }
      catch (e) { toast('Uma das fotos não pôde ser aberta.'); }
    }
  });
  renderDoc(); save(); toast(`${blobs.length} páginas adicionadas. Toque numa para ajustar o recorte.`);
}
async function pick(kind, fromHome) {
  if (fromHome || !cur) newDoc();
  if (!NATIVE) return; // no navegador, o próprio <input type=file> cuida disso
  try {
    if (kind === 'cam') {
      const ph = await Camera.getPhoto({ source: 'CAMERA', resultType: 'uri', quality: 92, correctOrientation: true, saveToGallery: false, width: 2400 });
      await addOne(await (await fetch(ph.webPath)).blob());
    } else {
      const r = await Camera.pickImages({ quality: 92, limit: 0, width: 2400 });
      const blobs = []; for (const ph of r.photos) blobs.push(await (await fetch(ph.webPath)).blob());
      if (blobs.length) await addMany(blobs);
    }
  } catch (e) { if (!/cancel/i.test(String(e && (e.message || e)))) toast('Não consegui abrir a câmera/galeria.'); }
}
// Toques nos botões de câmera/galeria
document.addEventListener('click', e => {
  const l = e.target.closest('[data-pick]'); if (!l) return;
  const fromHome = !!l.closest('#home');
  if (NATIVE) { e.preventDefault(); pick(l.dataset.pick, fromHome); }
  else if (fromHome) newDoc(); // o input abre normalmente; o documento novo já fica pronto
}, true);
document.addEventListener('change', e => {
  const t = e.target; if (!t.files || !t.files.length) return;
  const files = Array.from(t.files); t.value = '';
  if (!cur) newDoc();
  if (t.classList.contains('inCam')) addOne(files[0]); else addMany(files);
});

/* ---------------- recorte ---------------- */
function openEditor(page, isNew) {
  ed = { page, isNew, q: page.quad.map(p => p.slice()), drag: -1, rotated: false, origSrc: page.src, origQuad: page.quad };
  $('#eApply').textContent = isNew ? 'Adicionar' : 'Salvar recorte';
  $('#eTitle').textContent = isNew ? `Página ${cur.pages.length + 1}` : 'Recortar página';
  const h = $('#eHint');
  if (isNew && page.found === false) { h.textContent = 'Não achei as bordas: arraste os pontos até os cantos'; h.className = 'warn'; }
  else { h.textContent = 'Arraste os pontos ou as laterais para ajustar'; h.className = ''; }
  $('#editor').hidden = false; requestAnimationFrame(layoutEditor);
}
function closeEditor() { $('#editor').hidden = true; ed = null; }
function layoutEditor() {
  if (!ed) return; const st = $('#eStage'), cs = getComputedStyle(st);
  const aw = st.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), ah = st.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const W = ed.page.src.width, H = ed.page.src.height, sc = Math.min(aw / W, ah / H);
  ed.scale = sc; ed.cw = Math.round(W * sc); ed.ch = Math.round(H * sc); ed.dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = $('#editCanvas'); cv.width = ed.cw * ed.dpr; cv.height = ed.ch * ed.dpr; cv.style.width = ed.cw + 'px'; cv.style.height = ed.ch + 'px';
  ed.disp = mk(ed.cw * ed.dpr, ed.ch * ed.dpr); const dx = ed.disp.getContext('2d'); dx.imageSmoothingQuality = 'high'; dx.drawImage(ed.page.src, 0, 0, ed.disp.width, ed.disp.height);
  drawEditor();
}
const mids = q => q.map((p, i) => { const n = q[(i + 1) % 4]; return [(p[0] + n[0]) / 2, (p[1] + n[1]) / 2]; });
function drawEditor() {
  const cv = $('#editCanvas'), x = cv.getContext('2d'), s = ed.scale, cw = ed.cw, ch = ed.ch;
  x.setTransform(ed.dpr, 0, 0, ed.dpr, 0, 0); x.clearRect(0, 0, cw, ch); x.drawImage(ed.disp, 0, 0, cw, ch);
  const P = ed.q.map(p => [p[0] * s, p[1] * s]);
  x.beginPath(); x.rect(0, 0, cw, ch); x.moveTo(...P[0]); for (let i = 1; i < 4; i++) x.lineTo(...P[i]); x.closePath();
  x.fillStyle = 'rgba(233,232,227,.72)'; x.fill('evenodd');
  x.beginPath(); x.moveTo(...P[0]); for (let i = 1; i < 4; i++) x.lineTo(...P[i]); x.closePath(); x.lineWidth = 4; x.strokeStyle = '#1f1b14'; x.stroke(); x.lineWidth = 2.5; x.strokeStyle = HANDLE; x.stroke();
  // laterais (arrastar move o lado inteiro)
  mids(ed.q).forEach((m, i) => {
    const a = P[i], b = P[(i + 1) % 4], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    x.save(); x.translate(m[0] * s, m[1] * s); x.rotate(ang); x.fillStyle = HANDLE; x.strokeStyle = '#1f1b14'; x.lineWidth = 2;
    x.beginPath(); x.roundRect ? x.roundRect(-14, -5, 28, 10, 5) : x.rect(-14, -5, 28, 10); x.fill(); x.stroke(); x.restore();
  });
  P.forEach((p, i) => { x.beginPath(); x.arc(p[0], p[1], i === ed.drag ? 14 : 11, 0, 7); x.fillStyle = HANDLE; x.fill(); x.lineWidth = 3; x.strokeStyle = '#1f1b14'; x.stroke(); });
  if (ed.drag >= 0 && ed.drag < 4) { // lupa: o dedo não esconde o canto
    const p = ed.q[ed.drag], R = 56, Z = 3, right = P[ed.drag][0] < cw / 2, cx = right ? cw - R - 8 : R + 8, cy = R + 8;
    const half = R / (s * Z);
    x.save(); x.beginPath(); x.arc(cx, cy, R, 0, 7); x.clip(); x.fillStyle = '#000'; x.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    x.drawImage(ed.page.src, p[0] - half, p[1] - half, half * 2, half * 2, cx - R, cy - R, 2 * R, 2 * R);
    x.strokeStyle = HANDLE; x.lineWidth = 1.5; x.beginPath(); x.moveTo(cx - 12, cy); x.lineTo(cx + 12, cy); x.moveTo(cx, cy - 12); x.lineTo(cx, cy + 12); x.stroke(); x.restore();
    x.beginPath(); x.arc(cx, cy, R, 0, 7); x.lineWidth = 3; x.strokeStyle = '#1f1b14'; x.stroke();
  }
}
(() => {
  const cv = $('#editCanvas');
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => {
    if (!ed) return; const [mx, my] = pos(e); let bi = -1, bd = 44;
    ed.q.forEach((p, i) => { const d = Math.hypot(p[0] * ed.scale - mx, p[1] * ed.scale - my); if (d < bd) { bd = d; bi = i; } });
    if (bi < 0) mids(ed.q).forEach((p, i) => { const d = Math.hypot(p[0] * ed.scale - mx, p[1] * ed.scale - my); if (d < bd) { bd = d; bi = 4 + i; } });
    if (bi < 0) return;
    ed.drag = bi; ed.start = [mx, my]; ed.q0 = ed.q.map(p => p.slice());
    cv.setPointerCapture(e.pointerId); drawEditor(); e.preventDefault();
  });
  cv.addEventListener('pointermove', e => {
    if (!ed || ed.drag < 0) return; const [mx, my] = pos(e), W = ed.page.src.width, H = ed.page.src.height;
    const dx = (mx - ed.start[0]) / ed.scale, dy = (my - ed.start[1]) / ed.scale;
    const mv = i => { ed.q[i] = [clamp(ed.q0[i][0] + dx, 0, W), clamp(ed.q0[i][1] + dy, 0, H)]; };
    if (ed.drag < 4) mv(ed.drag); else { mv(ed.drag - 4); mv((ed.drag - 3) % 4); }
    drawEditor();
  });
  const up = () => { if (ed && ed.drag >= 0) { ed.drag = -1; drawEditor(); } };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
})();
function editorRotate(dir) {
  const p = ed.page, W = p.src.width, H = p.src.height;
  p.src = rotateCanvas(p.src, dir); ed.q = rotatePoints(ed.q, W, H, dir); ed.rotated = true;
  p.srcData = null; p.warped = null; layoutEditor();
}
$('#eRotL').onclick = () => editorRotate(-1);
$('#eRotR').onclick = () => editorRotate(1);
$('#eAuto').onclick = async () => { const r = await busy('Procurando as bordas…', async () => ScanDetect.detect(ed.page.src)); ed.q = r.quad; drawEditor(); if (!r.ok) toast('Não achei as bordas. Ajuste os pontos à mão.'); };
$('#eFull').onclick = () => { ed.q = fullQuad(ed.page.src.width, ed.page.src.height); drawEditor(); };
$('#eCancel').onclick = () => {
  if (ed && !ed.isNew && ed.rotated) { ed.page.src = ed.origSrc; ed.page.srcData = null; ed.page.warped = null; }
  const wasNew = ed && ed.isNew; const back = ed && !ed.isNew ? cur.pages.indexOf(ed.page) : -1;
  closeEditor(); if (back >= 0) openViewer(back); else if (wasNew && cur && !cur.pages.length) renderDoc();
};
$('#eApply').onclick = async () => {
  const { page, isNew, rotated } = ed; page.quad = orderQuad(ed.q);
  await busy('Endireitando…', async () => { processAll(page); });
  page.dirtyOut = true; if (rotated) page.dirtySrc = true; page.warped = null; page.ver = (page.ver || 0) + 1;
  closeEditor();
  if (isNew) { cur.pages.push(page); page.srcData = null; renderDoc(); save(); toast(`Página ${cur.pages.length} adicionada`); requestAnimationFrame(() => { const g = $('#pageGrid'); g.lastElementChild && g.lastElementChild.scrollIntoView({ block: 'end', behavior: 'smooth' }); }); }
  else { page.srcData = null; renderDoc(); save(); openViewer(cur.pages.indexOf(page)); }
};
window.addEventListener('resize', () => { if (ed) layoutEditor(); });

/* ---------------- página ---------------- */
async function ensureSrc(p) {
  if (p.src) return;
  if (!p.srcBlob) { const r = await Store.getPage(p.id); p.srcBlob = r && r.src; }
  p.src = await blobToCanvas(p.srcBlob, 4000);
}
function openViewer(i) {
  viewIdx = i; const p = cur.pages[i]; $('#viewer').hidden = false;
  $('#vTitle').textContent = `Página ${i + 1} de ${cur.pages.length}`;
  const box = $('#viewBox'); box.innerHTML = ''; box.appendChild(p.out);
  $$('.chip').forEach(c => c.setAttribute('aria-pressed', String(c.dataset.f === p.filter)));
}
function closeViewer() { $('#viewer').hidden = true; viewIdx = -1; renderDoc(); }
$('#vBack').onclick = closeViewer;
$('#chips').onclick = async e => {
  const c = e.target.closest('.chip'); if (!c) return; const p = cur.pages[viewIdx]; if (p.filter === c.dataset.f) return;
  p.filter = c.dataset.f;
  await busy('Aplicando filtro…', async () => { await ensureSrc(p); if (!p.warped) warp(p); applyFilter(p); compose(p); p.srcData = null; });
  p.dirtyOut = true; p.ver++; save(); openViewer(viewIdx);
};
async function viewRotate(dir) {
  const p = cur.pages[viewIdx];
  p.rot = ((p.rot + dir) % 4 + 4) % 4;
  // gira o resultado atual sem reprocessar
  p.out = rotateCanvas(p.out, dir);
  const o = p.out, ts = Math.min(1, 360 / Math.max(o.width, o.height)), t = mk(o.width * ts, o.height * ts), tx = t.getContext('2d'); tx.imageSmoothingQuality = 'high'; tx.drawImage(o, 0, 0, t.width, t.height); p.thumb = t.toDataURL('image/jpeg', .8);
  p.dirtyOut = true; p.ver++; save(); openViewer(viewIdx);
}
$('#vRotL').onclick = () => viewRotate(-1);
$('#vRotR').onclick = () => viewRotate(1);
$('#vCrop').onclick = async () => { const p = cur.pages[viewIdx]; await busy('Abrindo original…', () => ensureSrc(p)); $('#viewer').hidden = true; openEditor(p, false); };
$('#vDel').onclick = () => {
  const i = viewIdx;
  confirmSheet('Excluir esta página?', `A página ${i + 1} será apagada deste documento.`, 'Excluir página', async () => {
    const [p] = cur.pages.splice(i, 1); closeViewer();
    if (!cur.pages.length) { await chain; await Store.deleteDoc(cur.id); cur.stored = false; setSave('new'); toast('Página excluída. O documento ficou vazio.'); return; }
    save(() => Store.deletePage(p.id)); toast('Página excluída');
  });
};
$('#vShare').onclick = () => { outFmt = 'jpg'; openOut([cur.pages[viewIdx]]); };

/* ---------------- enviar / salvar ---------------- */
let outFmt = 'pdf', outPages = null, outCache = null, outKey = '';
function cacheKey() { return outFmt + '|' + safeName(cur.name) + '|' + outPages.map(p => p.id + ':' + p.ver).join(','); }
async function buildPdf(pages) {
  const { jsPDF } = window.jspdf; let doc;
  for (let i = 0; i < pages.length; i++) {
    const c = pages[i].out, land = c.width > c.height, o = land ? 'l' : 'p';
    if (!i) doc = new jsPDF({ orientation: o, unit: 'mm', format: 'a4', compress: true }); else doc.addPage('a4', o);
    const pw = land ? 297 : 210, ph = land ? 210 : 297, k = Math.min(pw / c.width, ph / c.height), w = c.width * k, h = c.height * k;
    doc.addImage(c.toDataURL('image/jpeg', 0.85), 'JPEG', (pw - w) / 2, (ph - h) / 2, w, h, undefined, 'FAST');
    setBusyMsg(`Montando PDF… ${i + 1}/${pages.length}`); await frame();
  }
  doc.setProperties({ title: cur.name, creator: 'Scanner de Bolso' });
  return doc.output('blob');
}
async function prepare() {
  const key = cacheKey(); if (outCache && outKey === key) return outCache;
  const base = safeName(cur.name), all = cur.pages; let files;
  if (outFmt === 'pdf') {
    const blob = await busy('Montando PDF…', () => buildPdf(outPages));
    files = [{ name: base + '.pdf', blob, type: 'application/pdf' }];
  } else {
    files = await busy('Preparando imagens…', async () => {
      const out = [];
      for (const p of outPages) { const n = all.indexOf(p) + 1; out.push({ name: base + (all.length > 1 ? ` - pág ${n}` : '') + '.jpg', blob: await canvasToBlob(p.out, 0.9), type: 'image/jpeg' }); await frame(); }
      return out;
    });
  }
  outCache = files; outKey = key; return files;
}
function setFmt(f) { outFmt = f; $$('.fbtn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fmt === f))); }
async function openOut(pages) {
  if (!cur || !cur.pages.length) return; $('#docName').blur();
  outPages = pages || cur.pages; if (!pages) setFmt('pdf'); else setFmt(outFmt);
  $('#outTitle').textContent = cur.name;
  $('#outSub').textContent = pages ? `Página ${cur.pages.indexOf(pages[0]) + 1} de ${cur.pages.length}` : plural(cur.pages.length);
  $('#oSaveHint').textContent = NATIVE ? 'pasta Documentos › Scanner de Bolso' : 'pasta de downloads do aparelho';
  $('#outSheet').hidden = false;
  if (!NATIVE) await prepare(); // no navegador o compartilhamento precisa ser imediato após o toque
}
$('#bOut').onclick = () => openOut();
$('#oClose').onclick = () => { $('#outSheet').hidden = true; };
$$('.fbtn').forEach(b => b.onclick = async () => { setFmt(b.dataset.fmt); if (!NATIVE) await prepare(); });

const b64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
async function nativeWrite(f, directory, folder) {
  const path = (folder ? folder + '/' : '') + f.name;
  const r = await Filesystem.writeFile({ path, data: await b64(f.blob), directory, recursive: true });
  return r.uri;
}
$('#oShare').onclick = async () => {
  const files = await prepare(); if (!files) return;
  try {
    if (NATIVE) {
      const uris = []; for (const f of files) uris.push(await nativeWrite(f, 'CACHE', 'enviar'));
      await Share.share({ title: cur.name, dialogTitle: 'Enviar ' + cur.name, files: uris });
    } else {
      const fs = files.map(f => new File([f.blob], f.name, { type: f.type }));
      if (navigator.canShare && navigator.canShare({ files: fs })) await navigator.share({ files: fs, title: cur.name });
      else { downloadAll(files); toast('Este navegador não compartilha arquivos. Salvei uma cópia para você anexar.', 4500); }
    }
    $('#outSheet').hidden = true;
  } catch (e) { if (!/cancel|abort/i.test(String(e && (e.name + e.message)))) toast('Não foi possível compartilhar agora.'); }
};
$('#oSave').onclick = async () => {
  const files = await prepare(); if (!files) return;
  if (NATIVE) {
    try { for (const f of files) await nativeWrite(f, 'DOCUMENTS', 'Scanner de Bolso'); $('#outSheet').hidden = true; toast(files.length === 1 ? `Salvo em Documentos › Scanner de Bolso` : `${files.length} imagens salvas em Documentos › Scanner de Bolso`, 4000); }
    catch (e) { // alguns aparelhos bloqueiam a pasta pública: oferecemos o "Salvar em…" do sistema
      try { const uris = []; for (const f of files) uris.push(await nativeWrite(f, 'CACHE', 'enviar')); await Share.share({ title: cur.name, dialogTitle: 'Salvar em…', files: uris }); $('#outSheet').hidden = true; }
      catch (e2) { toast('Não foi possível salvar a cópia.'); }
    }
  } else { downloadAll(files); $('#outSheet').hidden = true; toast('Cópia salva no aparelho'); }
};
function downloadAll(files) {
  for (const f of files) { const a = document.createElement('a'); a.href = URL.createObjectURL(f.blob); a.download = f.name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }
}

/* ---------------- botão "voltar" do Android ---------------- */
function handleBack() {
  for (const id of ['confirmSheet', 'menuSheet', 'outSheet']) if (!$('#' + id).hidden) { $('#' + id).hidden = true; return true; }
  if (!$('#editor').hidden) { $('#eCancel').click(); return true; }
  if (!$('#viewer').hidden) { closeViewer(); return true; }
  if (!$('#doc').hidden) { showHome(); return true; }
  return false;
}
if (App) App.addListener('backButton', () => { if (!handleBack()) App.exitApp(); });

/* ---------------- PWA (iPhone / navegador) ---------------- */
if (!NATIVE && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

renderHome();
window.__scanner = { get cur() { return cur; }, openDoc, newDoc, addMany, Store }; // usado nos testes
})();
