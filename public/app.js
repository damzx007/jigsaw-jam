const $=id=>document.getElementById(id);
let serverOffset=0;
const serverTime=()=>Date.now()+serverOffset;
let mode='coop',image='coast',state=null,selected=null,source=null,art=null,order=[],lastRound='',lastPlaced='',toastTimer,busy=false,drag=null;
const pieceCache=new Map();
let page=0,zoom=1,counting=false,wonKey='',audioContext=null,soundOn=localStorage.getItem('jj-sound')!=='off';
const peers=new Map();
let dismissedResult='',bagKey='',shuffleVersion=0,layoutKey='',blastSeen='',blastTimer;
const playable=()=>state?.status==='playing'&&serverTime()>=state.started;
const cellOf=id=>state.layout[id];
const savedName=localStorage.getItem('jj-name');if(savedName)$('name').value=savedName;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
async function api(path,data){const response=await fetch('/api/'+path,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});const result=await response.json();if(!response.ok)throw new Error(result.error||'เชื่อมต่อไม่สำเร็จ');return result;}
function name(){const v=$('name').value.trim()||'เพื่อนใหม่';localStorage.setItem('jj-name',v);return v;}
function chooseMode(value){mode=value;$('item-setting-note').textContent=mode==='coop'?'โหมดช่วยกันต่อใช้คำใบ้ทีม • กระเป๋าไอเทมใช้ใน FFA และโหมดทีม':'สุ่มหมอก โล่ สลับถาด หรือระเบิดกระดาน · กระเป๋าเต็มจะข้ามรอบนั้น';document.querySelectorAll('[data-mode]').forEach(b=>{b.classList.toggle('selected',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});}
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>chooseMode(b.dataset.mode));
document.querySelectorAll('[data-image]').forEach(b=>b.onclick=()=>{image=b.dataset.image;if(['mist','tiles','stripes'].includes(image))$('difficulty').value='20';$('upload-info').textContent='';document.querySelectorAll('[data-image]').forEach(q=>{q.classList.toggle('selected',q===b);q.setAttribute('aria-pressed',String(q===b));});});
$('upload').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(file.size>15000000){toast('เลือกรูปเล็กกว่า 15 MB');return;}try{const bitmap=await createImageBitmap(file);const c=document.createElement('canvas');c.width=960;c.height=720;const ctx=c.getContext('2d');const scale=Math.max(960/bitmap.width,720/bitmap.height);ctx.drawImage(bitmap,(960-bitmap.width*scale)/2,(720-bitmap.height*scale)/2,bitmap.width*scale,bitmap.height*scale);bitmap.close();image=c.toDataURL('image/jpeg',.82);document.querySelectorAll('[data-image]').forEach(q=>{q.classList.remove('selected');q.setAttribute('aria-pressed','false');});$('upload-info').textContent='✓ ใช้รูปของคุณ (ครอปกลางภาพ 4:3)';}catch{toast('อ่านรูปไม่ได้ ลองใช้ JPG, PNG หรือ WebP');}};
async function enter(data){state=data;document.body.classList.add('in-room');selected=null;lastRound='';lastPlaced='';$('home').hidden=true;$('room').hidden=false;history.replaceState(null,'','/?room='+state.code);connect();await render(data);window.scrollTo({top:0,behavior:'smooth'});}
$('create').onclick=async()=>{if(busy)return;busy=true;$('create').disabled=true;try{await enter(await api('create',{name:name(),mode,image,cols:Number($('difficulty').value),items:$('items').checked,preview:$('preview-mode').value,bagSize:Number($('bag-size').value),itemInterval:Number($('item-interval').value)}));}catch(e){toast(e.message);}finally{busy=false;$('create').disabled=false;}};
$('join-form').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;try{await enter(await api('join',{name:name(),code:$('join-code').value.trim()}));}catch(e){toast(e.message);}finally{busy=false;}};
function connect(){peers.clear();source?.close();source=new EventSource('/api/events?room='+state.code);source.onmessage=e=>{try{render(JSON.parse(e.data));$('connection').textContent='● เชื่อมต่อแล้ว';}catch{toast('ข้อมูลห้องผิดพลาด');}};source.addEventListener('presence',e=>{const p=JSON.parse(e.data);p.received=Date.now();peers.set(p.id,p);drawPeers();});source.onerror=()=>{$('connection').textContent='○ กำลังเชื่อมต่อใหม่…';};}
async function action(type,extra={}){try{const result=await api('action',{code:state.code,type,...extra});if(result.state)await render(result.state);return result;}catch(e){toast(e.message);return null;}}
$('ready').onclick=()=>{unlockAudio();action('ready');};$('start').onclick=()=>{unlockAudio();action('start');};$('rematch').onclick=()=>action('rematch');
$('my-team').onchange=()=>action('team',{team:$('my-team').value});
$('result-close').onclick=()=>{dismissedResult=state.code+':'+state.round;$('result').hidden=true;};
$('share').onclick=async()=>{const link=location.origin+'/?room='+state.code;try{await navigator.clipboard.writeText(link);toast('คัดลอกลิงก์แล้ว ส่งให้เพื่อนได้เลย');}catch{toast('คัดลอกไม่ได้ รหัสห้อง: '+state.code);}};
$('leave').onclick=async()=>{const result=await api('leave',{code:state.code}).catch(e=>{toast(e.message);return null;});if(!result)return;source?.close();source=null;state=null;document.body.classList.remove('in-room');$('drag-ghost')?.remove();drag=null;history.replaceState(null,'','/');$('room').hidden=true;$('home').hidden=false;toast('ออกจากห้องแล้ว');};
$('preview-button').onclick=()=>{if(state.preview==='start'&&state.status!=='finished'){toast('ห้องนี้ดูภาพได้เฉพาะตอนเริ่ม');return;}if(state?.fog>serverTime()){toast('ติดหมอกอยู่ รอให้หมดก่อน');return;}$('preview').hidden=!$('preview').hidden;};
$('shuffle').onclick=()=>{if(!state)return;order.sort(()=>Math.random()-.5);renderTray();};
$('hint').onclick=async()=>{if(selected===null){toast('เลือกชิ้นที่อยากได้คำใบ้ก่อน');return;}const result=await action('hint',{piece:selected});if(result?.hint!==undefined){const cell=$('board').querySelector(`[data-cell="${result.hint}"]`);cell?.classList.add('hint');setTimeout(()=>cell?.classList.remove('hint'),2500);}};
function edge(horizontal,row,col){let x=Math.imul(row+1,73856093)^Math.imul(col+1,19349663)^(horizontal?83492791:29765729);x^=x>>>16;x=Math.imul(x,0x45d9f3b);x^=x>>>16;return (x&1)?1:-1;}
function piecePath(id,w,h,pad){const cell=cellOf(id),col=cell%state.cols,row=Math.floor(cell/state.cols),path=new Path2D();const top=row===0?0:edge(true,row,col),right=col===state.cols-1?0:edge(false,row,col+1),bottom=row===state.rows-1?0:-edge(true,row+1,col),left=col===0?0:-edge(false,row,col);path.moveTo(pad,pad);function side(x,y,dx,dy,e){const nx=dy,ny=-dx;const a=.36,b=.64,t=.22;const point=(u,v)=>[x+dx*u+nx*v,y+dy*u+ny*v];path.lineTo(...point(a,0));if(e){path.bezierCurveTo(...point(.46,0),...point(.28,e*t),...point(.5,e*t));path.bezierCurveTo(...point(.72,e*t),...point(.54,0),...point(b,0));}path.lineTo(...point(1,0));}side(pad,pad,w,0,top);side(pad+w,pad,0,h,right);side(pad+w,pad+h,-w,0,bottom);side(pad,pad+h,0,-h,left);path.closePath();return path;}
function pieceCanvas(id){if(pieceCache.has(id))return pieceCache.get(id);const w=96,h=96*state.cols*3/(state.rows*4),pad=24,c=document.createElement('canvas');c.width=w+pad*2;c.height=h+pad*2;const ctx=c.getContext('2d');const path=piecePath(id,w,h,pad);ctx.save();ctx.clip(path);ctx.drawImage(art,pad-(cellOf(id)%state.cols)*w,pad-Math.floor(cellOf(id)/state.cols)*h,w*state.cols,h*state.rows);ctx.restore();ctx.save();ctx.translate(0,2);ctx.strokeStyle='rgba(20,30,22,.65)';ctx.lineWidth=3;ctx.stroke(path);ctx.restore();ctx.strokeStyle='rgba(255,255,240,.72)';ctx.lineWidth=1.1;ctx.stroke(path);pieceCache.set(id,c);return c;}
function copyCanvas(id){const base=pieceCanvas(id),c=document.createElement('canvas');c.width=base.width;c.height=base.height;c.getContext('2d').drawImage(base,0,0);return c;}
function renderBoard(){
 const board=$('board');board.replaceChildren();const n=state.cols*state.rows;
 for(let cell=0;cell<n;cell++){const button=document.createElement('button');button.className='cell';button.dataset.cell=cell;button.style.left=(cell%state.cols)*100/state.cols+'%';button.style.top=Math.floor(cell/state.cols)*100/state.rows+'%';button.style.width=100/state.cols+'%';button.style.height=100/state.rows+'%';button.setAttribute('aria-label',`แถว ${Math.floor(cell/state.cols)+1} ช่อง ${cell%state.cols+1}`);button.disabled=state.placed.some(id=>cellOf(id)===cell)||!playable();button.onclick=()=>place(cell);board.append(button);}
 for(const id of state.placed){const cell=cellOf(id),c=copyCanvas(id),w=96,h=c.height-48;c.dataset.placed=id;c.style.left=((cell%state.cols)-24/w)*100/state.cols+'%';c.style.top=(Math.floor(cell/state.cols)-24/h)*100/state.rows+'%';c.style.width=(w+48)/w*100/state.cols+'%';c.style.height=(h+48)/h*100/state.rows+'%';board.append(c);}
}
function renderTray(){
 if(!art)return;const tray=$('tray');tray.replaceChildren();const remaining=order.filter(id=>!state.placed.includes(id)),cols=Math.max(3,Math.min(8,Math.floor(tray.clientWidth/74))),rows=Math.max(1,Math.min(4,Math.floor(tray.clientHeight/56))),pageSize=cols*rows,pages=Math.max(1,Math.ceil(remaining.length/pageSize));page=Math.min(page,pages-1);tray.style.setProperty('--tray-cols',cols);tray.style.setProperty('--tray-rows',rows);
 $('page-label').textContent=`ถาด ${page+1} / ${pages}`;$('prev-page').disabled=page===0;$('next-page').disabled=page>=pages-1;
 for(const id of remaining.slice(page*pageSize,(page+1)*pageSize)){
 const button=document.createElement('button');button.className='piece'+(selected===id?' selected':'');button.dataset.piece=id;button.setAttribute('aria-label','เลือกชิ้น '+(order.indexOf(id)+1));button.setAttribute('aria-pressed',String(selected===id));button.disabled=!playable();button.append(copyCanvas(id));
 button.onclick=()=>{if(drag?.moved)return;unlockAudio();select(id);sendPresence(null,true);};
 button.onpointerdown=e=>{if(!playable())return;unlockAudio();select(id);drag={id,x:e.clientX,y:e.clientY,moved:false,pointer:e.pointerId};button.setPointerCapture(e.pointerId);sendPresence(e,true);};
 button.onpointermove=e=>{if(!drag||drag.pointer!==e.pointerId)return;if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>7)drag.moved=true;if(drag.moved){let ghost=$('drag-ghost');if(!ghost){ghost=copyCanvas(id);ghost.id='drag-ghost';document.body.append(ghost);}ghost.style.transform=`translate3d(${e.clientX-48}px,${e.clientY-55}px,0) rotate(-3deg) scale(1.12)`;sendPresence(e);}};
 button.onpointerup=e=>{if(!drag)return;const moved=drag.moved;$('drag-ghost')?.remove();if(moved){const rect=$('board').getBoundingClientRect(),col=Math.floor((e.clientX-rect.left)/rect.width*state.cols),row=Math.floor((e.clientY-rect.top)/rect.height*state.rows);if(col>=0&&col<state.cols&&row>=0&&row<state.rows)place(row*state.cols+col);}setTimeout(()=>drag=null,0);};
 button.onpointercancel=()=>{$('drag-ghost')?.remove();drag=null;selected=null;sendPresence(null,true);};tray.append(button);
 }drawPeers();
}
function select(id){selected=id;$('tray').querySelectorAll('.piece').forEach(b=>{const active=Number(b.dataset.piece)===id;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});}
async function place(cell){if(selected===null){return;}if(busy||!playable())return;busy=true;const id=selected;try{const result=await action('place',{piece:id,cell});if(result){if(selected===id)selected=null;sendPresence(null,true);renderTray();}}finally{busy=false;}}
let renderVersion=0;
async function render(next){
 if(state?.code===next.code&&state.revision>next.revision)return;
 state=next;serverOffset=next.serverNow-Date.now();const version=++renderVersion,key=state.code+':'+state.round;
 if(lastRound!==key){blastSeen=next.blast?.id||'';$('blast-effect')?.remove();clearTimeout(blastTimer);$('board-wrap').classList.remove('board-hit');lastRound=key;lastPlaced='';bagKey='';shuffleVersion=state.shuffleVersion;selected=null;order=[...state.order];page=0;counting=false;peers.clear();pieceCache.clear();art=null;zoom=1;$('preview').hidden=true;
  const img=new Image(),src=state.image==='upload'?'/api/image?room='+state.code:'/art/'+state.image+'.svg';await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=src;}).catch(()=>toast('โหลดรูปไม่สำเร็จ'));if(version!==renderVersion&&lastRound!==key)return;art=img;$('preview').src=src;
 }
 if(!art?.complete||!art.naturalWidth)return;
 const coop=state.mode==='coop',team=state.mode==='team',host=state.host===state.you,me=state.players.find(p=>p.id===state.you);
 document.documentElement.style.setProperty('--my-color',me?.color||'#edaf57');
 $('room-code').textContent=state.code;$('room-mode').textContent=coop?'CO-OP':team?'TEAM VS TEAM':'FREE FOR ALL';
 $('room-title').textContent=coop?'ต่อด้วยกัน ให้ครบภาพ':team?'ช่วยทีมเรา ต่อให้ครบก่อน':'ใครต่อครบก่อน ชนะ!';
 $('progress').textContent=state.placed.length+' / '+state.cols*state.rows+' ชิ้น';$('player-count').textContent=state.players.length+' / 8 คน';
 $('hint').hidden=!coop||state.preview==='start';$('hint-count').textContent=state.hints;$('hint').disabled=!playable()||!state.hints;
 $('preview-button').disabled=state.preview==='start'&&state.status!=='finished';$('preview-button').textContent=state.preview==='start'&&state.status!=='finished'?'◉ ดูเฉพาะตอนเริ่ม':'◉ ดูรูป';
 renderPlayers();
 $('lobby').hidden=state.status!=='lobby';$('ready').hidden=coop;$('ready').textContent=me?.ready?'✓ พร้อมแล้ว':'พร้อมเล่น';
 $('team-picker').hidden=!team;$('my-team').value=state.team;
 $('start').hidden=!host;$('start').disabled=!coop&&(state.players.length<2||!state.players.every(p=>p.ready)||(team&&new Set(state.players.map(p=>p.team)).size<2));
 $('lobby-message').textContent=coop?(host?'เล่นคนเดียวได้ หรือชวนเพื่อนก่อนเริ่ม':'รอเจ้าของห้องเริ่มเกม'):team?'เลือกทีม แล้วทุกคนกดพร้อม':'แข่งคนละกระดาน ทุกคนกดพร้อมก่อนเริ่ม';
 $('result').hidden=state.status!=='finished'||dismissedResult===key;
 const win=coop||(team?state.winner===state.team:state.winner===state.you);
 $('result-title').textContent=coop?'ครบภาพแล้ว! 🎉':win?'ชนะแล้ว! 🏆':'รอบหน้าเอาใหม่ ✦';
 $('result-detail').textContent=coop?'ฝีมือของทั้งทีม':team?'ผู้ชนะ: '+(state.teams.find(t=>t.id===state.winner)?.name||''):'ผู้ชนะ: '+(state.players.find(p=>p.id===state.winner)?.name||'');$('rematch').hidden=!host;
 $('powers').hidden=!state.items;renderInventory();
 const changedShuffle=shuffleVersion!==state.shuffleVersion;
 if(changedShuffle){shuffleVersion=state.shuffleVersion;order.sort(()=>Math.random()-.5);selected=null;$('drag-ghost')?.remove();drag=null;sendPresence(null,true);}
 const placedKey=key+':'+state.team+':'+state.status+':'+state.placed.join(',');
 if(lastPlaced!==placedKey){const oldIds=new Set([...$('board').querySelectorAll('[data-placed]')].map(c=>Number(c.dataset.placed))),added=state.placed.filter(id=>!oldIds.has(id)),animate=lastPlaced!=='';lastPlaced=placedKey;
  if(state.placed.includes(selected)){selected=null;$('drag-ghost')?.remove();drag=null;}
  renderBoard();renderTray();if(animate&&added.length){for(const id of added)$('board').querySelector(`[data-placed="${id}"]`)?.classList.add('snap-in');tone('snap');}
 }else if(changedShuffle)renderTray();
 if(state.blast?.id&&state.blast.id!==blastSeen){blastSeen=state.blast.id;if(serverTime()-state.blast.at<2000)showBlast(state.blast);}
 if(state.status==='finished'&&wonKey!==key){wonKey=key;if(win)celebrate();}
 const fitKey=state.status+':'+state.mode+':'+state.items;
 if(layoutKey!==fitKey){layoutKey=fitKey;requestAnimationFrame(()=>{if(state){setZoom(zoom);renderTray();}});}
 tick();drawPeers();
}
function renderPlayers(){
 const list=$('players');list.replaceChildren();
 if(state.mode==='team')for(const t of state.teams){const score=document.createElement('div');score.className='team-score';score.style.setProperty('--player-color',t.color);score.textContent=t.name+' '+t.count+'/'+state.cols*state.rows;list.append(score);}
 for(const p of state.players){const card=document.createElement('div');card.className='player-chip'+(p.online?'':' offline');card.style.setProperty('--player-color',p.color);if(state.mode==='team')card.dataset.team=p.team;
  const dot=document.createElement('i'),name=document.createElement('span'),amount=document.createElement('small');name.className='player-name';name.textContent=p.name+(p.id===state.you?' · คุณ':'');amount.textContent=state.status==='lobby'?(p.ready?'✓':'—'):state.mode==='ffa'?p.progress+'/'+state.cols*state.rows:String(p.count);
  card.setAttribute('aria-label',p.name+(p.online?' ออนไลน์':' ออฟไลน์')+(state.mode==='team'?' '+state.teams.find(t=>t.id===p.team)?.name:''));card.append(dot,name,amount);list.append(card);
 }
}
const itemInfo={bomb:{icon:'💣',name:'ระเบิด',detail:'ระเบิดชิ้นที่ต่อแล้ว 25% (สูงสุด 24 ชิ้น) กลับถาด · โล่ป้องกันได้'},fog:{icon:'☁',name:'หมอก',detail:'บังภาพคู่แข่ง 6 วินาที'},shield:{icon:'◇',name:'โล่',detail:'ป้องกัน 12 วินาทีและล้างหมอก'},shuffle:{icon:'↻',name:'สลับถาด',detail:'สลับเฉพาะชิ้นที่คู่แข่งยังไม่ต่อ'}};
function renderInventory(){
 if(!state.items)return;
 const target=$('item-target'),old=target.value,options=state.mode==='team'?state.teams.filter(t=>t.id!==state.team).map(t=>({id:t.id,name:t.name})):state.players.filter(p=>p.id!==state.you);
 const optionsKey=options.map(p=>p.id+':'+p.name).join('|');
 if(target.dataset.options!==optionsKey){target.dataset.options=optionsKey;target.replaceChildren();for(const p of options){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;target.append(option);}if(options.some(p=>p.id===old))target.value=old;}
 $('bag-count').textContent=state.bag.length+'/'+state.bagSize;
 const key=state.bag.map(i=>i.id).join(',')+':'+state.bagSize;
 if(key!==bagKey){const previous=new Set([...$('inventory').querySelectorAll('[data-item]')].map(el=>el.dataset.item));bagKey=key;$('inventory').replaceChildren();
  for(let i=0;i<state.bagSize;i++){const item=state.bag[i],slot=document.createElement('button');slot.className='item-slot';
   if(item){const info=itemInfo[item.type];slot.dataset.item=item.id;slot.title=info.detail+(state.mode==='team'?' · มีผลทั้งทีม':'');slot.setAttribute('aria-label','ใช้'+info.name);const icon=document.createElement('span'),label=document.createElement('small');icon.textContent=info.icon;label.textContent=info.name;slot.append(icon,label);if(!previous.has(item.id))slot.classList.add('item-arrived');slot.onclick=()=>{unlockAudio();action('use-item',{itemId:item.id,target:target.value}).then(r=>{if(r)tone('go');});};}
   else{slot.classList.add('empty');slot.textContent='·';slot.setAttribute('aria-label','ช่องกระเป๋าว่าง');}slot.disabled=!item||!playable();$('inventory').append(slot);
  }
 }
}
function tick(){
 if(!state)return;const now=serverTime(),secs=state.started?Math.max(0,Math.floor(((state.finished||now)-state.started)/1000)):0;
 $('clock').textContent=String(Math.floor(secs/60)).padStart(2,'0')+':'+String(secs%60).padStart(2,'0');
 const before=state.status==='playing'&&now<state.started;$('countdown').hidden=!before;
 if(before){counting=true;$('preview').hidden=false;$('countdown-number').textContent=Math.ceil((state.started-now)/1000);}
 else if(counting){counting=false;$('preview').hidden=true;renderBoard();renderTray();tone('go');}
 $('shield-ring').hidden=!(state.status==='playing'&&state.shield>now);
 const fog=state.status==='playing'&&state.fog>now;$('fog-overlay').hidden=!fog;if(fog){$('preview').hidden=true;$('fog-time').textContent=Math.ceil((state.fog-now)/1000)+' วิ';}
 $('shield-status').textContent=state.shield>now&&state.status==='playing'?'◇ '+Math.ceil((state.shield-now)/1000)+' วิ':'';
 if(state.items){$('next-item').textContent=state.status==='lobby'?'สุ่มทุก '+state.itemInterval+' วิ':state.status==='finished'?'จบรอบ':state.bag.length>=state.bagSize?'เต็ม · รอบใหม่ '+Math.max(0,Math.ceil((state.nextItemAt-now)/1000))+' วิ':'สุ่มใน '+Math.max(0,Math.ceil((state.nextItemAt-now)/1000))+' วิ';
  $('inventory').querySelectorAll('button').forEach(button=>button.disabled=!button.dataset.item||!playable());}
}
setInterval(()=>{tick();drawPeers();},200);
const roomCode=new URLSearchParams(location.search).get('room');if(roomCode){$('join-code').value=roomCode.toUpperCase();api('state?room='+encodeURIComponent(roomCode)).then(enter).catch(()=>{toast('ใส่ชื่อ แล้วกดเข้าห้องเพื่อเล่นกับเพื่อน');$('name').focus();});}

function setZoom(value){zoom=Math.max(1,Math.min(3,value));const scroll=$('board-scroll'),base=Math.min(Math.max(100,scroll.clientWidth-26),Math.max(80,scroll.clientHeight-30)*4/3);$('board-wrap').style.width=(base*zoom)+'px';$('zoom-label').textContent=Math.round(zoom*100)+'%';}
$('zoom-in').onclick=()=>setZoom(zoom+.25);$('zoom-out').onclick=()=>setZoom(zoom-.25);
$('prev-page').onclick=()=>{page--;renderTray();};$('next-page').onclick=()=>{page++;renderTray();};
function applyTheme(theme){document.documentElement.dataset.theme=theme;localStorage.setItem('jj-theme',theme);$('theme-toggle').textContent=theme==='dark'?'☀ สว่าง':'☾ มืด';$('theme-toggle').setAttribute('aria-pressed',String(theme==='dark'));}
applyTheme(localStorage.getItem('jj-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
$('theme-toggle').onclick=()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
function unlockAudio(){if(!soundOn)return;try{audioContext??=new(window.AudioContext||window.webkitAudioContext)();audioContext.resume().catch(()=>{});}catch{}}
function tone(type){if(!soundOn||!audioContext||audioContext.state!=='running')return;try{const notes=type==='win'?[523,659,784,1046]:type==='go'?[440,880]:[700,1100];notes.forEach((freq,i)=>{const osc=audioContext.createOscillator(),gain=audioContext.createGain(),t=audioContext.currentTime+i*.065;osc.type='sine';osc.frequency.value=freq;gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(.055,t+.008);gain.gain.exponentialRampToValueAtTime(.001,t+.18);osc.connect(gain);gain.connect(audioContext.destination);osc.start(t);osc.stop(t+.2);});}catch{}}
function soundLabel(){$('sound-toggle').textContent=soundOn?'♫ เสียงเปิด':'♫ เสียงปิด';$('sound-toggle').setAttribute('aria-pressed',String(soundOn));}soundLabel();
$('sound-toggle').onclick=()=>{soundOn=!soundOn;localStorage.setItem('jj-sound',soundOn?'on':'off');soundLabel();unlockAudio();if(soundOn)tone('snap');};
function celebrate(){tone('win');const target=$('confetti');target.replaceChildren();target.hidden=false;for(let i=0;i<36;i++){const el=document.createElement('i');el.style.setProperty('--x',(Math.random()*100)+'%');el.style.setProperty('--delay',(Math.random()*.5)+'s');el.style.setProperty('--color',['#e1ba6c','#8eac98','#d18c77','#c5b5d6'][i%4]);el.style.setProperty('--spin',(Math.random()*600)+'deg');target.append(el);}setTimeout(()=>target.hidden=true,4500);}
let presenceAt=0;
function sendPresence(e,force=false){if(!playable())return;const now=Date.now();if(!force&&now-presenceAt<300)return;presenceAt=now;api('presence',{code:state.code,piece:selected}).catch(()=>{});}
function drawPeers(){
 if(!state)return;
 $('tray').querySelectorAll('.held').forEach(el=>{el.classList.remove('held');el.style.removeProperty('--holder-color');});
 if(state.mode==='ffa')return;
 for(const [id,presence] of peers){const player=state.players.find(p=>p.id===id);if(Date.now()-presence.received>4500||!player?.online){peers.delete(id);continue;}
  if(state.mode==='team'&&player.team!==state.team)continue;
  if(presence.piece!==null){const piece=$('tray').querySelector(`[data-piece="${presence.piece}"]`);if(piece){piece.classList.add('held');piece.style.setProperty('--holder-color',player.color);}}
 }
}
let zoomResize;addEventListener('resize',()=>{clearTimeout(zoomResize);zoomResize=setTimeout(()=>{if(state){setZoom(zoom);renderTray();}},120);});
setInterval(()=>{if(selected!==null&&playable())sendPresence(null,true);},1200);

chooseMode('coop');

// Board-local impact only: no floating messages over other players' screens.
function showBlast(blast){
 const wrap=$('board-wrap');$('blast-effect')?.remove();clearTimeout(blastTimer);wrap.classList.remove('board-hit');
 const effect=document.createElement('div');effect.id='blast-effect';effect.className=blast.blocked?'blast blocked':'blast';effect.setAttribute('role','status');effect.setAttribute('aria-label',blast.blocked?'โล่กันระเบิดแล้ว':`โดนระเบิด ${blast.removed.length} ชิ้นกลับถาด`);
 const x=((blast.center%state.cols)+.5)*100/state.cols,y=(Math.floor(blast.center/state.cols)+.5)*100/state.rows;effect.style.setProperty('--blast-x',x+'%');effect.style.setProperty('--blast-y',y+'%');
 const ring=document.createElement('i'),core=document.createElement('b');ring.className='blast-ring';core.className='blast-core';core.textContent=blast.blocked?'◇':'✹';effect.append(ring,core);
 if(!blast.blocked){
  for(let i=0;i<18;i++){const spark=document.createElement('i'),angle=i*Math.PI*2/18;spark.className='blast-spark';spark.style.setProperty('--dx',Math.cos(angle)*(70+Math.random()*130)+'px');spark.style.setProperty('--dy',Math.sin(angle)*(70+Math.random()*130)+'px');spark.style.setProperty('--spin',(Math.random()*500-250)+'deg');effect.append(spark);}
  for(const id of blast.removed.slice(0,12)){const shard=copyCanvas(id),cell=cellOf(id);shard.className='blast-shard';shard.style.left=((cell%state.cols)+.5)*100/state.cols+'%';shard.style.top=(Math.floor(cell/state.cols)+.5)*100/state.rows+'%';shard.style.width=Math.max(18,130/state.cols)+'%';shard.style.setProperty('--dx',((cell%state.cols+.5)/state.cols*2-1)*180+'px');shard.style.setProperty('--dy',70+Math.random()*180+'px');shard.style.setProperty('--spin',(Math.random()*240-120)+'deg');effect.append(shard);}
  wrap.classList.add('board-hit');bombSound();
 }else tone('snap');
 wrap.append(effect);blastTimer=setTimeout(()=>{effect.remove();wrap.classList.remove('board-hit');},1400);
}
function bombSound(){
 if(!soundOn||!audioContext||audioContext.state!=='running')return;
 try{const ctx=audioContext,t=ctx.currentTime,buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*.65),ctx.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length)**2;
 const noise=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();noise.buffer=buffer;filter.type='lowpass';filter.frequency.setValueAtTime(2600,t);filter.frequency.exponentialRampToValueAtTime(90,t+.6);gain.gain.setValueAtTime(.24,t);gain.gain.exponentialRampToValueAtTime(.001,t+.65);noise.connect(filter);filter.connect(gain);gain.connect(ctx.destination);noise.start(t);noise.stop(t+.65);
 const bass=ctx.createOscillator(),low=ctx.createGain();bass.frequency.setValueAtTime(140,t);bass.frequency.exponentialRampToValueAtTime(32,t+.4);low.gain.setValueAtTime(.22,t);low.gain.exponentialRampToValueAtTime(.001,t+.5);bass.connect(low);low.connect(ctx.destination);bass.start(t);bass.stop(t+.5);
 }catch{}
}
