import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
async function setup(t){
 let now=1800000000000,roll=0;const server=createApp({clock:()=>now,random:()=>roll});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 t.after(()=>{server.emit('close-streams');server.closeAllConnections();server.close();});
 function client(){let cookie='';return {async req(path,data){const res=await fetch(base+'/api/'+path,{method:data?'POST':'GET',headers:{...(cookie?{cookie}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];return {status:res.status,body:await res.json()};},get cookie(){return cookie;}};}
 return {base,client,tick(ms){now+=ms;},roll(value){roll=value;}};
}
async function room(t,mode='ffa',extra={},count=2){const w=await setup(t),people=Array.from({length:count},()=>w.client()),{body:r}=await people[0].req('create',{mode,cols:4,image:'coast',...extra});for(let i=1;i<count;i++)assert.equal((await people[i].req('join',{code:r.code,name:'P'+i})).status,200);const action=(i,type,extra={})=>people[i].req('action',{code:r.code,type,...extra}),state=i=>people[i].req('state?room='+r.code);return {...w,people,r,action,state,async start(){if(mode!=='coop')for(let i=0;i<count;i++)await action(i,'ready');assert.equal((await action(0,'start')).status,200);w.tick(3001);},async place(i,id){w.tick(100);return action(i,'place',{piece:id,cell:r.layout[id]});},async wave(){w.tick(r.itemInterval*1000);return (await state(0)).body;}};}
test('Co-op supports 8 players, shared contributions, duplicate protection, hints and rematch',async t=>{
 const w=await room(t,'coop',{},8),outsider=w.client();assert.equal((await outsider.req('state?room='+w.r.code)).status,403);assert.equal((await outsider.req('join',{code:w.r.code})).status,400);assert.equal(w.r.items,false);assert.equal((await w.action(1,'start')).status,403);await w.start();
 assert.equal((await w.place(0,0)).status,200);assert.equal((await w.place(1,0)).status,400);assert.deepEqual((await w.state(7)).body.placed,[0]);for(let i=1;i<5;i++)await w.place(i%8,i);assert.equal((await w.action(2,'hint',{piece:7})).body.hint,w.r.layout[7]);for(let i=5;i<12;i++)await w.place(i%8,i);
 assert.equal((await w.state(0)).body.winner,'all');assert.equal((await w.action(0,'rematch')).body.state.placed.length,0);
});
test('FFA supports 8 independent boards, readiness, winner locking and no premature forfeit',async t=>{
 const w=await room(t,'ffa',{},8);assert.equal((await w.action(0,'start')).status,400);await w.start();await w.place(0,0);assert.deepEqual((await w.state(1)).body.placed,[]);await w.people[7].req('leave',{code:w.r.code});assert.equal((await w.state(0)).body.status,'playing');for(let i=1;i<12;i++)await w.place(0,i);assert.equal((await w.state(1)).body.winner,w.r.you);assert.equal((await w.place(1,0)).status,400);
});
test('Team has allied shared boards, enemy isolation and a team win',async t=>{
 const w=await room(t,'team',{},4);assert.deepEqual((await w.state(0)).body.players.map(p=>p.team),['a','b','a','b']);await w.start();await w.place(0,0);assert.deepEqual((await w.state(2)).body.placed,[0]);assert.deepEqual((await w.state(1)).body.placed,[]);assert.equal((await w.place(2,0)).status,400);assert.equal((await w.action(0,'team',{team:'b'})).status,400);
 for(let i=1;i<12;i++)await w.place(i%2===0?0:2,i);const final=(await w.state(3)).body;assert.equal(final.status,'finished');assert.equal(final.winner,'a');assert.equal(final.teams[0].count,12);
});
test('Team changing invalidates readiness and start requires both teams',async t=>{
 const w=await room(t,'team');await w.action(0,'ready');await w.action(1,'ready');await w.action(1,'team',{team:'a'});assert.ok((await w.state(0)).body.players.every(p=>!p.ready));await w.action(0,'ready');await w.action(1,'ready');assert.equal((await w.action(0,'start')).status,400);await w.action(1,'team',{team:'b'});await w.start();
});
test('Default timed bag: 20 seconds, 4 slots, no placement energy, full bag skips rolls',async t=>{
 const w=await room(t,'ffa');assert.equal(w.r.itemInterval,20);assert.equal(w.r.bagSize,4);await w.start();await w.place(0,0);assert.equal((await w.state(0)).body.bag.length,0);w.tick(19800);assert.equal((await w.state(0)).body.bag.length,0);w.tick(200);let state=(await w.state(0)).body;assert.equal(state.bag.length,1);assert.equal((await w.state(1)).body.bag.length,1);
 w.tick(200000);state=(await w.state(0)).body;assert.equal(state.bag.length,4);const ids=state.bag.map(x=>x.id);w.tick(20000);assert.deepEqual((await w.state(0)).body.bag.map(x=>x.id),ids);assert.equal(new Set(ids).size,4);
 const other=(await w.state(1)).body;assert.equal((await w.action(0,'use-item',{itemId:other.bag[0].id,target:other.you})).status,400);assert.equal((await w.action(0,'use-item',{itemId:ids[0],target:w.r.you})).status,400);assert.equal((await w.state(0)).body.bag.length,4);
 assert.equal((await w.action(0,'use-item',{itemId:ids[0],target:other.you})).status,200);assert.equal((await w.state(0)).body.bag.length,3);assert.equal((await w.action(0,'use-item',{itemId:ids[0],target:other.you})).status,400);w.tick(20000);assert.equal((await w.state(0)).body.bag.length,4);
});
test('Configurable 3–5 slot bags and interval validation',async t=>{
 for(const size of [3,5]){const w=await room(t,'ffa',{bagSize:size,itemInterval:5});await w.start();w.tick(60000);assert.equal((await w.state(0)).body.bag.length,size);assert.equal(w.r.itemInterval,5);}
 const w=await room(t,'ffa',{bagSize:99,itemInterval:0});assert.equal(w.r.bagSize,4);assert.equal(w.r.itemInterval,20);
});
test('Fog and shield apply to entire teams; allies cannot attack each other',async t=>{
 const w=await room(t,'team',{itemInterval:5,bagSize:5},4);await w.start();w.roll(.4);await w.wave();await w.wave();w.roll(0);await w.wave();const a=(await w.state(0)).body,b=(await w.state(1)).body;
 assert.equal((await w.action(0,'use-item',{itemId:a.bag[2].id,target:'a'})).status,400);await w.action(0,'use-item',{itemId:a.bag[0].id});assert.ok((await w.state(2)).body.shield>0);await w.action(1,'use-item',{itemId:b.bag[2].id,target:'a'});assert.equal((await w.state(2)).body.fog,0);
 w.tick(13000);const next=(await w.state(1)).body;await w.action(1,'use-item',{itemId:next.bag.find(x=>x.type==='fog').id,target:'a'});assert.ok((await w.state(0)).body.fog>0);await w.action(0,'use-item',{itemId:a.bag[1].id});assert.equal((await w.state(2)).body.fog,0);
});
test('Shuffle item only marks enemy tray and preserves all completed pieces',async t=>{
 const w=await room(t,'ffa',{itemInterval:5});await w.start();await w.place(1,0);w.roll(.9);const a=await w.wave(),b=(await w.state(1)).body;await w.action(0,'use-item',{itemId:a.bag[0].id,target:b.you});const after=(await w.state(1)).body;assert.equal(after.shuffleVersion,1);assert.deepEqual(after.placed,[0]);assert.equal((await w.state(0)).body.shuffleVersion,0);
});
test('Nightmare 300 pieces, countdown prevents early moves, start-only preview disallows hint',async t=>{
 const w=await room(t,'coop',{cols:20,image:'tiles',preview:'start'},1);assert.equal(w.r.cols*w.r.rows,300);assert.equal(new Set(w.r.layout).size,300);const result=await w.action(0,'start');assert.ok(result.body.state.started>result.body.state.serverNow);assert.equal((await w.place(0,0)).status,400);w.tick(3100);for(let i=0;i<5;i++)await w.place(0,i);assert.equal((await w.action(0,'hint',{piece:7})).status,400);
});
test('SSE presence contains only player and held piece, with no cursor coordinates or floating message',async t=>{
 const w=await room(t,'coop'),ctrl=new AbortController();const res=await fetch(w.base+'/api/events?room='+w.r.code,{headers:{cookie:w.people[1].cookie},signal:ctrl.signal}),reader=res.body.getReader();await reader.read();await w.people[0].req('presence',{code:w.r.code,x:.5,y:.4,piece:0,zone:'board'});const data=new TextDecoder().decode((await reader.read()).value);assert.match(data,/event: presence/);assert.match(data,/"piece":0/);assert.ok(!data.includes('"x"')&&!data.includes('"name"'));ctrl.abort();
});
test('Scheduled bag updates are pushed over SSE without a polling client',async t=>{
 const w=await room(t,'ffa',{itemInterval:5});await w.start();const ctrl=new AbortController(),res=await fetch(w.base+'/api/events?room='+w.r.code,{headers:{cookie:w.people[0].cookie},signal:ctrl.signal}),reader=res.body.getReader();await reader.read();w.tick(5000);const data=new TextDecoder().decode((await reader.read()).value);assert.match(data,/"bag":\[\{"id"/);ctrl.abort();
});
test('Leaving transfers ownership and only forfeits if one contestant or one team remains',async t=>{
 const w=await room(t,'ffa',{},3);await w.start();await w.people[0].req('leave',{code:w.r.code});let s=(await w.state(1)).body;assert.equal(s.status,'playing');assert.equal(s.host,s.you);await w.people[2].req('leave',{code:w.r.code});assert.equal((await w.state(1)).body.winner,s.you);
 const team=await room(t,'team');await team.start();await team.people[0].req('leave',{code:team.r.code});assert.equal((await team.state(1)).body.winner,'b');
});
test('Uploaded images stay behind membership and are not rebroadcast in game state',async t=>{
 const w=await room(t,'coop',{image:'data:image/png;base64,iVBORw0KGgo='},1);assert.equal(w.r.image,'upload');assert.ok(!JSON.stringify(w.r).includes('base64'));assert.equal((await fetch(w.base+'/api/image?room='+w.r.code)).status,403);const response=await fetch(w.base+'/api/image?room='+w.r.code,{headers:{cookie:w.people[0].cookie}});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/image\/png/);
 const bad=await fetch(w.base+'/api/create',{method:'POST',headers:{origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});assert.equal(bad.status,403);
});
test('Items stop at match end; disabled bags never roll; automatic rolls cannot keep abandoned rooms forever',async t=>{
 const stopped=await room(t,'ffa');await stopped.start();for(let id=0;id<12;id++)await stopped.place(0,id);stopped.tick(200000);assert.equal((await stopped.state(0)).body.bag.length,0);
 const off=await room(t,'ffa',{items:false});await off.start();off.tick(100000);assert.equal((await off.state(0)).body.bag.length,0);
 const idle=await room(t,'ffa');await idle.start();idle.tick(6*3600000+1);await new Promise(resolve=>setTimeout(resolve,650));assert.equal((await idle.state(0)).status,404);
});
