export const RANGE = 600;
const functions = new Set(['sin','cos','tan','exp','ln','sqrt','abs']);
export function parse(source) {
 if(source.length>160) throw Error('Use at most 160 characters.');
 const tokens=source.toLowerCase().match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-z]+|[^\s]/g)||[];
 let i=0;
 function expr(min=0){
  let t=tokens[i++],node;
  if(t==='+'||t==='-') node={op:t==='-'?'neg':'pos',a:expr(25)};
  else if(t==='('){node=expr();if(tokens[i++]!==')')throw Error('Missing closing parenthesis.');}
  else if(t==='x')node={op:'x'};
  else if(t==='pi'||t==='e')node={op:'num',v:t==='pi'?Math.PI:Math.E};
  else if(functions.has(t)){if(tokens[i++]!=='(')throw Error('Functions need parentheses, e.g. sin(x).');node={op:t,a:expr()};if(tokens[i++]!==')')throw Error('Missing closing parenthesis.');}
  else if(t&&/^(?:\d|\.)/.test(t)&&Number.isFinite(Number(t)))node={op:'num',v:Number(t)};
  else throw Error('Expected a number, x, or a supported function.');
  while(i<tokens.length){
   const next=tokens[i],numeric=t=>t&&/^(?:\d|\.)/.test(t)&&Number.isFinite(Number(t));
   // Adjacent factors multiply, but adjacent numeric literals remain invalid.
   const implicit=next==='('||next==='x'||next==='pi'||next==='e'||functions.has(next)||(numeric(next)&&!numeric(tokens[i-1]));
   const op=implicit?'*':next,p={'+':10,'-':10,'*':20,'/':20,'^':30}[op];
   if(p===undefined||p<min)break;
   if(!implicit)i++;
   node={op,a:node,b:expr(op==='^'?p:p+1)};
  }
  return node;
 }
 const ast=expr();if(i!==tokens.length)throw Error('Unexpected token in equation.');return ast;
}
export function evaluate(n,x){let a=n.a?evaluate(n.a,x):0,b=n.b?evaluate(n.b,x):0;switch(n.op){case 'num':return n.v;case 'x':return x;case 'pos':return a;case 'neg':return -a;case '+':return a+b;case '-':return a-b;case '*':return a*b;case '/':return b===0?NaN:a/b;case '^':return Math.pow(a,b);case 'ln':return Math.log(a);case 'sqrt':return Math.sqrt(a);case 'abs':return Math.abs(a);case 'sin':return Math.sin(a);case 'cos':return Math.cos(a);case 'tan':return Math.tan(a);case 'exp':return Math.exp(a);default:return NaN;}}
const BAD=[NaN,NaN];
// Conservative interval bounds detect domain gaps BETWEEN samples, including poles.
export function interval(n,lo,hi){
 if(n.op==='x')return [lo,hi];if(n.op==='num')return [n.v,n.v];
 const a=interval(n.a,lo,hi),b=n.b?interval(n.b,lo,hi):null;
 if(!a.every(Number.isFinite)||(b&&!b.every(Number.isFinite)))return BAD;
 const [l,h]=a;let out;
 switch(n.op){
 case 'pos':return a;case 'neg':return [-h,-l];case '+':out=[l+b[0],h+b[1]];break;case '-':out=[l-b[1],h-b[0]];break;
 case '*':{let v=[l*b[0],l*b[1],h*b[0],h*b[1]];out=[Math.min(...v),Math.max(...v)];break;}
 case '/':{if(b[0]<=0&&b[1]>=0)return BAD;let v=[l/b[0],l/b[1],h/b[0],h/b[1]];out=[Math.min(...v),Math.max(...v)];break;}
 case 'sqrt':if(l<0)return BAD;out=[Math.sqrt(l),Math.sqrt(h)];break;
 case 'ln':if(l<=0)return BAD;out=[Math.log(l),Math.log(h)];break;
 case 'exp':out=[Math.exp(l),Math.exp(h)];break;
 case 'abs':out=[l<=0&&h>=0?0:Math.min(Math.abs(l),Math.abs(h)),Math.max(Math.abs(l),Math.abs(h))];break;
 case 'sin':case 'cos':{if(h-l>=2*Math.PI)return [-1,1];const shift=n.op==='cos'?Math.PI/2:0;const ll=l+shift,hh=h+shift;out=[Math.min(Math.sin(ll),Math.sin(hh)),Math.max(Math.sin(ll),Math.sin(hh))];if(Math.ceil((ll-Math.PI/2)/(2*Math.PI))<=Math.floor((hh-Math.PI/2)/(2*Math.PI)))out[1]=1;if(Math.ceil((ll+Math.PI/2)/(2*Math.PI))<=Math.floor((hh+Math.PI/2)/(2*Math.PI)))out[0]=-1;break;}
 case 'tan':if(Math.ceil((l-Math.PI/2)/Math.PI)<=Math.floor((h-Math.PI/2)/Math.PI))return BAD;out=[Math.tan(l),Math.tan(h)];break;
 case '^':{
  if(b[0]===b[1]&&Number.isInteger(b[0])){const p=b[0];if(p<=0&&l<=0&&h>=0)return BAD;const v=[Math.pow(l,p),Math.pow(h,p)];out=[p>0&&p%2===0&&l<=0&&h>=0?0:Math.min(...v),Math.max(...v)];}
  else {if(l<0||(l===0&&b[0]<=0))return BAD;const v=[Math.pow(l,b[0]),Math.pow(l,b[1]),Math.pow(h,b[0]),Math.pow(h,b[1])];out=[Math.min(...v),Math.max(...v)];if(l<=1&&h>=1){out[0]=Math.min(out[0],1);out[1]=Math.max(out[1],1);}}
  break;
 }
 default:return BAD;
 }
 return out.every(Number.isFinite)?out:BAD;
}
export function board(room){
 let seed=2166136261;for(const c of room.seed||'preview'){seed=Math.imul(seed^c.charCodeAt(0),16777619)>>>0;}
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const units=[];for(const team of ['red','blue']){const ps=(room.roster?.length?room.roster:room.players).filter(p=>p.team===team);ps.forEach((p,i)=>units.push({...p,x:(team==='red'?-1:1)*(14+random()*3),y:ps.length===1?(random()-.5)*10:-8+i*16/(ps.length-1)+(random()-.5),alive:true}));}
 const obstacles=Array.from({length:5},(_,i)=>({x:-7+i*3.5+(random()-.5),y:(random()-.5)*15,r:.8+random()*.9}));return {units,obstacles};
}
export function shooterFor(units,team,shot){const alive=units.filter(u=>u.team===team&&u.alive);return alive[Math.floor(shot/2)%alive.length];}
function distance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
// Reflect x nodes in the parsed math tree; never rewrite or execute source text.
export function worldEquation(ast,team){
 if(team!=='blue')return ast;
 function reflect(node){
  if(node.op==='x')return {op:'neg',a:{op:'x'}};
  return {...node,...(node.a?{a:reflect(node.a)}:{}),...(node.b?{b:reflect(node.b)}:{})};
 }
 return reflect(ast);
}
export function viewX(x,team){return team==='blue'?-x:x;}
export function viewerTeam(room,player){const team=room.players.find(p=>p.id===player)?.team;return team==='blue'?'blue':'red';}
// Display opponents’ formulas in the observer’s coordinates; rendering still escapes text.
export function equationForView(source,team,view){
 return team===view?source:source.replace(/[a-z]+/gi,name=>name.toLowerCase()==='x'?'(-x)':name);
}
export function trace(ast,shooter,units,obstacles,budget=RANGE){
 ast=worldEquation(ast,shooter.team);
 const origin=evaluate(ast,shooter.x);if(!Number.isFinite(origin)||!interval(ast,shooter.x,shooter.x).every(Number.isFinite))throw Error(`Equation is undefined at your starting x = ${viewX(shooter.x,shooter.team).toFixed(2)}. Shift it or choose a different equation.`);
 const direction=shooter.team==='red'?1:-1,points=[{x:shooter.x,y:shooter.y}],hits=new Set(),impacts=[];let x=0,length=0,reason='precision limit',iterations=0;
 while(iterations++<24000){
  let step=.04,accepted=false,next;
  for(let k=0;k<18;k++){
   // Evaluate arena x in the shooter’s coordinate view, with only a vertical offset.
   const from=shooter.x+direction*x,to=shooter.x+direction*(x+step);
   const bounds=interval(ast,Math.min(from,to),Math.max(from,to)),mid=evaluate(ast,shooter.x+direction*(x+step/2))-origin+shooter.y,y=evaluate(ast,to)-origin+shooter.y;
   next={x:shooter.x+direction*(x+step),y};const last=points.at(-1),segment=Math.hypot(next.x-last.x,y-last.y);
   // Bound variation as well as midpoint error: prevents high-frequency aliasing.
   if(bounds.every(Number.isFinite)&&Number.isFinite(y)&&segment<=.1&&bounds[1]-bounds[0]<=.1&&Math.abs(mid-(last.y+y)/2)<.002){accepted=true;break;}step/=2;
  }
  if(!accepted){reason='undefined region or precision limit';break;}
  const last=points.at(-1);let segment=Math.hypot(next.x-last.x,next.y-last.y);
  if(length+segment>budget){const t=(budget-length)/segment;next={x:last.x+(next.x-last.x)*t,y:last.y+(next.y-last.y)*t};segment=budget-length;reason='range limit';}
  // Clip to the first visible boundary before collision testing or animation.
  let boundary=false,t=1;
  if(next.x>=20){t=Math.min(t,(20-last.x)/(next.x-last.x));boundary=true;}
  if(next.x<=-20){t=Math.min(t,(-20-last.x)/(next.x-last.x));boundary=true;}
  if(next.y>=12){t=Math.min(t,(12-last.y)/(next.y-last.y));boundary=true;}
  if(next.y<=-12){t=Math.min(t,(-12-last.y)/(next.y-last.y));boundary=true;}
  if(boundary){next={x:last.x+(next.x-last.x)*t,y:last.y+(next.y-last.y)*t};segment*=t;}
  let collision=null;
  // Segments are at most 0.1 units; collision radii are larger than sample spacing.
  for(const o of obstacles){if(distance(o,last,next)<=o.r){collision='obstacle';break;}}
  if(!collision)for(const u of units){
   if(u.alive&&u.team!==shooter.team&&!hits.has(u.id)&&distance(u,last,next)<=.55){
    hits.add(u.id);impacts.push({id:u.id,length:length+segment});
   }
  }
  points.push(next);length+=segment;x+=step;
  if(collision){reason=collision;break;}
  if(boundary){reason='edge of arena';break;}
  if(length>=budget-1e-9){reason='range limit';break;}
 }
 return {points,length,reason,hits:[...hits],impacts};
}
export function reconstruct(room){const state=board(room);state.paths=[];let shot=0;for(const e of room.history||[]){if(e.kind!=='fire')continue;const shooter=state.units.find(u=>u.id===e.player&&u.alive)||shooterFor(state.units,shot%2===0?(room.firstTurn||'red'):(room.firstTurn==='blue'?'red':'blue'),shot);if(shooter){try{const path=trace(parse(e.text),shooter,state.units,state.obstacles);state.paths.push({...path,team:shooter.team,shot,distances:measurePath(path.points)});}catch{}}for(const id of e.data?.hits||[]){const u=state.units.find(u=>u.id===id);if(u)u.alive=false;}shot++;}return state;}

// Cumulative Euclidean distances allow animation independent of x or sample density.
export function measurePath(points) {
 const distances=[0];
 for(let i=1;i<points.length;i++) distances.push(distances[i-1]+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));
 return distances;
}
export function pathAtLength(points,distances,length) {
 if(!points.length)return [];
 if(length<=0)return [points[0]];
 if(length>=distances.at(-1))return points;
 let lo=1,hi=points.length-1;
 while(lo<hi){const mid=(lo+hi)>>1;if(distances[mid]<length)lo=mid+1;else hi=mid;}
 const a=points[lo-1],b=points[lo],span=distances[lo]-distances[lo-1],t=span?(length-distances[lo-1])/span:0;
 return [...points.slice(0,lo),{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}];
}
