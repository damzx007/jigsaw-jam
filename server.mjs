import http from 'node:http';
import {randomBytes, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('./public/',import.meta.url));
const COLORS=['#edaf57','#6cb8df','#c991da','#7dc79a','#ef8e93','#a9a0ed','#d2ce78','#70c8c1'];
const TYPES=['fog','shield','shuffle','bomb'];
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function shuffled(n){const a=Array.from({length:n},(_,i)=>i);for(let i=n-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
export function advanceItems(r,now,random=Math.random){
 if(r.status!=='playing'||!r.items||r.mode==='coop'||now<r.nextItemAt)return false;
 const waves=Math.floor((now-r.nextItemAt)/(r.itemInterval*1000))+1;
 for(const p of r.players)for(let i=0,n=Math.min(waves,r.bagSize-p.bag.length);i<n;i++)p.bag.push({id:randomUUID(),type:TYPES[Math.min(TYPES.length-1,Math.floor(random()*TYPES.length))]});
 r.nextItemAt+=waves*r.itemInterval*1000;return true;
}
function boardFor(r,p){return r.mode==='coop'?r.shared:r.mode==='team'?r.teams[p.team]:p.placed;}
function player(s,name,team,index){return {id:randomUUID(),sid:s.id,name:typeof name==='string'?name.trim().slice(0,24)||'เพื่อนใหม่':'เพื่อนใหม่',color:COLORS[index%8],team,placed:[],bag:[],fog:0,shield:0,shuffleVersion:0,blast:null,ready:false,lastMove:0,presence:null};}
function newRound(r){
 r.revision=(r.revision||0)+1;r.round++;r.started=null;r.finished=null;r.winner=null;r.shared=[];r.teams={a:[],b:[]};r.hints=0;r.order=shuffled(r.cols*r.rows);r.layout=shuffled(r.cols*r.rows);r.status='lobby';r.nextItemAt=null;
 for(const p of r.players)Object.assign(p,{placed:[],bag:[],fog:0,shield:0,shuffleVersion:0,blast:null,ready:false,lastMove:0,presence:null});
}
function view(r,p,now){
 return {revision:r.revision,code:r.code,mode:r.mode,cols:r.cols,rows:r.rows,image:r.image.startsWith('data:')?'upload':r.image,items:r.items,bagSize:r.bagSize,itemInterval:r.itemInterval,nextItemAt:r.nextItemAt,bag:p.bag,preview:r.preview,layout:r.layout,order:r.order,round:r.round,status:r.status,started:r.started,finished:r.finished,winner:r.winner,host:r.host,you:p.id,team:p.team,placed:boardFor(r,p),fog:p.fog,shield:p.shield,shuffleVersion:p.shuffleVersion,blast:p.blast,hints:r.hints,serverNow:now,
 teams:[{id:'a',name:'ทีมดอกไม้',color:'#dc9c7e',count:r.teams.a.length},{id:'b',name:'ทีมใบไม้',color:'#7bb4a0',count:r.teams.b.length}],
 players:r.players.map(q=>({id:q.id,name:q.name,color:q.color,team:q.team,online:[...r.streams].some(s=>s.pid===q.id),count:q.placed.length,progress:boardFor(r,q).length,ready:q.ready}))};
}
async function body(req){let size=0,data='';for await(const chunk of req){size+=chunk.length;if(size>1500000)fail('รูปใหญ่เกินไป',413);data+=chunk;}try{return JSON.parse(data||'{}');}catch{fail('ข้อมูลไม่ถูกต้อง');}}
function validateImage(image){if(['coast','garden','space','mist','tiles','stripes'].includes(image))return image;if(typeof image==='string'&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)&&image.length<1400000)return image;fail('รูปไม่ถูกต้อง');}
export function createApp({clock=Date.now,random=Math.random}={}){
 const rooms=new Map(),sessions=new Map();
 function broadcast(r){r.revision++;r.updated=clock();for(const stream of r.streams){const p=r.players.find(p=>p.id===stream.pid);if(p)stream.res.write(`data: ${JSON.stringify(view(r,p,clock()))}\n\n`);}}
 function session(req,res){
  const id=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('jj='))?.slice(3);let s=sessions.get(id);
  if(!s){if(sessions.size>=20000)fail('เซิร์ฟเวอร์เต็ม ลองใหม่ภายหลัง',503);const id=randomBytes(24).toString('hex');s={id,rooms:new Set(),updated:clock(),hits:[]};sessions.set(id,s);res.setHeader('Set-Cookie',`jj=${id}; HttpOnly; SameSite=Lax; Path=/${process.env.NODE_ENV==='production'?'; Secure':''}`);}s.updated=clock();return s;
 }
 function membership(s,code){const r=rooms.get(String(code||'').toUpperCase());if(!r)fail('ไม่พบห้อง หรือห้องหมดอายุแล้ว',404);const p=r.players.find(p=>p.sid===s.id);if(!p)fail('กรุณาเข้าห้องก่อน',403);r.lastActivity=clock();if(advanceItems(r,clock(),random))broadcast(r);return {r,p};}
 function checkForfeit(r){if(r.status!=='playing')return;if(r.mode==='ffa'&&r.players.length===1){r.status='finished';r.finished=clock();r.winner=r.players[0].id;}if(r.mode==='team'&&new Set(r.players.map(p=>p.team)).size===1){r.status='finished';r.finished=clock();r.winner=r.players[0].team;}}
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost'),now=clock();
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  if(url.pathname==='/health'){res.writeHead(200,{'Content-Type':'text/plain'});res.end('ok');return;}
  if(url.pathname.startsWith('/api/')){
   res.setHeader('Cache-Control','no-store');const s=session(req,res);
   if(req.method==='POST'){
    if(req.headers.origin&&req.headers.origin!==`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host}`)fail('Origin ไม่ถูกต้อง',403);
    s.hits=s.hits.filter(t=>now-t<10000);if(s.hits.length>=120)fail('ช้าลงนิดนึงนะ',429);s.hits.push(now);
    const b=await body(req);let result={};
    if(url.pathname==='/api/create'){
     if(s.rooms.size>=12||rooms.size>=100)fail('สร้างห้องครบจำนวนแล้ว');let code;do{code=randomBytes(4).toString('hex').slice(0,6).toUpperCase();}while(rooms.has(code));
     const sizes={4:3,6:4,8:6,12:9,16:12,20:15},cols=Object.hasOwn(sizes,b.cols)?Number(b.cols):6;
     const mode=b.mode==='team'?'team':['ffa','pvp'].includes(b.mode)?'ffa':'coop';
     const bagSize=[3,4,5].includes(b.bagSize)?b.bagSize:4,itemInterval=Number.isInteger(b.itemInterval)&&b.itemInterval>=5&&b.itemInterval<=120?b.itemInterval:20;
     const p=player(s,b.name,'a',0),r={code,mode,cols,rows:sizes[cols],image:validateImage(b.image||'coast'),items:mode!=='coop'&&b.items!==false,bagSize,itemInterval,preview:b.preview==='start'?'start':'always',players:[p],host:p.id,streams:new Set(),round:0,updated:now,lastActivity:now};newRound(r);rooms.set(code,r);s.rooms.add(code);result=view(r,p,now);
    }else if(url.pathname==='/api/join'){
     const r=rooms.get(String(b.code||'').toUpperCase());if(!r)fail('ไม่พบห้อง ตรวจรหัสอีกครั้ง',404);let p=r.players.find(x=>x.sid===s.id);
     if(!p){if(r.status!=='lobby')fail('เกมเริ่มแล้ว รอรอบถัดไป');if(r.players.length>=8)fail('ห้องเต็มแล้ว');const a=r.players.filter(p=>p.team==='a').length,bCount=r.players.length-a;const index=COLORS.findIndex(color=>!r.players.some(p=>p.color===color));p=player(s,b.name,a<=bCount?'a':'b',index<0?0:index);r.players.push(p);s.rooms.add(r.code);}
     r.lastActivity=now;broadcast(r);result=view(r,p,now);
    }else if(url.pathname==='/api/presence'){
     const {r,p}=membership(s,b.code);if(now-(p.lastPresence||0)>=140){p.lastPresence=now;p.presence={id:p.id,piece:Number.isInteger(b.piece)&&b.piece>=0&&b.piece<r.cols*r.rows?b.piece:null,at:now};for(const stream of r.streams)if(stream.pid!==p.id)stream.res.write(`event: presence\ndata: ${JSON.stringify(p.presence)}\n\n`);}result={ok:true};
    }else if(url.pathname==='/api/leave'){
     const {r,p}=membership(s,b.code);for(const stream of [...r.streams])if(stream.pid===p.id){r.streams.delete(stream);stream.res.end();}r.players=r.players.filter(q=>q.id!==p.id);s.rooms.delete(r.code);
     if(!r.players.length)rooms.delete(r.code);else{if(r.host===p.id)r.host=r.players[0].id;checkForfeit(r);broadcast(r);}result={left:true};
    }else if(url.pathname==='/api/action'){
     const {r,p}=membership(s,b.code);
     if(b.type==='team'){
      if(r.status!=='lobby'||r.mode!=='team')fail('เปลี่ยนทีมได้ก่อนเริ่มโหมดทีมเท่านั้น');if(!['a','b'].includes(b.team))fail('ทีมไม่ถูกต้อง');if(p.team!==b.team){p.team=b.team;for(const q of r.players)q.ready=false;}
     }else if(b.type==='ready'){if(r.status!=='lobby')fail('เริ่มเกมแล้ว');p.ready=!p.ready;}
     else if(b.type==='start'){
      if(p.id!==r.host)fail('เฉพาะเจ้าของห้อง',403);if(r.status!=='lobby')fail('เริ่มเกมแล้ว');
      if(r.mode!=='coop'&&(r.players.length<2||!r.players.every(p=>p.ready)))fail('ต้องมีอย่างน้อย 2 คน และทุกคนกดพร้อม');
      if(r.mode==='team'&&new Set(r.players.map(p=>p.team)).size!==2)fail('ต้องมีผู้เล่นทั้ง 2 ทีม');r.status='playing';r.started=now+3000;r.nextItemAt=r.items?r.started+r.itemInterval*1000:null;
     }else if(b.type==='rematch'){if(p.id!==r.host)fail('เฉพาะเจ้าของห้อง',403);if(r.status!=='finished')fail('ยังไม่จบรอบ');newRound(r);}
     else if(b.type==='place'){
      if(r.status!=='playing'||now<r.started)fail('รอเริ่มเกม หรือเกมจบแล้ว');if(!Number.isInteger(b.piece)||b.piece<0||b.piece>=r.cols*r.rows||b.cell!==r.layout[b.piece])fail('ยังไม่ใช่ตำแหน่งนี้');
      const placed=boardFor(r,p);if(placed.includes(b.piece))fail('ชิ้นนี้ต่อแล้ว');if(now-p.lastMove<80)fail('ช้าลงนิดนึง');p.lastMove=now;placed.push(b.piece);if(r.mode==='coop'||r.mode==='team')p.placed.push(b.piece);if(r.mode==='coop')r.hints=Math.min(3,r.hints+(r.shared.length%5===0?1:0));
      if(placed.length===r.cols*r.rows){r.status='finished';r.finished=now;r.winner=r.mode==='coop'?'all':r.mode==='team'?p.team:p.id;}
     }else if(b.type==='hint'){
      if(r.status!=='playing'||now<r.started||r.mode!=='coop'||r.hints<1)fail('สะสมทีมให้ครบ 5 ชิ้นเพื่อรับคำใบ้');if(!Number.isInteger(b.piece)||b.piece<0||b.piece>=r.cols*r.rows||r.shared.includes(b.piece))fail('เลือกชิ้นที่ยังไม่ต่อ');if(r.preview==='start')fail('ห้องนี้ปิดคำใบ้ภาพ');r.hints--;result={hint:r.layout[b.piece]};
     }else if(b.type==='use-item'){
      if(r.status!=='playing'||now<r.started||!r.items)fail('ใช้ไอเทมไม่ได้');const index=p.bag.findIndex(item=>item.id===b.itemId);if(index<0)fail('ไม่มีไอเทมชิ้นนี้');const item=p.bag[index];let targets;
      if(item.type==='shield')targets=r.mode==='team'?r.players.filter(q=>q.team===p.team):[p];
      else if(r.mode==='team'){if(!['a','b'].includes(b.target)||b.target===p.team)fail('เลือกทีมฝ่ายตรงข้าม');targets=r.players.filter(q=>q.team===b.target);}
      else{const target=r.players.find(q=>q.id===b.target&&q.id!==p.id);if(!target)fail('เลือกคู่แข่งก่อน');targets=[target];}
      if(!targets.length)fail('ไม่มีเป้าหมายแล้ว');p.bag.splice(index,1);
      if(item.type==='bomb'){
       // A team shares one board: remove once, then notify each recipient independently.
       const exposed=targets.filter(q=>q.shield<=now),victim=exposed[0],id=randomUUID();
       if(victim){
        const board=boardFor(r,victim),anchor=board.length?board[Math.min(board.length-1,Math.floor(random()*board.length))]:null;
        const center=anchor===null?Math.floor(r.cols*r.rows/2):r.layout[anchor],cx=center%r.cols,cy=Math.floor(center/r.cols);
        const distance=piece=>{const cell=r.layout[piece];return (cell%r.cols-cx)**2+(Math.floor(cell/r.cols)-cy)**2;};
        const removed=[...board].sort((a,b)=>distance(a)-distance(b)||a-b).slice(0,Math.min(24,Math.ceil(board.length*.25)));
        const lost=new Set(removed);board.splice(0,board.length,...board.filter(piece=>!lost.has(piece)));
        if(r.mode==='team')for(const q of targets)q.placed=q.placed.filter(piece=>!lost.has(piece));
        for(const q of exposed)q.blast={id,at:now,center,removed,blocked:false};
       }
       for(const q of targets.filter(q=>q.shield>now))q.blast={id,at:now,center:Math.floor(r.cols*r.rows/2),removed:[],blocked:true};
      }
      for(const target of targets){if(item.type==='shield'){target.shield=now+12000;target.fog=0;}else if(target.shield<=now){if(item.type==='fog')target.fog=now+6000;else if(item.type==='shuffle')target.shuffleVersion++;}}
     }else fail('ไม่รู้จักคำสั่ง');broadcast(r);result={...result,state:view(r,p,clock())};
    }else fail('ไม่พบ API',404);
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return;
   }
   if(req.method==='GET'&&url.pathname==='/api/image'){const {r}=membership(s,url.searchParams.get('room'));if(!r.image.startsWith('data:'))fail('ไม่มีรูปอัปโหลด',404);const match=r.image.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);res.writeHead(200,{'Content-Type':match[1]});res.end(Buffer.from(match[2],'base64'));return;}
   if(req.method==='GET'&&url.pathname==='/api/state'){const {r,p}=membership(s,url.searchParams.get('room'));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(view(r,p,clock())));return;}
   if(req.method==='GET'&&url.pathname==='/api/events'){
    const {r,p}=membership(s,url.searchParams.get('room'));for(const old of [...r.streams])if(old.pid===p.id){old.res.end();r.streams.delete(old);}
    res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': connected\n\n');const stream={pid:p.id,res};r.streams.add(stream);broadcast(r);for(const q of r.players)if(q.id!==p.id&&q.presence&&clock()-q.presence.at<4500)res.write(`event: presence\ndata: ${JSON.stringify(q.presence)}\n\n`);
    const heartbeat=setInterval(()=>res.write(': ping\n\n'),15000);req.on('close',()=>{clearInterval(heartbeat);r.streams.delete(stream);r.lastActivity=clock();if(rooms.has(r.code))broadcast(r);});return;
   }fail('ไม่พบ API',404);
  }
  if(req.method!=='GET'&&req.method!=='HEAD')fail('Method not allowed',405);
  const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};for(const id of ['coast','garden','space','mist','tiles','stripes'])files['/art/'+id+'.svg']='art/'+id+'.svg';const file=files[url.pathname];if(!file)fail('Not found',404);
  const data=await readFile(root+file);res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'image/svg+xml','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
 }catch(e){if(res.headersSent){res.end();return;}res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.status?e.message:'เซิร์ฟเวอร์ขัดข้อง กรุณาลองใหม่'}));}});
 const scheduler=setInterval(()=>{const now=clock();for(const [code,r] of rooms){if(advanceItems(r,now,random))broadcast(r);if(!r.streams.size&&now-r.lastActivity>6*3600000){rooms.delete(code);for(const s of sessions.values())s.rooms.delete(code);}}for(const [id,s] of sessions)if(!s.rooms.size&&now-s.updated>24*3600000)sessions.delete(id);},500);scheduler.unref();
 server.on('close',()=>clearInterval(scheduler));server.on('close-streams',()=>{for(const r of rooms.values())for(const stream of r.streams)stream.res.end();});return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const server=createApp();server.listen(Number(process.env.PORT)||Number(process.argv[process.argv.indexOf('--port')+1])||3000,'0.0.0.0',()=>console.log('Jigsaw Jam is listening'));process.on('SIGTERM',()=>{server.emit('close-streams');server.close(()=>process.exit(0));});}
