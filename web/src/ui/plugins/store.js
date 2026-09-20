import { validateBundle, validateConfig } from './protocol'
const DB = 'ga-admin-ui-plugins-v1'
export function createPluginStore(factory = () => globalThis.indexedDB) {
  async function transact(mode, operation) {
    const idb = factory()
    if (!idb) throw new Error('IndexedDB unavailable; nothing was saved')
    const db = await new Promise((resolve, reject) => {
      const request = idb.open(DB, 1)
      request.onupgradeneeded = () => request.result.createObjectStore('records')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('Cannot open plugin storage'))
      request.onblocked = () => reject(new Error('Plugin storage blocked; close other tabs'))
    })
    return new Promise((resolve, reject) => {
      let result
      const tx = db.transaction('records', mode)
      tx.oncomplete = () => { db.close(); resolve(result) }
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error('Plugin storage failed; nothing was saved')) }
      try { operation(tx.objectStore('records'), value => { result = value }) }
      catch (error) { tx.abort(); db.close(); reject(error) }
    })
  }
  const get = key => transact('readonly', (s, done) => { s.get(key).onsuccess = e => done(e.target.result) })
  return {
    async list() { return transact('readonly', (s, done) => { s.getAll().onsuccess = e => done(e.target.result.filter(x => x?.manifest).map(validateBundle)) }) },
    async load(id) { const item = await get('plugin:' + id); if (!item) throw new Error('Plugin not installed'); return validateBundle(item) },
    async install(input) { const bundle = validateBundle(input); await transact('readwrite', s => { const r = s.get('plugin:' + bundle.manifest.id); r.onsuccess = () => { if (r.result) { s.transaction.abort(); return }; s.put(bundle, 'plugin:' + bundle.manifest.id) } }); return bundle },
    async saveConfig(id, config) { const bundle = validateBundle(await get('plugin:' + id)); bundle.config = validateConfig(bundle.schema, config); await transact('readwrite', s => s.put(bundle, 'plugin:' + id)); return bundle },
    async active() { return (await get('active')) || 'default' },
    async activate(id) { if (id !== 'default') await this.load(id); await transact('readwrite', s => s.put(id, 'active')) },
  }
}
export const pluginStore = createPluginStore()
