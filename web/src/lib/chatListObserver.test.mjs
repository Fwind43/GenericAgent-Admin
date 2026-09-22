// Isolated structural regression using the actual list body; mocked rows/slots
// and IO do not measure browser layout or full ChatApp streaming behavior.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const esbuild=require('esbuild');
const src=fs.readFileSync(new URL('../ChatApp.jsx', import.meta.url),'utf8');
const body=src.slice(src.indexOf('function MessageListContent('),src.indexOf('export const MessageList ='));
const pre=`const React=require('react');const {useMemo,useState,useRef,useCallback,useEffect}=React;
const MESSAGE_RENDER_TAIL=2,MESSAGE_RENDER_LIMIT=12;
const messageRenderKey=m=>m.id,fmtDate=()=>'',estimatedMessageHeight=()=>100;
const ChatMessage=React.memo(function Row(){globalThis.__rows++;return null});
const VirtualMessageSlot=({children,messageKey,active})=><div className="oa-message-slot" data-message-key={messageKey} data-active={String(active)}>{children}</div>;
`;
const out=esbuild.transformSync(pre+body+'\nmodule.exports=MessageListContent;', {loader:'jsx',format:'cjs'}).code;

const Module=require('node:module');const mod=new Module('list-extracted.cjs');mod.paths=require.resolve.paths('react');mod._compile(out,'list-extracted.cjs');
const React=require('react');const {JSDOM}=require('jsdom');const dom=new JSDOM('<div id="root"></div>');
globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
// Node 20 has no navigator; newer Node versions expose a getter-only global.
Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
let created=0,observes=0,disconnected=0;
let latest; globalThis.IntersectionObserver=class{constructor(cb){created++;this.cb=cb;this.nodes=[];latest=this}observe(n){observes++;this.nodes.push(n)}disconnect(){disconnected++;this.nodes=[]}};
let raf;globalThis.requestAnimationFrame=f=>(raf=f,1);globalThis.cancelAnimationFrame=()=>{raf=null};globalThis.__rows=0;
const {createRoot}=require('react-dom/client');const root=createRoot(document.getElementById('root'));const {act}=React;
const stable=()=>{};

let messages=Array.from({length:20},(_,i)=>({id:'m'+i,role:'assistant',content:'fake'}));
const props={sessionKey:'a',isCurrentRunning:true,clockNow:0,onAskReply:stable,onEditResend:stable,onRetryBTW:stable};
const render=async(p={})=>act(async()=>root.render(React.createElement(mod.exports,{...props,messages,...p})));
await render();assert.equal(latest.nodes.length,20);
const initial=created;
messages=messages.map((m,i)=>i===19?{...m,content:'changed'}:m);await render();assert.equal(created,initial);
const first=document.querySelector('[data-message-key="m0"]');assert.equal(first.dataset.active,'false');
await act(async()=>{latest.cb([{target:first,isIntersecting:true}]);const f=raf;raf=null;f()});assert.equal(first.dataset.active,'true');
messages=[...messages,{id:'new',role:'assistant',content:'new'}];await render();assert.equal(latest.nodes.length,21);assert.equal(created,initial+1);
messages=messages.filter(m=>m.id!=='m0');await render();assert.equal(latest.nodes.length,20);assert.ok(!document.querySelector('[data-message-key="m0"]'));
await act(async()=>latest.cb([{target:latest.nodes[0],isIntersecting:true}]));assert.ok(raf);
await render({sessionKey:'b',messages:[{id:'other',role:'assistant',content:'other'}]});assert.equal(raf,null);assert.equal(latest.nodes.length,1);assert.equal(latest.nodes[0].dataset.messageKey,'other');
await act(async()=>root.unmount());assert.equal(latest.nodes.length,0);assert.equal(created,disconnected);console.log('PASS unchanged / add / remove / visible activation / session switch / queued frame cancellation / unmount');

dom.window.close();
