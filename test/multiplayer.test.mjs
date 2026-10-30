import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as wait} from 'node:timers/promises';
import {createApp} from '../server.mjs';
async function setup(t){
 const server=createApp();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 const base='http://127.0.0.1:'+server.address().port;
 function client(){let cookie='';return async(path,data)=>{const res=await fetch(base+'/api/'+path,{method:data?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];return {status:res.status,body:await res.json()};};}
 const a=client(),b=client(),c=client();return {a,b,c,base};
}
async function start(a,b,r){const code=r.code;if(r.mode==='pvp'){await a('action',{code,type:'ready'});await b('action',{code,type:'ready'});}const result=await a('action',{code,type:'start'});assert.equal(result.status,200);await wait(Math.max(0,result.body.state.started-Date.now()+20));}
async function place(a,r,id){await wait(85);return a('action',{code:r.code,type:'place',piece:id,cell:r.layout[id]});}
test('Co-op: authorization, shared randomized pieces, duplicate prevention, hints, completion and rematch',async t=>{
 const {a,b,c}=await setup(t);const {body:r}=await a('create',{mode:'coop',cols:4,image:'coast'});const code=r.code;
 assert.equal((await c('state?room='+code)).status,403);await b('join',{code,name:'B'});assert.equal((await b('action',{code,type:'start'})).status,403);
 await start(a,b,r);assert.equal((await a('action',{code,type:'place',piece:0,cell:(r.layout[0]+1)%12})).status,400);
 const both=await Promise.all([place(a,r,0),place(b,r,0)]);assert.equal(both.filter(x=>x.status===200).length,1);
 assert.deepEqual((await b('state?room='+code)).body.placed,[0]);
 for(let id=1;id<5;id++)assert.equal((await place(a,r,id)).status,200);
 assert.equal((await b('action',{code,type:'hint',piece:7})).body.hint,r.layout[7]);
 for(let id=5;id<12;id++)await place(a,r,id);
 const final=(await b('state?room='+code)).body;assert.equal(final.status,'finished');assert.equal(final.winner,'team');
 const again=(await a('action',{code,type:'rematch'})).body.state;assert.equal(again.placed.length,0);assert.equal(again.round,2);assert.deepEqual([...again.layout].sort((a,b)=>a-b),Array.from({length:12},(_,i)=>i));
});
test('PvP: readiness, isolated boards, fog, shield, winner and capacity',async t=>{
 const {a,b,c}=await setup(t);const {body:r}=await a('create',{mode:'pvp',cols:4,image:'space'});const code=r.code;await b('join',{code});assert.equal((await c('join',{code})).status,400);assert.equal((await a('action',{code,type:'start'})).status,400);
 await start(a,b,r);for(let id=0;id<3;id++)await place(a,r,id);
 assert.deepEqual((await b('state?room='+code)).body.placed,[]);assert.equal((await a('action',{code,type:'fog'})).status,200);assert.ok((await b('state?room='+code)).body.fog>Date.now());
 for(let id=0;id<2;id++)await place(b,r,id);assert.equal((await b('action',{code,type:'shield'})).status,200);assert.equal((await b('state?room='+code)).body.fog,0);
 for(let id=3;id<12;id++)await place(a,r,id);assert.equal((await a('state?room='+code)).body.winner,r.you);assert.equal((await place(b,r,2)).status,400);
});
test('300-piece nightmare and server-enforced countdown with preview/hint rules',async t=>{
 const {a}=await setup(t);const {body:r}=await a('create',{cols:20,image:'tiles',preview:'start'});assert.equal(r.cols*r.rows,300);assert.equal(r.preview,'start');assert.equal(new Set(r.layout).size,300);
 const result=await a('action',{code:r.code,type:'start'});assert.ok(result.body.state.started>Date.now()+2500);
 assert.equal((await a('action',{code:r.code,type:'place',piece:0,cell:r.layout[0]})).status,400);
 await wait(3050);for(let id=0;id<5;id++)await place(a,r,id);
 assert.equal((await a('action',{code:r.code,type:'hint',piece:7})).status,400);
});
test('SSE presence is a small separate event and sanitizes coordinates and names',async t=>{
 const {a,base}=await setup(t);const {body:r}=await a('create',{cols:4,image:'garden'});
 const join=await fetch(base+'/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:r.code,name:'B'})});const cookie=join.headers.get('set-cookie').split(';')[0];
 const ctrl=new AbortController();const res=await fetch(base+'/api/events?room='+r.code,{headers:{cookie},signal:ctrl.signal});const reader=res.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/"mode":"coop"/);
 await a('presence',{code:r.code,x:999,y:-99,piece:0,zone:'board'});const event=new TextDecoder().decode((await reader.read()).value);assert.match(event,/event: presence/);assert.match(event,/"x":1,"y":0/);assert.ok(event.length<500);assert.ok(!event.includes('"layout"'));ctrl.abort();
});
test('Custom image transmitted once through authenticated endpoint, not in state broadcasts',async t=>{
 const {a,b,base}=await setup(t);const image='data:image/png;base64,iVBORw0KGgo=';const {body:r}=await a('create',{image});assert.equal(r.image,'upload');assert.ok(!JSON.stringify(r).includes('base64'));assert.equal((await b('state?room='+r.code)).status,403);
 const res=await fetch(base+'/api/image?room='+r.code);assert.equal(res.status,403);
 assert.equal((await a('create',{image:'https://evil.example/image'})).status,400);
 const bad=await fetch(base+'/api/create',{method:'POST',headers:{origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});assert.equal(bad.status,403);
});
test('Leaving transfers host and resolves PvP forfeit',async t=>{
 const {a,b,c}=await setup(t);const {body:r}=await a('create',{mode:'pvp',cols:4,image:'mist'});const {body:p}=await b('join',{code:r.code});await start(a,b,r);await a('leave',{code:r.code});const after=(await b('state?room='+r.code)).body;assert.equal(after.winner,p.you);assert.equal(after.host,p.you);await b('action',{code:r.code,type:'rematch'});assert.equal((await c('join',{code:r.code})).status,200);
});
