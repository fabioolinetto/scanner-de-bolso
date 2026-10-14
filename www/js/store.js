/* Scanner de Bolso — armazenamento no aparelho (IndexedDB).
 * docs:  {id, name, createdAt, updatedAt, pageIds:[], cover}
 * pages: {id, docId, src:Blob (foto original já girada), out:Blob (resultado), quad, rot, filter}
 * Nada é apagado sem uma ação explícita de excluir. */
const Store = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('scanner-de-bolso', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'id' }).createIndex('docId', 'docId');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    // pede ao sistema para não limpar estes dados por falta de espaço
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
    return dbp;
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function tx(stores, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(stores, mode); let out;
      Promise.resolve(fn(t)).then(v => { out = v; }, rej);
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  return {
    async listDocs() { const all = await tx(['docs'], 'readonly', t => req(t.objectStore('docs').getAll())); return all.sort((a, b) => b.updatedAt - a.updatedAt); },
    getDoc: id => tx(['docs'], 'readonly', t => req(t.objectStore('docs').get(id))),
    putDoc: d => tx(['docs'], 'readwrite', t => req(t.objectStore('docs').put(d))),
    getPage: id => tx(['pages'], 'readonly', t => req(t.objectStore('pages').get(id))),
    putPage: p => tx(['pages'], 'readwrite', t => req(t.objectStore('pages').put(p))),
    deletePage: id => tx(['pages'], 'readwrite', t => req(t.objectStore('pages').delete(id))),
    async deleteDoc(id) {
      return tx(['docs', 'pages'], 'readwrite', async t => {
        const ids = await req(t.objectStore('pages').index('docId').getAllKeys(id));
        for (const k of ids) t.objectStore('pages').delete(k);
        t.objectStore('docs').delete(id);
      });
    },
    uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
  };
})();
