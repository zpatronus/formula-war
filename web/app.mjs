import {parse,trace,reconstruct,shooterFor,RANGE,pathAtLength,viewX,viewerTeam,equationForView} from './game.mjs';
import {escapeHTML as esc,editEquation,trajectoryHistory} from './ui.mjs';
const $=id=>document.getElementById(id);
let session=null,room=null,stream=null,state=null,pendingRoom=null,connected=false,busy=false,toastTimer,stateKey,animationFrame=null,practice=false,practiceTeam='red';
const SHOT_SPEED=48; // World units of arc length per second.
let animations=[];
function cancelAnimation(){if(animationFrame!==null)cancelAnimationFrame(animationFrame);animationFrame=null;animations=[];}
function animate(now){
 animationFrame=null;const active=animations[0];
 if(active){
  if(active.started===null)active.started=now;
  const path=state?.paths.find(p=>p.shot===active.shot);
  if(!path||(now-active.started)*SHOT_SPEED/1000>=path.distances.at(-1)){
   animations.shift();if(animations[0])animations[0].started=now;updateControls();
  }
 }
 draw(now);if(animations.length)animationFrame=requestAnimationFrame(animate);
}
function startAnimationLoop(){if(animations.length&&animationFrame===null)animationFrame=requestAnimationFrame(animate);}
try{$('name').value=localStorage.getItem('fw-name')||'';session=JSON.parse(sessionStorage.getItem('fw-session')||'null');}catch{}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
async function request(path,body){const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});let data;try{data=await response.json();}catch{throw Error('Server unavailable. Try again.');}if(!response.ok)throw Error(data.error||'Request failed');return data;}
function remember(name){try{localStorage.setItem('fw-name',name);}catch{}}
async function action(kind,body={}){
 if(practice){
  if(kind==='leave')return {};
  if(kind!=='fire')throw Error('Use the practice controls.');
  const next=structuredClone(room);
  next.history.push({kind:'fire',player:session.player,text:body.text,data:body.data,at:new Date().toISOString()});
  next.shot++;if(body.data.winner||next.shot>=100)next.phase='finished';
  return next;
 }
 if(!session)throw Error('Join a room first.');return request(`/api/rooms/${session.room}/${kind}`,{token:session.token,...body});}
async function rooms(){if(room)return;try{const list=await request('/api/rooms');$('room-count').textContent=`${list.length} / 100`;$('room-list').innerHTML=list.length?list.sort((a,b)=>a.created.localeCompare(b.created)).map(r=>`<div class="room-card"><div><h3>${esc(r.name)}</h3><p>${r.players} in room · ${esc(r.phase)} · ${esc(r.id)}</p></div><button data-room="${esc(r.id)}">${r.phase==='playing'?'Watch':'Enter'} ↗</button></div>`).join(''):'<div class="empty"><strong>The board is yours.</strong>No open rooms yet. Enter a room name to get started.</div>';}catch(e){toast(e.message);}}
$('refresh').onclick=rooms;$('room-list').onclick=e=>{const b=e.target.closest('[data-room]');if(b)joinPrompt(b.dataset.room);};
function joinPrompt(id){pendingRoom=id;$('join-name').value=$('name').value;$('join-dialog').showModal();$('join-name').focus();}
$('cancel-join').onclick=()=>{$('join-dialog').close();if(!room)history.replaceState(null,'',location.pathname);};
$('join-form').onsubmit=async e=>{e.preventDefault();try{const name=$('join-name').value.trim();const data=await request(`/api/rooms/${pendingRoom}/join`,{name});remember(name);$('join-dialog').close();enter(data);}catch(e){toast(e.message);}};
$('entry-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{const name=$('name').value.trim();const data=await request('/api/rooms',{name:$('room-name').value.trim(),player:name});remember(name);enter(data);}catch(e){toast(e.message);}finally{button.disabled=false;}};
function startPractice(team=practiceTeam){
 if(stream){stream.onmessage=null;stream.onerror=null;stream.close();}stream=null;cancelAnimation();room=null;stateKey=null;practice=true;practiceTeam=team;connected=true;
 const name=$('name').value.trim()||'You';session={room:'practice',player:'practice-you'};
 const opponent=team==='red'?'blue':'red';
 const players=[{id:session.player,name,team},...Array.from({length:3},(_,i)=>({id:`target-${i}`,name:`Target ${i+1}`,team:opponent}))];
 const now=new Date().toISOString();
 history.replaceState(null,'','#practice');$('connection').textContent='● LOCAL PRACTICE';
 apply({id:'practice',name:'Target practice',host:session.player,players,roster:players,created:now,active:now,phase:'playing',turn:team,firstTurn:team,seed:Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join(''),shot:0,history:[]});
}
$('training').onclick=()=>startPractice('red');
$('practice-reset').onclick=()=>startPractice();
$('practice-side').onclick=()=>startPractice(practiceTeam==='red'?'blue':'red');
function enter(data){practice=false;session={room:data.room.id,token:data.token,player:data.player};try{sessionStorage.setItem('fw-session',JSON.stringify(session));}catch{}history.replaceState(null,'',`#${session.room}`);apply(data.room);connect();}
function connect(){if(stream)stream.close();connected=false;stream=new EventSource(`/api/rooms/${session.room}/events?token=${encodeURIComponent(session.token)}`);stream.onmessage=e=>{connected=true;$('connection').textContent='● CONNECTED';try{apply(JSON.parse(e.data));}catch{toast('Could not read room update.');}};stream.onerror=()=>{connected=false;updateControls();$('connection').textContent='○ RECONNECTING';// Check expiry without treating reconnect heartbeats as activity.
 fetch('/api/rooms').then(r=>r.json()).then(list=>{if(session&&Array.isArray(list)&&!list.some(r=>r.id===session.room)){exit();toast('This room has expired. Enter a room name to play again.');}}).catch(()=>{});};}
function apply(data){$('room-view').classList.toggle('practice',practice);$('room-view').classList.toggle('in-match',data.phase==='playing');$('teams-title').textContent=data.phase==='playing'?'TEAMS':'CHOOSE YOUR SIDE';$('history-heading').textContent=practice?'Shot history':'History & chat';$('feed-status').textContent=practice?'● LOCAL':'● LIVE';$('practice-rules').hidden=!practice;$('multiplayer-rules').hidden=practice;$('invite').hidden=practice;$('practice-reset').hidden=!practice;$('practice-side').hidden=!practice;const previous=room;room=data;if(!previous||previous.id!==room.id||previous.seed!==room.seed||room.shot<previous.shot)cancelAnimation();const key=JSON.stringify([room.seed,room.roster,room.players.filter(p=>p.team!=='watch'),room.history.filter(e=>e.kind==='fire')]);if(key!==stateKey){state=reconstruct(room);stateKey=key;if(previous&&previous.id===room.id&&previous.seed===room.seed&&room.shot>previous.shot){for(const p of state.paths.filter(p=>p.shot>=previous.shot))animations.push({shot:p.shot,started:null});startAnimationLoop();}}$('home').hidden=true;$('room-view').hidden=false;$('room-title').textContent=room.name;$('room-code').textContent=`ROOM ${room.id} / ${new Date(room.created).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`;
 const winner=[...room.history].reverse().find(e=>e.kind==='fire'&&e.data?.winner)?.data.winner;
 $('phase-label').textContent=room.phase==='lobby'?'Lobby · waiting for players':room.phase==='finished'?(winner&&winner!=='draw'?`${winner} team wins`:'Match ended'):`Shot ${room.shot+1} / 100`;
 $('turn-label').textContent=room.phase==='playing'?`${room.turn} team's turn`:room.phase==='lobby'?'Pick a team or spectate':'Host can start a rematch';
 const current=shooterFor(state.units,room.turn,room.shot);$('arena-note').textContent=room.phase==='playing'&&current?`${current.name} is aiming${current.id===session.player?` · (${viewX(current.x,viewerTeam(room,session.player)).toFixed(1)}, ${current.y.toFixed(1)})`:''}`:room.phase==='lobby'?'The arena is generated when the host starts.':'';
 $('teams').innerHTML=['red','blue','watch'].map(team=>{const members=room.players.filter(p=>p.team===team);return `<div class="team"><div class="team-heading ${team}"><span>${team==='watch'?'Spectators':team==='red'?'● Red team':'● Blue team'} <span class="muted">${members.length}${team==='watch'?'':' / 4'}</span></span><button type="button" data-team="${team}" ${room.phase==='playing'?'disabled':''}>${members.some(p=>p.id===session.player)?'Selected':team==='watch'?'Watch':'Join'}</button></div><div class="team-members">${members.length?members.map(p=>`<div class="player-name"><span>${esc(p.name)}${p.id===session.player?' (you)':''}</span><span>${p.id===room.host?'host':state.units.find(u=>u.id===p.id)?.alive===false?'out':''}</span></div>`).join(''):'Waiting for players…'}</div></div>`;}).join('');
 $('start').hidden=practice||room.host!==session.player;$('start').textContent=room.phase==='finished'?'Play again ↗':'Start match ↗';$('host-note').textContent=room.host===session.player?'Start when both teams have at least one player. Starting team is chosen randomly.':'The host starts the match when everyone is ready.';
 const feed=$('feed'),wasBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight<40;feed.innerHTML=room.history.length?room.history.map(e=>{const name=room.players.find(p=>p.id===e.player)?.name||'Former player';return e.kind==='chat'?`<p><strong>${esc(name)}</strong><br>${esc(e.text)}</p>`:`<p class="muted">↗ ${esc(name)} fired <code>${esc(equationForView(e.text,(room.roster||room.players).find(p=>p.id===e.player)?.team||'red',viewerTeam(room,session.player)))}</code>${e.data?.hits?.length?` · ${e.data.hits.length} hit${e.data.hits.length===1?'':'s'}!`:''}</p>`;}).join(''):(practice?'<p class="muted">Your shots will appear here.</p>':'<p class="muted">Invite your friends. Pick a side. Make a little mathematical mayhem.</p>');if(wasBottom)feed.scrollTop=feed.scrollHeight;if(practice){$('room-code').textContent='LOCAL PRACTICE / NO ROOM SLOT USED';$('phase-label').textContent=room.phase==='finished'?'Practice complete':`Practice · shot ${room.shot+1}`;$('turn-label').textContent=room.phase==='finished'?'New targets to try again':`${practiceTeam} side · your turn`;}$('coordinate-info').textContent=room.players.find(p=>p.id===session.player)?.team==='watch'?'Arena coordinates · red left / blue right':'Arena coordinates · your team fires left to right';$('practice-side').textContent=practiceTeam==='red'?'Try blue side ⇄':'Try red side ⇄';updateControls();draw();}
function updateControls(){if(!room)return;const current=shooterFor(state.units,room.turn,room.shot),canFire=connected&&!busy&&!animations.length&&room.phase==='playing'&&current?.id===session.player;$('fire').disabled=!canFire;$('start').disabled=!!animations.length||room.phase==='playing'||!['red','blue'].every(t=>room.players.some(p=>p.team===t));$('equation').disabled=!!animations.length||room.phase!=='playing';$('equation-keys').disabled=$('equation').disabled;$('native-keyboard').disabled=$('equation').disabled;}
$('teams').onclick=async e=>{const b=e.target.closest('[data-team]');if(!b||b.disabled||room?.phase==='playing')return;try{apply(await action('team',{team:b.dataset.team}));}catch(e){toast(e.message);}};
$('start').onclick=async()=>{try{apply(await action('start'));}catch(e){toast(e.message);}};
function getShot(){const shooter=shooterFor(state.units,room.turn,room.shot);if(!shooter)throw Error('No active shooter.');const shot=trace(parse($('equation').value),shooter,state.units,state.obstacles);if(shot.length===0||shot.points.length<2)throw Error('This equation cannot be traced at this scale. Reduce steep or large exponential terms. No turn was used.');return {...shot,team:shooter.team};}
$('equation').oninput=()=>{$('shot-info').textContent=`${RANGE} units of curve per shot`;};
let nativeKeyboard=!(window.matchMedia?.('(pointer: coarse)').matches);
function configureKeyboard(){
 $('equation').inputMode=nativeKeyboard?'text':'none';
 $('native-keyboard').setAttribute('aria-pressed',String(nativeKeyboard));
 $('native-keyboard').textContent=nativeKeyboard?'Device keyboard on':'Use device keyboard';
}
configureKeyboard();
$('native-keyboard').onclick=()=>{
 nativeKeyboard=!nativeKeyboard;configureKeyboard();
 if(nativeKeyboard)$('equation').focus({preventScroll:true});else $('equation').blur();
};
// Keep the input selection when tapping a key instead of focusing the button.
$('equation-keys').onpointerdown=e=>{if(e.target.closest('button[data-key]'))e.preventDefault();};
$('equation-keys').onclick=e=>{
 const button=e.target.closest('button[data-key]'),input=$('equation');
 if(!button||input.disabled)return;
 try{
  const edit=editEquation(input.value,input.selectionStart,input.selectionEnd,button.dataset.key,input.maxLength>0?input.maxLength:160);
  input.value=edit.value;input.focus({preventScroll:true});input.setSelectionRange(edit.start,edit.end);input.oninput();
 }catch(error){toast(error.message);}
};

$('fire-form').onsubmit=async e=>{e.preventDefault();if($('fire').disabled)return;try{const shot=getShot(),remaining=state.units.filter(u=>u.alive&&!shot.hits.includes(u.id));let winner='';if(!remaining.some(u=>u.team==='red'))winner='blue';if(!remaining.some(u=>u.team==='blue'))winner=winner?'draw':'red';if(room.shot>=99&&!winner)winner='draw';busy=true;updateControls();apply(await action('fire',{text:$('equation').value,shot:room.shot,seed:room.seed,data:{hits:shot.hits,winner,obstacle:shot.obstacle||undefined}}));$('shot-info').textContent=`Last shot: ${shot.length.toFixed(1)} / ${RANGE} units · ${shot.reason}`;}catch(e){toast(e.message);}finally{busy=false;updateControls();}};
$('chat-form').onsubmit=async e=>{e.preventDefault();try{await action('chat',{text:$('chat').value});$('chat').value='';}catch(e){toast(e.message);}};
$('invite').onclick=async()=>{try{await navigator.clipboard.writeText(`${location.origin}/#${room.id}`);toast('Invite link copied.');}catch{toast(`Invite link: ${location.origin}/#${room.id}`);}};
function exit(){practice=false;cancelAnimation();if(stream){stream.onmessage=null;stream.onerror=null;stream.close();}stream=null;session=null;room=null;state=null;stateKey=null;connected=false;try{sessionStorage.removeItem('fw-session');}catch{}history.replaceState(null,'',location.pathname);$('home').hidden=false;$('room-view').hidden=true;$('connection').textContent='● ONLINE ARENA';rooms();}
function leaveRoom(){
 // Navigate immediately even if the server is unavailable. Capture the leave
 // request before clearing the session so the server can remove membership.
 const leaving=room&&session?action('leave'):Promise.resolve();
 exit();leaving.catch(()=>toast('Returned home. The server could not confirm leaving the room.'));
}
$('leave').onclick=leaveRoom;
$('home-link').onclick=e=>{
 if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||(e.button!==undefined&&e.button!==0))return;
 e.preventDefault();leaveRoom();
};
$('help').onclick=()=>$('help-dialog').showModal();$('close-help').onclick=()=>$('help-dialog').close();
function draw(now=performance.now()){if(!state)return;
 const active=animations[0];
 // Keep a destroyed obstacle visible until the animated shot reaches it.
 const pendingObstacles=new Set(active?room.history.filter(e=>e.kind==='fire').slice(active.shot).map(e=>e.data?.obstacle).filter(Boolean):[]);
 const aliveObstacles=new Set(state.obstacles.map(o=>o.id));
 const visibleObstacles=state.allObstacles.filter(o=>aliveObstacles.has(o.id)||pendingObstacles.has(o.id));
const canvas=$('arena'),width=canvas.clientWidth,height=width*.6,dpr=window.devicePixelRatio||1;canvas.width=width*dpr;canvas.height=height*dpr;const c=canvas.getContext('2d');c.scale(dpr,dpr);const scale=width/40,X=x=>(viewX(x,viewerTeam(room,session.player))+20)*scale,Y=y=>(12-y)*scale;c.clearRect(0,0,width,height);c.lineWidth=1;c.strokeStyle='#dce1d4';for(let x=-20;x<=20;x+=2){c.beginPath();c.moveTo(X(x),0);c.lineTo(X(x),height);c.stroke();}for(let y=-12;y<=12;y+=2){c.beginPath();c.moveTo(0,Y(y));c.lineTo(width,Y(y));c.stroke();}c.strokeStyle='#b3c0aa';c.beginPath();c.moveTo(0,Y(0));c.lineTo(width,Y(0));c.moveTo(X(0),0);c.lineTo(X(0),height);c.stroke();c.fillStyle='#899780';c.font='9px monospace';for(let x=-16;x<20;x+=4)c.fillText(String(viewX(x,viewerTeam(room,session.player))),X(x)+3,Y(0)+12);for(let y=-10;y<=10;y+=2)if(y!==0)c.fillText(String(y),X(0)+4,Y(y)-4);for(const o of visibleObstacles){c.beginPath();c.arc(X(o.x),Y(o.y),o.r*scale,0,2*Math.PI);c.fillStyle='#c7d0bc';c.fill();c.strokeStyle='#aebca2';c.stroke();}
 const history=trajectoryHistory(state.paths,session.player,active?.shot??null);
 const paths=[...history,...(active?state.paths.filter(p=>p.shot===active.shot).map(path=>({path,opacity:1})):[])];
 for(const {path:p,opacity}of paths){
  const isActive=active?.shot===p.shot;
  const length=isActive?(active.started===null?0:(now-active.started)*SHOT_SPEED/1000):Infinity;
  const points=pathAtLength(p.points,p.distances,length);
  c.globalAlpha=opacity;c.strokeStyle=p.team==='red'?'#d75938':'#347e99';c.lineWidth=2;c.beginPath();
  for(const [j,pt]of points.entries())j?c.lineTo(X(pt.x),Y(pt.y)):c.moveTo(X(pt.x),Y(pt.y));c.stroke();c.globalAlpha=1;
  if(isActive&&points.length){const tip=points.at(-1);c.beginPath();c.arc(X(tip.x),Y(tip.y),3.5,0,Math.PI*2);c.fillStyle=c.strokeStyle;c.fill();}
 }
 // Each enemy disappears when the penetrating projectile reaches that hit.
 const fires=room.history.filter(e=>e.kind==='fire');
 const pendingHits=new Set(active?fires.slice(active.shot+1).flatMap(e=>e.data?.hits||[]):[]);
 if(active){
  const path=state.paths.find(p=>p.shot===active.shot),travelled=active.started===null?0:(now-active.started)*SHOT_SPEED/1000;
  for(const id of fires[active.shot]?.data?.hits||[]){const impact=path?.impacts.find(hit=>hit.id===id);if(!impact||travelled<impact.length)pendingHits.add(id);}
 }
 const shooter=shooterFor(state.units,room.turn,room.shot);for(const u of state.units){const x=X(u.x),y=Y(u.y),alive=u.alive||pendingHits.has(u.id);c.globalAlpha=alive?1:.25;c.fillStyle=u.team==='red'?'#d75938':'#347e99';c.beginPath();c.arc(x,y,.55*scale,0,Math.PI*2);c.fill();if(!alive){c.strokeStyle='#1b2a2b';c.beginPath();c.moveTo(x-4,y-4);c.lineTo(x+4,y+4);c.moveTo(x+4,y-4);c.lineTo(x-4,y+4);c.stroke();}if(!active&&room.phase==='playing'&&shooter?.id===u.id){c.beginPath();c.arc(x,y,.85*scale,0,Math.PI*2);c.strokeStyle=c.fillStyle;c.stroke();}c.font='10px monospace';c.textAlign='center';c.fillText(u.name,x,y-1.05*scale);c.textAlign='left';c.globalAlpha=1;}
 if(room.phase==='lobby'){c.fillStyle='#596a52';c.font='16px Georgia';c.textAlign='center';c.fillText('Your next battle starts here.',width/2,height/2);c.textAlign='left';}}
new ResizeObserver(()=>draw()).observe($('arena'));
async function init(){const id=location.hash.slice(1);if(id==='practice'){startPractice('red');return;}if(session&&(!id||id===session.room)){try{history.replaceState(null,'',`#${session.room}`);connect();return;}catch{exit();}}session=null;await rooms();if(/^[0-9a-f]{8}$/.test(id))joinPrompt(id);else if(id)history.replaceState(null,'',location.pathname);}
window.addEventListener('hashchange',()=>{const id=location.hash.slice(1);if(id==='practice'){if(!practice)startPractice('red');return;}if(id&&id!==room?.id)joinPrompt(id);});setInterval(()=>{if(!room)rooms();},15000);init();
