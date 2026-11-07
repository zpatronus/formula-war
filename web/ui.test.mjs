import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {editEquation,trajectoryHistory,formatConstant} from './ui.mjs';
import {parse,evaluate} from './game.mjs';

test('keypad can compose expressions with functions, implicit multiplication and cursor movement',()=>{
 let edit={value:'',start:0,end:0};
 for(const key of ['3','sin','5','x','right','+','sqrt','9','right'])edit=editEquation(edit.value,edit.start,edit.end,key);
 assert.equal(edit.value,'3sin(5x)+sqrt(9)');assert.equal(edit.start,edit.value.length);
 assert.equal(evaluate(parse(edit.value),2),3*Math.sin(10)+3);
 for(const name of ['sin','cos','tan','exp','ln','sqrt','abs']){
  const result=editEquation('',0,0,name);assert.equal(result.value,`${name}()`);assert.equal(result.start,name.length+1);
 }
});
test('keypad selection wrapping, deletion, clear and bounded insertion',()=>{
 assert.deepEqual(editEquation('3x+1',0,2,'abs'),{value:'abs(3x)+1',start:7,end:7});
 assert.equal(editEquation('x+1',0,3,'square').value,'(x+1)^2');
 assert.deepEqual(editEquation('123',1,3,'backspace'),{value:'1',start:1,end:1});
 assert.deepEqual(editEquation('123',2,2,'backspace'),{value:'13',start:1,end:1});
 assert.equal(editEquation('x',0,0,'backspace').value,'x');
 assert.deepEqual(editEquation('abc',1,2,'left'),{value:'abc',start:1,end:1});
 assert.deepEqual(editEquation('abc',1,2,'right'),{value:'abc',start:2,end:2});
 assert.deepEqual(editEquation('x+1',2,2,'clear'),{value:'',start:0,end:0});
 assert.throws(()=>editEquation('x'.repeat(160),160,160,'sin'),/160/);
 assert.throws(()=>editEquation('',0,0,'constructor'),/Unknown/);
});
test('page offers every supported key and places history after keyboard, before rules',async()=>{
 const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
 const keys=[...html.matchAll(/data-key="([^"]+)"/g)].map(match=>match[1]);
 for(const key of ['0','1','2','3','4','5','6','7','8','9','.','+','-','*','/','^','(',')','x','pi','e','sin','cos','tan','exp','ln','sqrt','abs','square','left','right','backspace','clear'])assert.ok(keys.includes(key),key);
 assert.ok(html.indexOf('id="keyboard-title"')<html.indexOf('id="fire"'));
 assert.ok(html.indexOf('id="fire"')<html.indexOf('id="equation-keys"'));
 assert.ok(html.indexOf('id="equation-keys"')<html.indexOf('id="feed"'));
 assert.ok(html.indexOf('id="feed"')<html.indexOf('id="multiplayer-rules"'));
 assert.match(html,/<details class="panel instructions">/);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);assert.equal(new Set(ids).size,ids.length);
});

test('each player sees their own last three trajectories plus only the latest other shot',()=>{
 const paths=['me','opponent-a','me','teammate','me','opponent-b','me','opponent-a'].map((player,shot)=>({player,shot}));
 const before=JSON.stringify(paths),history=trajectoryHistory(paths,'me');
 assert.deepEqual(history.map(h=>h.path.shot),[2,4,6,7]);
 assert.deepEqual(history.map(h=>h.opacity),[.04,.09,.18,.18]);
 assert.deepEqual(trajectoryHistory(paths,'opponent-a').map(h=>h.path.shot),[1,6,7]);
 assert.deepEqual(trajectoryHistory(paths,'spectator').map(h=>h.path.shot),[7]);
 assert.deepEqual(trajectoryHistory(paths.slice(0,4),'me').map(h=>h.path.shot),[0,2,3],'teammates count as other players');
 assert.deepEqual(trajectoryHistory([], 'me'),[]);assert.equal(JSON.stringify(paths),before);
});
test('trajectory history respects current animation, hides future shots, and keeps active shot separate',()=>{
 const paths=['me','other','me','other','me','other','me','other','me'].map((player,shot)=>({player,shot}));
 assert.deepEqual(trajectoryHistory(paths,'me',6).map(h=>h.path.shot),[0,2,4,5]);
 assert.deepEqual(trajectoryHistory(paths,'me',7).map(h=>h.path.shot),[2,4,6]);
 assert.deepEqual(trajectoryHistory(paths,'me').map(h=>h.path.shot),[4,6,7,8]);
});

test('automatic constant uses signed scientific notation without changing its numeric value',()=>{
 assert.equal(formatConstant(103),'+1.03e2');assert.equal(formatConstant(-103),'-1.03e2');
 assert.equal(formatConstant(.005),'+5.00e-3');assert.equal(formatConstant(0),'+0.00e0');
 assert.equal(formatConstant(-0),'+0.00e0');assert.equal(formatConstant(1e100),'+1.00e100');
 assert.throws(()=>formatConstant(Infinity));assert.throws(()=>formatConstant(NaN));
});
