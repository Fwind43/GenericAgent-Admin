import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import {saveChatSessionDraftAsync as save, loadChatSessionDraftAttachmentsAsync as load, clearChatSessionDraftsAsync as clear, loadChatSessionDraft, saveChatSessionDraft, CHAT_SESSION_DRAFTS_STORAGE_KEY as key} from './chatSessionDrafts.js'
function storage() {
 const map = new Map()
 return {getItem: k => map.get(k) ?? null, setItem(k,v) {if(v.length > 4096) throw new Error('quota'); map.set(k,v)}, removeItem: k => map.delete(k)}
}
const files = [{id:'large',name:'image.png',dataURL:'data:image/png;base64,'+'A'.repeat(8*1024*1024)}]
test('8MiB attachment uses small index, survives reload and respects instance', async () => {
 const s=storage()
 assert.equal(await save('a','text',s,'one',files),true)
 assert.ok(s.getItem(key).length < 512)
 const cold = await import('./chatSessionDrafts.js?cold')
 assert.deepEqual(await cold.loadChatSessionDraftAttachmentsAsync('a',s,'one'),files)
 assert.deepEqual(await load('a',s,'two'),[])
 assert.equal(loadChatSessionDraft('a',s,'one'),'text')
 await clear(['a'],s)
 assert.deepEqual(await load('a',s,'one'),[])
 await clear(['a'],s)
 assert.equal(s.getItem(key),null)
})
test('queued save then clear cannot resurrect draft', async () => {
 const s=storage()
 const pending=save('b','',s,'one',files)
 const deleting=clear(['b'],s)
 assert.equal(await pending,true)
 assert.equal(await deleting,true)
 assert.equal(s.getItem(key),null)
})
test('failed index commit preserves prior durable attachments', async () => {
 const s=storage()
 assert.equal(await save('c','old',s,'one',files),true)
 const before=s.getItem(key)
 const broken={...s,setItem(){throw new Error('quota')}}
 assert.equal(await save('c','new',broken,'one',[{...files[0],id:'new'}]),false)
 assert.equal(s.getItem(key),before)
 assert.deepEqual(await load('c',s,'one'),files)
 await clear(['c'],s)
})
test('legacy inline attachment migrates on next save', async () => {
 const s=storage(), small=[{dataURL:'data:image/png;base64,AAAA'}]
 saveChatSessionDraft('d','legacy',s,'one',small)
 assert.deepEqual(await load('d',s,'one'),small)
 assert.equal(await save('d','legacy',s,'one',small),true)
 assert.ok(!s.getItem(key).includes('data:image'))
 assert.deepEqual(await load('d',s,'one'),small)
 await clear(['d'],s)
})
