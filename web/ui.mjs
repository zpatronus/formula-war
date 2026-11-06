// All untrusted content interpolated into HTML must pass through this function.
// Other UI sinks use textContent or canvas.fillText, which do not interpret HTML.
export function escapeHTML(value) {
 return String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
 }[character]));
}

// The on-screen keypad edits plain text. Evaluation still goes through the math parser.
export function editEquation(value,start,end,key,maxLength=160){
 start=Math.max(0,Math.min(value.length,start??value.length));
 end=Math.max(start,Math.min(value.length,end??start));
 const selected=value.slice(start,end);
 if(key==='left')return {value,start:Math.max(0,(start===end?start-1:start)),end:Math.max(0,(start===end?start-1:start))};
 if(key==='right'){const cursor=start===end?Math.min(value.length,end+1):end;return {value,start:cursor,end:cursor};}
 if(key==='clear')return {value:'',start:0,end:0};
 if(key==='backspace'){
  if(start===end)start=Math.max(0,start-1);
  return {value:value.slice(0,start)+value.slice(end),start,end:start};
 }
 let insertion,caret;
 if(['sin','cos','tan','exp','ln','sqrt','abs'].includes(key)){
  insertion=`${key}(${selected})`;caret=start+insertion.length-(selected?0:1);
 }else if(key==='square'){
  insertion=selected?`(${selected})^2`:'^2';caret=start+insertion.length;
 }else if(['0','1','2','3','4','5','6','7','8','9','.','x','pi','e','+','-','*','/','^','(',')'].includes(key)){
  insertion=key;caret=start+insertion.length;
 }else throw Error('Unknown equation key.');
 const edited=value.slice(0,start)+insertion+value.slice(end);
 if(edited.length>maxLength)throw Error(`Use at most ${maxLength} characters.`);
 return {value:edited,start:caret,end:caret};
}
