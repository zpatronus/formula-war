import {test} from 'node:test';
import assert from 'node:assert/strict';

test('practice stays local and the home logo leaves practice and multiplayer',async()=>{
 const elements=new Map(),frames=new Map();let frameID=0,requests=0;
 const labels=[],historyStrokes=[];const ctx=new Proxy({}, {get:(target,key)=>{
  if(key==='fillText')return (text,x,y)=>labels.push({text,x,y});
  if(key==='clearRect')return ()=>{historyStrokes.length=0;};
  if(key==='stroke')return ()=>{if([.04,.09,.18].includes(target.globalAlpha))historyStrokes.push(target.globalAlpha);};
  return target[key]??(()=>{});
 }});
 const element=id=>{if(!elements.has(id))elements.set(id,{id,value:'',hidden:false,disabled:false,textContent:'',innerHTML:'',clientWidth:800,clientHeight:100,scrollHeight:100,scrollTop:0,classList:{toggle(){}},getContext:()=>ctx,focus(){},showModal(){},close(){}});return elements.get(id);};
 globalThis.document={getElementById:element};
 globalThis.localStorage={getItem:()=>null,setItem(){}};
 const saved=new Map();globalThis.sessionStorage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)};
 globalThis.location={hash:'',pathname:'/',origin:'http://localhost:8080'};
 globalThis.history={replaceState(){}};
 globalThis.window={devicePixelRatio:1,addEventListener(){}};
 globalThis.ResizeObserver=class{observe(){}};
 globalThis.requestAnimationFrame=callback=>{const id=++frameID;frames.set(id,callback);return id;};
 globalThis.cancelAnimationFrame=id=>frames.delete(id);
 globalThis.setInterval=()=>0;globalThis.setTimeout=()=>0;globalThis.clearTimeout=()=>{};
 globalThis.fetch=async()=>{requests++;return {ok:true,json:async()=>[]};};
 await import('./app.mjs');await new Promise(resolve=>setImmediate(resolve));
 const initialRequests=requests;
 element('training').onclick();
 assert.equal(requests,initialRequests);assert.equal(element('invite').hidden,true);
 assert.ok(labels.some(p=>p.text==='10'&&p.x===404),'vertical axis must have coordinate labels');assert.ok(labels.findLast(p=>p.text==='You').x<400);assert.ok(labels.findLast(p=>p.text==='Target 1').x>400);
 assert.equal(element('phase-label').textContent,'Practice · shot 1');assert.equal(element('fire').disabled,false);
 element('equation').value='-8(1+e^(-3(x+15)))+10(1+e^(-3(x-15.3)))';
 await element('fire-form').onsubmit({preventDefault(){}});
 assert.equal(element('phase-label').textContent,'Practice · shot 1');assert.equal(element('fire').disabled,false);
 assert.match(element('toast').textContent,/No turn was used/);assert.equal(frames.size,0);
 element('equation').value='0';
 async function fire(){await element('fire-form').onsubmit({preventDefault(){}});assert.equal(element('fire').disabled,true);const callbacks=[...frames.values()];frames.clear();for(const cb of callbacks)cb(0);const finish=[...frames.values()];frames.clear();for(const cb of finish)cb(5000);assert.equal(element('fire').disabled,false);assert.equal(frames.size,0,'completed history should stay visible without a fading timer');}
 await fire();assert.equal(element('phase-label').textContent,'Practice · shot 2');
 await fire();assert.equal(element('phase-label').textContent,'Practice · shot 3');
 assert.deepEqual(historyStrokes,[.09,.18]);
 await fire();await fire();assert.equal(element('phase-label').textContent,'Practice · shot 5');
 assert.deepEqual(historyStrokes,[.04,.09,.18],'only three history lines, older lines fainter');
 element('practice-side').onclick();assert.match(element('turn-label').textContent,/blue side/);
 assert.ok(labels.some(p=>p.text==='10'&&p.x===404),'vertical axis must have coordinate labels');assert.ok(labels.findLast(p=>p.text==='You').x<400);assert.ok(labels.findLast(p=>p.text==='Target 1').x>400);
 assert.match(element('arena-note').textContent,/\(-[0-9]/);
 await fire();assert.equal(element('phase-label').textContent,'Practice · shot 2');
 element('practice-reset').onclick();assert.equal(element('phase-label').textContent,'Practice · shot 1');
 assert.equal(requests,initialRequests,'training made network requests');
 let prevented=false;
 element('home-link').onclick({ctrlKey:true,preventDefault(){prevented=true;}});
 assert.equal(prevented,false);assert.equal(element('room-view').hidden,false);
 element('home-link').onclick({preventDefault(){prevented=true;}});
 assert.equal(prevented,true);assert.equal(element('home').hidden,false);assert.equal(element('room-view').hidden,true);
 assert.equal(frames.size,0);
 await new Promise(resolve=>setImmediate(resolve));
 const liveRoom={id:'12345678',name:'Friends',host:'p1',created:new Date().toISOString(),players:[{id:'p1',name:'You',team:'watch'}],roster:[],history:[],seed:'',phase:'lobby',shot:0,turn:''};
 let source,leaveBody,finishLeave;
 globalThis.EventSource=class{constructor(){source=this;}close(){this.closed=true;}};
 globalThis.fetch=async(path,options)=>{
  if(path.endsWith('/leave')){leaveBody=JSON.parse(options.body);return new Promise(resolve=>{finishLeave=()=>resolve({ok:true,json:async()=>liveRoom});});}
  return {ok:true,json:async()=>options?.method==='POST'?{room:liveRoom,token:'secret',player:'p1'}:[]};
 };
 element('name').value='You';element('room-name').value='Friends';
 await element('entry-form').onsubmit({preventDefault(){},submitter:{disabled:false}});
 assert.ok(saved.has('fw-session'));assert.equal(element('room-view').hidden,false);
 liveRoom.phase='playing';liveRoom.turn='blue';liveRoom.seed='coordinates';
 liveRoom.players=[{id:'p1',name:'You',team:'red'},{id:'p2',name:'Opponent',team:'blue'}];liveRoom.roster=liveRoom.players;
 source.onmessage({data:JSON.stringify(liveRoom)});
 assert.equal(element('arena-note').textContent,'Opponent is aiming','opponent coordinates should not be shown');
 liveRoom.turn='red';source.onmessage({data:JSON.stringify(liveRoom)});
 assert.match(element('arena-note').textContent,/You is aiming · \(-[0-9]/);
 
 element('home-link').onclick({preventDefault(){}});
 assert.equal(element('home').hidden,false);assert.equal(element('room-view').hidden,true);
 assert.equal(saved.has('fw-session'),false);assert.equal(source.closed,true);assert.equal(source.onmessage,null);
 assert.equal(leaveBody.token,'secret');assert.equal(typeof finishLeave,'function');
 finishLeave();await new Promise(resolve=>setImmediate(resolve));

});
