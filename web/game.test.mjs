import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parse,evaluate,interval,trace,board,reconstruct,worldEquation,viewX,viewerTeam,equationForView,anchorEquation} from './game.mjs';
const calc=s=>evaluate(parse(s),2);
const shooter={id:'a',team:'red',x:-19,y:0,alive:true};
const shoot=(s,budget=60)=>trace(parse(s),shooter,[shooter],[],budget);
test('operators, associativity, precedence and functions',()=>{
 assert.equal(calc('2^3^2'),512);assert.equal(calc('-2^2'),-4);assert.equal(calc('2^-2'),.25);assert.equal(calc('(2+3)*4/2-1'),9);
 for(const name of ['sin','cos','tan','exp','ln','sqrt','abs'])assert.equal(calc(`${name}(x)`),(name==='ln'?Math.log:Math[name])(2));
 assert.equal(calc('sqrt(abs(-9))'),3);assert.equal(calc('ln(e)'),1);assert.equal(calc('1e-3*x'),.002);
 for(const s of ['alert(1)','x.constructor','2 3','1.2.3','sin x','x+','(x','1;2',''])assert.throws(()=>parse(s));
});
test('domain checks find gaps between finite endpoints',()=>{
 for(const [s,a,b] of [['1/(x-1)',0,2],['tan(x)',1,2],['ln(x)',-1,2],['sqrt(x)',-1,2],['1/(x-1)^2',0,2]])assert.ok(interval(parse(s),a,b).some(Number.isNaN),s);
 assert.deepEqual(interval(parse('sin(x)'),0,2*Math.PI),[-1,1]);
});
test('invalid origin never consumes a shot',()=>{for(const s of ['1/x','ln(x)','sqrt(-1)','exp(1000)','0/0'])assert.throws(()=>trace(parse(s),{...shooter,x:0},[],[]));});
test('arc length caps steep and oscillating shots',()=>{
 for(const s of ['0','x','10*x','sin(10*x)','sin(10000*x)']){const r=shoot(s,5);assert.ok(r.length<=5+1e-8,s);assert.ok(r.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)),s);}
 const r=shoot('sin(10*x)',5);assert.equal(r.reason,'range limit');assert.ok(r.points.at(-1).x-shooter.x<2);
});
test('holes are not bridged and poles do not connect',()=>{
 const r=trace(parse('sqrt((x-1)*(x-2))'),{...shooter,x:0},[],[]);assert.ok(r.points.at(-1).x<=1.000001);
 const t=trace(parse('tan(x)'),{...shooter,x:0},[],[]);assert.ok(t.points.at(-1).x<Math.PI/2);
});
test('obstacles stop paths, enemies are penetrated, blue travels left',()=>{
 const target={id:'b',team:'blue',x:-15,y:0,alive:true};let r=trace(parse('0'),shooter,[shooter,target],[]);assert.deepEqual(r.hits,['b']);assert.equal(r.reason,'edge of arena');assert.ok(r.points.at(-1).x>target.x);
 r=trace(parse('0'),shooter,[shooter,target],[{x:-17,y:0,r:.8}]);assert.equal(r.reason,'obstacle');assert.deepEqual(r.hits,[]);
 r=trace(parse('0'),{...shooter,team:'blue',x:19},[],[],3);assert.ok(Math.abs(r.points.at(-1).x-16)<1e-8);
});
test('seeded arena and match roster survive spectator joins and departures',()=>{
 const room={seed:'seed',players:[shooter,{id:'b',team:'blue'}],history:[]};room.roster=[...room.players];const before=board(room);room.players=[{id:'spectator',team:'watch'}];assert.deepEqual(board(room),before);assert.deepEqual(reconstruct(room).units,before.units);
});

test('code injection syntax is rejected without executing it',()=>{
 globalThis.__fwInjected=false;
 const payloads=[
  'globalThis.__fwInjected=true',
  'sin.constructor("globalThis.__fwInjected=true")()',
  'constructor.constructor("alert(1)")()',
  'x["constructor"]', '(()=>{alert(1)})()',
  'sin(x);alert(1)', '${alert(1)}', '`alert(1)`',
  '<img src=x onerror=alert(1)>', '</script><script>alert(1)</script>',
  'fetch("https://example.com")', 'import("data:text/javascript,alert(1)")',
  'x=1', 'x||alert(1)', 'window.location', '__proto__',
 ];
 for(const payload of payloads)assert.throws(()=>parse(payload),payload);
 assert.equal(globalThis.__fwInjected,false);delete globalThis.__fwInjected;
});

test('HTML and attribute payloads are escaped for names, chat, equations',async()=>{
 const {escapeHTML}=await import('./ui.mjs');
 assert.equal(escapeHTML('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
 assert.equal(escapeHTML("' onclick='alert(1)"),'&#39; onclick=&#39;alert(1)');
 for(const payload of ['</code><svg onload=alert(1)>','<script>alert(1)</script>','&lt;img src=x onerror=alert(1)&gt;']){
  const escaped=escapeHTML(payload);assert.ok(!/[<>"']/.test(escaped));
 }
});

test('animation advances by arc length across uneven, vertical and reversed segments',async()=>{
 const {measurePath,pathAtLength}=await import('./game.mjs');
 const points=[{x:0,y:0},{x:3,y:4},{x:3,y:14},{x:-1,y:14}];
 const distances=measurePath(points);assert.deepEqual(distances,[0,5,15,19]);
 assert.deepEqual(pathAtLength(points,distances,2.5).at(-1),{x:1.5,y:2});
 assert.deepEqual(pathAtLength(points,distances,10).at(-1),{x:3,y:9});
 assert.deepEqual(pathAtLength(points,distances,17).at(-1),{x:1,y:14});
 for(const length of [0,1,2.5,5,9,15,18,19]){
  const visible=pathAtLength(points,distances,length);
  assert.ok(Math.abs(measurePath(visible).at(-1)-length)<1e-10);
 }
 assert.deepEqual(pathAtLength(points,distances,100),points);
 assert.deepEqual(pathAtLength([],[],10),[]);
 assert.deepEqual(pathAtLength([{x:1,y:2}],[0],5),[{x:1,y:2}]);
 const repeats=[{x:0,y:0},{x:0,y:0},{x:0,y:2}];
 assert.deepEqual(pathAtLength(repeats,measurePath(repeats),1).at(-1),{x:0,y:1});
});

test('both teams evaluate exponentials in arena coordinates with a vertical anchor',()=>{
 const red={...shooter,x:-16,y:3},blue={...red,team:'blue',x:16};
 for(const formula of ['e^x','exp(x)','e^x+7']){
  const left=trace(parse(formula),red,[red],[],30),right=trace(parse(formula),blue,[blue],[],30);
  assert.deepEqual(right.points[0],{x:16,y:3});assert.equal(left.points.length,right.points.length);
  for(let i=1;i<right.points.length;i++){
   const p=right.points[i];assert.ok(p.x<right.points[i-1].x);
   assert.ok(Math.abs(p.y-(blue.y+Math.exp(-p.x)-Math.exp(-16)))<.002);
   assert.ok(p.y>=right.points[i-1].y-1e-10);
   assert.ok(Math.abs(p.x+left.points[i].x)<1e-9);assert.ok(Math.abs(p.y-left.points[i].y)<1e-9);
  }
  assert.ok(right.points.at(-1).y>blue.y+1);
 }
});
test('blue domain checks use reflected arena intervals',()=>{
 const blue={...shooter,team:'blue',x:16,y:0};
 const path=trace(parse('sqrt((x+15)*(x+14))'),blue,[blue],[],10);
 assert.ok(path.points.at(-1).x>=15-1e-6);assert.ok(path.points.at(-1).x<15.01);
 assert.match(path.reason,/undefined|precision/);
 const tangent=trace(parse('tan(x)'),blue,[blue],[],60);
 assert.ok(tangent.points.at(-1).x>9*Math.PI/2);
 const squareRoot=trace(parse('sqrt(-x)'),blue,[blue],[],3);
 assert.ok(squareRoot.points.at(-1).y<0);
});

test('default shot range allows 600 units of winding curve on either side',()=>{
 for(const team of ['red','blue']){
  const unit={...shooter,team,x:team==='red'?-19:19};
  const long=trace(parse('sin(30*x)'),unit,[unit],[]);
  const short=trace(parse('sin(10*x)'),unit,[unit],[],60);
  assert.equal(long.reason,'range limit');assert.ok(Math.abs(long.length-600)<1e-8);
  assert.ok(long.length>short.length*9.9);
 }
});

test('implicit multiplication preserves powers, function calls and operator precedence',()=>{
 for(const [implicit,explicit] of [
  ['3x','3*x'],['3x^2','3*x^2'],['3sin(5x)','3*sin(5*x)'],
  ['(x+1)(x-1)','(x+1)*(x-1)'],['2(x+1)','2*(x+1)'],
  ['2pi','2*pi'],['2e^x','2*e^x'],['sin(x)cos(x)','sin(x)*cos(x)'],
  ['-3x^2','-3*x^2'],['2/x(x+1)','2/x*(x+1)'],['1/(2x)','1/(2*x)'],
  ['1e-3x','1e-3*x'],['3sqrt(abs(2x))','3*sqrt(abs(2*x))'],
 ]){
  assert.deepEqual(parse(implicit),parse(explicit),implicit);
  assert.equal(calc(implicit),calc(explicit),implicit);
 }
 for(const s of ['3alert(1)','2window','3sin.constructor(1)','2[alert(1)]','2 3','2..3','sin x'])assert.throws(()=>parse(s));
});

test('visible arena-coordinate parabola rises toward zero then falls, on either team',()=>{
 const paths=[];
 for(const team of ['red','blue']){
  const unit={...shooter,team,x:team==='red'?-16:16};
  const path=trace(parse('-0.03x^2'),unit,[unit],[]);paths.push(path);
  const peak=path.points.reduce((a,b)=>a.y>b.y?a:b);
  assert.ok(Math.abs(peak.x)<.02);assert.ok(peak.y>7.67);
  assert.ok(path.points[1].y>0);assert.ok(path.points.at(-1).y<peak.y-5);
  for(const p of path.points)assert.ok(Math.abs(p.y-(.03*(256-p.x*p.x)))<.002);
  assert.ok(path.points.at(-1).x*(team==='red'?1:-1)>0);
 }
 assert.equal(paths[0].points.length,paths[1].points.length);
 for(let i=0;i<paths[0].points.length;i++){
  assert.ok(Math.abs(paths[0].points[i].x+paths[1].points[i].x)<1e-9);
  assert.ok(Math.abs(paths[0].points[i].y-paths[1].points[i].y)<1e-9);
 }
});
test('both teams see themselves left, while every world object and shot reflects consistently',()=>{
 const room={players:[{id:'r',team:'red'},{id:'b',team:'blue'},{id:'s',team:'watch'}]};
 assert.equal(viewerTeam(room,'r'),'red');assert.equal(viewerTeam(room,'b'),'blue');assert.equal(viewerTeam(room,'s'),'red');
 assert.equal(viewX(-16,viewerTeam(room,'r')),-16);assert.equal(viewX(16,viewerTeam(room,'b')),-16);
 for(const x of [-20,-16,-1,0,3,16,20])assert.equal(viewX(x,'blue'),-viewX(x,'red'));
 const source=parse('3sin(5x)+x^3+exp(x)');const original=JSON.stringify(source);
 const reflected=worldEquation(source,'blue');
 for(const x of [-16,-3,0,2])assert.equal(evaluate(reflected,x),evaluate(source,-x));
 assert.equal(JSON.stringify(source),original,'reflection mutated source AST');
 for(const sourceTeam of ['red','blue'])for(const view of ['red','blue']){
  const displayed=equationForView('3sin(5x)+x^3+exp(x)',sourceTeam,view);
  for(const x of [-2,0,2])assert.equal(evaluate(parse(displayed),x),evaluate(source,sourceTeam===view?x:-x));
 }
});
test('undefined start depends on shooter coordinates; origin gaps still stop traversal',()=>{
 assert.doesNotThrow(()=>trace(parse('1/x'),shooter,[shooter],[],1));
 const path=trace(parse('1/x'),{...shooter,x:-1},[],[],600);
 assert.ok(path.points.at(-1).x<0);
 for(const team of ['red','blue']){
  const unit={...shooter,team,x:team==='red'?-16:16};
  assert.throws(()=>trace(parse('ln(x)'),unit,[],[]),/starting x = -16/);
 }
});

test('shots terminate at all visible edges and cannot return or hit an offscreen unit',()=>{
 for(const team of ['red','blue'])for(const formula of ['-x^2','x^2','0']){
  const unit={...shooter,team,x:team==='red'?-16:16};
  const outside={id:'outside',team:team==='red'?'blue':'red',alive:true,x:0,y:256};
  const path=trace(parse(formula),unit,[unit,outside],[]);
  assert.equal(path.reason,'edge of arena');assert.deepEqual(path.hits,[]);
  for(const p of path.points){assert.ok(Math.abs(p.x)<=20+1e-10);assert.ok(Math.abs(p.y)<=12+1e-10);}
  const end=path.points.at(-1);
  if(formula==='-x^2'){assert.ok(Math.abs(end.y-12)<1e-10);assert.ok(Math.abs(end.x)>15);}
  else if(formula==='x^2')assert.ok(Math.abs(end.y+12)<1e-10);
  else assert.ok(Math.abs(Math.abs(end.x)-20)<1e-10);
 }
});

test('one shot penetrates multiple enemies once each, ignores allies, and stops at obstacles',()=>{
 for(const team of ['red','blue']){
  const sign=team==='red'?1:-1,unit={...shooter,team,x:-19*sign};
  const enemy=team==='red'?'blue':'red';
  const units=[unit,{id:'first',team:enemy,x:-15*sign,y:0,alive:true},{id:'ally',team,x:-12*sign,y:0,alive:true},{id:'second',team:enemy,x:-10*sign,y:0,alive:true},{id:'third',team:enemy,x:-5*sign,y:0,alive:true}];
  const path=trace(parse('0'),unit,units,[]);
  assert.deepEqual(path.hits,['first','second','third']);assert.equal(path.reason,'edge of arena');
  assert.deepEqual(path.impacts.map(i=>i.id),path.hits);
  assert.ok(path.impacts[0].length<path.impacts[1].length);assert.ok(path.impacts[1].length<path.impacts[2].length);
  const blocked=trace(parse('0'),unit,units,[{x:-7*sign,y:0,r:1}]);
  assert.deepEqual(blocked.hits,['first','second']);assert.equal(blocked.reason,'obstacle');
  assert.ok(units.every(u=>u.alive),'trace should not mutate shared units');
 }
});

test('huge exponential transitions exceed resolution, reciprocal sigmoid transitions trace normally',()=>{
 for(const team of ['red','blue']){
  const unit={...shooter,team,x:team==='red'?-16:16};
  const unscaled=trace(parse('-8(1+e^(-3(x+15)))+10(1+e^(-3(x-15.3)))'),unit,[unit],[]);
  assert.equal(unscaled.length,0);assert.match(unscaled.reason,/precision/);
  const sigmoid=trace(parse('-8/(1+e^(-3(x+15)))+10/(1+e^(-3(x-15.3)))'),unit,[unit],[]);
  assert.ok(sigmoid.length>35);assert.equal(sigmoid.reason,'edge of arena');
  assert.ok(sigmoid.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
 }
});

test('denser seeded middle and wider player zones stay inside the arena and separate',()=>{
 let minY=Infinity,maxY=-Infinity,minX=Infinity,maxX=-Infinity;
 for(let seed=0;seed<100;seed++){
  const room={seed:`layout-${seed}`,players:[{id:'r',team:'red'},{id:'b',team:'blue'}]};
  const state=board(room);assert.deepEqual(board(room),state);assert.ok(state.obstacles.some(o=>Math.abs(o.y)>1.2&&Math.abs(o.y-7)>1.2&&Math.abs(o.y+7)>1.2),'obstacles should not be confined to the old three rows');assert.equal(state.obstacles.length,15);assert.equal(new Set(state.obstacles.map(o=>o.id)).size,15);
  for(const u of state.units){assert.ok(Math.abs(u.x)>=13&&Math.abs(u.x)<=18);assert.ok(Math.abs(u.y)<=10);minY=Math.min(minY,u.y);maxY=Math.max(maxY,u.y);minX=Math.min(minX,Math.abs(u.x));maxX=Math.max(maxX,Math.abs(u.x));}
  for(let i=0;i<state.obstacles.length;i++)for(let j=i+1;j<state.obstacles.length;j++){const a=state.obstacles[i],b=state.obstacles[j];assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=a.r+b.r+.35-1e-10);}
  for(const o of state.obstacles){assert.ok(o.r>=1.1&&o.r<=2);assert.ok(Math.abs(o.x)+o.r<12);assert.ok(Math.abs(o.y)+o.r<12);for(const u of state.units)assert.ok(Math.hypot(u.x-o.x,u.y-o.y)>o.r+.55);}
 }
 assert.ok(minY<-9&&maxY>9);assert.ok(minX<13.5&&maxX>17.5);
 const team=board({seed:'four',players:Array.from({length:4},(_,i)=>({id:`r${i}`,team:'red'}))}).units;
 for(let i=0;i<team.length;i++)for(let j=i+1;j<team.length;j++)assert.ok(Math.hypot(team[i].x-team[j].x,team[i].y-team[j].y)>1.1);
});

test('client replay restores destroyed obstacles and recalculates later shots through the gap',()=>{
 const room={seed:'destruction',players:[{id:'r',name:'Red',team:'red'},{id:'b',name:'Blue',team:'blue'}],firstTurn:'red',history:[]};room.roster=room.players;
 const initial=board(room),unit=initial.units[0],target=initial.obstacles[5];
 const formula=`${(target.y-unit.y)/(target.x-unit.x)}x`;
 const first=trace(parse(formula),unit,initial.units,initial.obstacles);
 assert.equal(first.reason,'obstacle');assert.ok(first.obstacle);
 room.history.push({kind:'fire',player:unit.id,text:formula,data:{hits:first.hits,obstacle:first.obstacle}});
 const after=reconstruct(room);assert.equal(after.obstacles.length,14);assert.ok(!after.obstacles.some(o=>o.id===first.obstacle));
 assert.deepEqual(after.paths[0].points,first.points);
 const second=trace(parse(formula),unit,after.units,after.obstacles);
 assert.ok(second.length>first.length);assert.notEqual(second.obstacle,first.obstacle);
 room.history.push({kind:'fire',player:unit.id,text:formula,data:{hits:second.hits,obstacle:second.obstacle}});
 const rejoined=reconstruct(JSON.parse(JSON.stringify(room)));
 assert.deepEqual(rejoined,reconstruct(room));assert.deepEqual(rejoined.paths[1].points,second.points);
 assert.equal(initial.obstacles.length,15,'replay must not mutate original arena');
});

test('displayed constant shares the shot anchor and respects blue coordinates',()=>{
 for(const team of ['red','blue']){
  const unit={...shooter,team,x:team==='red'?-10:10,y:3};
  assert.equal(anchorEquation(parse('-x^2'),unit).constant,103);
  assert.equal(anchorEquation(parse('3x'),unit).constant,33);
  assert.equal(anchorEquation(parse('3x+7'),unit).constant,26);
  assert.throws(()=>anchorEquation(parse('ln(x)'),unit));
 }
});
