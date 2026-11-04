// Prosty magazyn w IndexedDB: projekty (JSON) i pliki audio (Blob).
const DB_NAME = 'wersy';
let dbp;

function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('projects', { keyPath: 'id' });
        db.createObjectStore('blobs');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}

export const db = {
  allProjects: () => tx('projects', 'readonly', s => s.getAll()),
  putProject: p => tx('projects', 'readwrite', s => s.put(JSON.parse(JSON.stringify(p)))),
  deleteProject: id => tx('projects', 'readwrite', s => s.delete(id)),
  getBlob: key => tx('blobs', 'readonly', s => s.get(key)),
  putBlob: (key, blob) => tx('blobs', 'readwrite', s => s.put(blob, key)),
  deleteBlob: key => tx('blobs', 'readwrite', s => s.delete(key)),
};

// Prośba o trwałe przechowywanie (żeby Safari nie czyścił danych).
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
