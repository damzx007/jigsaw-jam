import http from 'node:http';
import {randomBytes, randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const rooms=new Map(), sessions=new Map();
const root=fileURLToPath(new URL('./public/',import.meta.url));
const MAX_BODY=1500000;
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function session(req,res){
 const cookie=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('jj='))?.slice(3);
 let s=sessions.get(cookie);
 if(!s){if(sessions.size>=20000)fail('เซิร์ฟเวอร์เต็ม ลองใหม่ภายหลัง',503);const id=randomBytes(24).toString('hex');s={id,rooms:new Set(),updated:Date.now(),hits:[]};sessions.set(id,s);res.setHeader('Set-Cookie',`jj=${id}; HttpOnly; SameSite=Lax; Path=/${process.env.NODE_ENV==='production'?'; Secure':''}`);}
 s.updated=Date.now();return s;
}
function shuffled(n){const a=Array.from({length:n},(_,i)=>i);for(let i=n-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function newRound(r){r.revision=(r.revision||0)+1;r.round++;r.started=null;r.finished=null;r.winner=null;r.shared=[];r.hints=0;r.order=shuffled(r.cols*r.rows);r.layout=shuffled(r.cols*r.rows);for(const p of r.players){p.placed=[];p.charge=0;p.fog=0;p.shield=0;p.ready=false;p.lastMove=0;p.presence=null;}r.status='lobby';}
function view(r,p){const now=Date.now();return {revision:r.revision,code:r.code,mode:r.mode,cols:r.cols,rows:r.rows,image:r.image.startsWith('data:')?'upload':r.image,items:r.items,preview:r.preview,layout:r.layout,order:r.order,round:r.round,status:r.status,started:r.started,finished:r.finished,winner:r.winner,host:r.host,you:p.id,placed:r.mode==='coop'?r.shared:p.placed,charge:p.charge,fog:p.fog,shield:p.shield,hints:r.hints,serverNow:now,players:r.players.map(q=>({id:q.id,name:q.name,online:[...r.streams].some(s=>s.pid===q.id),count:r.mode==='coop'?q.placed.length:q.placed.length,ready:q.ready}))};}
function broadcast(r){r.revision++;r.updated=Date.now();for(const s of r.streams){const p=r.players.find(p=>p.id===s.pid);if(p)s.res.write(`data: ${JSON.stringify(view(r,p))}\n\n`);}}
function membership(s,code){const r=rooms.get(String(code||'').toUpperCase());if(!r)fail('ไม่พบห้อง หรือห้องหมดอายุแล้ว',404);const p=r.players.find(x=>x.sid===s.id);if(!p)fail('กรุณาเข้าห้องก่อน',403);return {r,p};}
async function body(req){let size=0,data='';for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)fail('รูปใหญ่เกินไป',413);data+=chunk;}try{return JSON.parse(data||'{}');}catch{fail('ข้อมูลไม่ถูกต้อง');}}
function validateImage(image){if(['coast','garden','space','mist','tiles','stripes'].includes(image))return image;if(typeof image==='string'&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)&&image.length<1400000)return image;fail('รูปไม่ถูกต้อง');}
function nameOf(v){return typeof v==='string'?v.trim().slice(0,24)||'เพื่อนใหม่':'เพื่อนใหม่';}
export function createApp(){return http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
 if(url.pathname==='/health'){res.writeHead(200,{'Content-Type':'text/plain'});res.end('ok');return;}
 if(url.pathname.startsWith('/api/')){
 res.setHeader('Cache-Control','no-store');const s=session(req,res);
 if(req.method==='POST'){
 if(req.headers.origin&&req.headers.origin!==`${req.headers['x-forwarded-proto']||'http'}://${req.headers.host}`)fail('Origin ไม่ถูกต้อง',403);
 const now=Date.now();s.hits=s.hits.filter(t=>now-t<10000);if(s.hits.length>=120)fail('ช้าลงนิดนึงนะ',429);s.hits.push(now);
 const b=await body(req);let result={};
 if(url.pathname==='/api/create'){
 if(s.rooms.size>=12||rooms.size>=100)fail('สร้างห้องครบจำนวนแล้ว');
 let code;do{code=randomBytes(4).toString('hex').slice(0,6).toUpperCase();}while(rooms.has(code));
 const sizes={4:3,6:4,8:6,12:9,16:12,20:15};const cols=Object.hasOwn(sizes,b.cols)?Number(b.cols):6,rows=sizes[cols];
 const p={id:randomUUID(),sid:s.id,name:nameOf(b.name)};
 const r={code,mode:b.mode==='pvp'?'pvp':'coop',cols,rows,image:validateImage(b.image||'coast'),items:b.items!==false,preview:b.preview==='start'?'start':'always',players:[p],host:p.id,streams:new Set(),round:0,updated:now};newRound(r);rooms.set(code,r);s.rooms.add(code);result=view(r,p);
 }else if(url.pathname==='/api/join'){
 const r=rooms.get(String(b.code||'').toUpperCase());if(!r)fail('ไม่พบห้อง ตรวจรหัสอีกครั้ง',404);
 let p=r.players.find(x=>x.sid===s.id);
 if(!p){if(r.status!=='lobby')fail('เกมเริ่มแล้ว รอรอบถัดไป');if(r.players.length>=(r.mode==='pvp'?2:4))fail('ห้องเต็มแล้ว');p={id:randomUUID(),sid:s.id,name:nameOf(b.name),placed:[],charge:0,fog:0,shield:0,ready:false,lastMove:0};r.players.push(p);s.rooms.add(r.code);}
 result=view(r,p);broadcast(r);
 }else if(url.pathname==='/api/presence'){
 const {r,p}=membership(s,b.code);
 if(now-(p.lastPresence||0)<140){result={ok:true};}
 else {p.lastPresence=now;const piece=Number.isInteger(b.piece)&&b.piece>=0&&b.piece<r.cols*r.rows?b.piece:null;
 p.presence={id:p.id,name:p.name,x:Number.isFinite(b.x)?Math.max(0,Math.min(1,b.x)):0,y:Number.isFinite(b.y)?Math.max(0,Math.min(1,b.y)):0,zone:b.zone==='board'?'board':'tray',piece,at:now};
 for(const stream of r.streams)if(stream.pid!==p.id)stream.res.write(`event: presence\ndata: ${JSON.stringify(p.presence)}\n\n`);result={ok:true};}
 }else if(url.pathname==='/api/leave'){
 const {r,p}=membership(s,b.code);
 for(const stream of [...r.streams])if(stream.pid===p.id){r.streams.delete(stream);stream.res.end();}
 r.players=r.players.filter(q=>q.id!==p.id);s.rooms.delete(r.code);
 if(!r.players.length)rooms.delete(r.code);
 else {if(r.host===p.id)r.host=r.players[0].id;if(r.mode==='pvp'&&r.status==='playing'){r.status='finished';r.finished=now;r.winner=r.players[0].id;}broadcast(r);}result={left:true};
 }else if(url.pathname==='/api/action'){
 const {r,p}=membership(s,b.code);const now=Date.now();
 if(b.type==='ready'){if(r.status!=='lobby')fail('เริ่มเกมแล้ว');p.ready=!p.ready;}
 else if(b.type==='start'){
 if(p.id!==r.host)fail('เฉพาะเจ้าของห้อง',403);if(r.status!=='lobby')fail('เริ่มเกมแล้ว');
 if(r.mode==='pvp'&&(r.players.length!==2||!r.players.every(x=>x.ready)))fail('ต้องมี 2 คน และพร้อมทั้งคู่');r.status='playing';r.started=now+3000;
 }else if(b.type==='rematch'){if(p.id!==r.host)fail('เฉพาะเจ้าของห้อง',403);if(r.status!=='finished')fail('ยังไม่จบรอบ');newRound(r);}
 else if(b.type==='place'){
 if(r.status!=='playing'||now<r.started)fail('รอเริ่มเกม หรือเกมจบแล้ว');
 if(!Number.isInteger(b.piece)||b.piece<0||b.piece>=r.cols*r.rows||b.cell!==r.layout[b.piece])fail('ยังไม่ใช่ตำแหน่งนี้');
 const placed=r.mode==='coop'?r.shared:p.placed;if(placed.includes(b.piece))fail('ชิ้นนี้ต่อแล้ว');
 if(now-p.lastMove<80)fail('ช้าลงนิดนึง');p.lastMove=now;
 placed.push(b.piece);if(r.mode==='coop'){p.placed.push(b.piece);r.hints=Math.min(3,r.hints+(r.shared.length%5===0?1:0));}else p.charge=Math.min(5,p.charge+1);
 if(placed.length===r.cols*r.rows){r.status='finished';r.finished=now;r.winner=r.mode==='pvp'?p.id:'team';}
 }else if(b.type==='hint'){
 if(r.status!=='playing'||r.mode!=='coop'||r.hints<1)fail('สะสมทีมให้ครบ 5 ชิ้นเพื่อรับคำใบ้');if(!Number.isInteger(b.piece)||b.piece<0||b.piece>=r.cols*r.rows||r.shared.includes(b.piece))fail('เลือกชิ้นที่ยังไม่ต่อ');if(r.preview==='start')fail('ห้องนี้ปิดคำใบ้ภาพ');r.hints--;result={hint:r.layout[b.piece]};
 }else if(b.type==='fog'||b.type==='shield'){
 if(r.status!=='playing'||now<r.started||r.mode!=='pvp'||!r.items)fail('ใช้ไอเทมไม่ได้');
 const cost=b.type==='fog'?3:2;if(p.charge<cost)fail('พลังยังไม่พอ');
 if(b.type==='shield'){p.charge-=cost;p.shield=now+12000;p.fog=0;}
 else {const target=r.players.find(x=>x.id!==p.id);if(!target)fail('ยังไม่มีคู่แข่ง');if(target.fog>now)fail('คู่แข่งติดหมอกอยู่แล้ว');p.charge-=cost;if(target.shield<now)target.fog=now+6000;}
 }else fail('ไม่รู้จักคำสั่ง');broadcast(r);result={...result,state:view(r,p)};
 }else fail('ไม่พบ API',404);
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return;
 }
 if(req.method==='GET'&&url.pathname==='/api/image'){const {r}=membership(s,url.searchParams.get('room'));if(!r.image.startsWith('data:'))fail('ไม่มีรูปอัปโหลด',404);const match=r.image.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);res.writeHead(200,{'Content-Type':match[1]});res.end(Buffer.from(match[2],'base64'));return;}
 if(req.method==='GET'&&url.pathname==='/api/state'){const {r,p}=membership(s,url.searchParams.get('room'));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(view(r,p)));return;}
 if(req.method==='GET'&&url.pathname==='/api/events'){
 const {r,p}=membership(s,url.searchParams.get('room'));for(const old of [...r.streams])if(old.pid===p.id){old.res.end();r.streams.delete(old);}
 res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write(': connected\n\n');const stream={pid:p.id,res};r.streams.add(stream);broadcast(r);
 const heartbeat=setInterval(()=>res.write(': ping\n\n'),15000);req.on('close',()=>{clearInterval(heartbeat);r.streams.delete(stream);broadcast(r);});return;
 }fail('ไม่พบ API',404);
 }
 if(req.method!=='GET'&&req.method!=='HEAD')fail('Method not allowed',405);
 const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/art/coast.svg':'art/coast.svg','/art/garden.svg':'art/garden.svg','/art/space.svg':'art/space.svg','/art/mist.svg':'art/mist.svg','/art/tiles.svg':'art/tiles.svg','/art/stripes.svg':'art/stripes.svg'};
 const file=files[url.pathname];if(!file)fail('Not found',404);
 const data=await readFile(root+file);res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'image/svg+xml','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
 }catch(e){if(res.headersSent){res.end();return;}res.writeHead(e.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.status?e.message:'เซิร์ฟเวอร์ขัดข้อง กรุณาลองใหม่'}));}});}
const cleanup=setInterval(()=>{const now=Date.now();for(const [id,r] of rooms)if(!r.streams.size&&now-r.updated>6*3600000){rooms.delete(id);for(const s of sessions.values())s.rooms.delete(id);}for(const [id,s]of sessions)if(!s.rooms.size&&now-s.updated>24*3600000)sessions.delete(id);},60000);cleanup.unref();
if(process.argv[1]===fileURLToPath(import.meta.url)){const server=createApp();server.listen(Number(process.env.PORT)||Number(process.argv[process.argv.indexOf('--port')+1])||3000,'0.0.0.0',()=>console.log('Jigsaw Jam is listening'));process.on('SIGTERM',()=>{for(const r of rooms.values())for(const s of r.streams)s.res.end();server.close(()=>process.exit(0));});}
