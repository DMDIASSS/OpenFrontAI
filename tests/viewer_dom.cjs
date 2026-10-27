// Execute the actual offline viewer script and controls using jsdom.
// Canvas drawing is captured as RGBA data instead of requiring a GPU/window.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve(__dirname,'../vendor/openfrontio/package.json'));
const {JSDOM}=req('jsdom');
const html=fs.readFileSync(process.argv[2],'utf8');let drawn;
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){
 w.HTMLCanvasElement.prototype.getContext=()=>({
  createImageData:(width,height)=>({data:new Uint8ClampedArray(width*height*4)}),
  putImageData:image=>{drawn=image.data;},
 });
}});
(async()=>{try{
 const d=dom.window.document;
 assert.equal(d.title,'OpenFrontAI Match Replay');
 assert.equal(d.getElementById('stats').children.length,4);
 assert.equal(drawn.length,40000);
 let blue=0;for(let i=0;i<drawn.length;i+=4)if(drawn[i]===82&&drawn[i+1]===181&&drawn[i+2]===255)blue++;
 assert.equal(blue,52); // Actual engine spawn fixture owns 52 tiles.
 assert.match(d.getElementById('clock').textContent,/Frame 0/);
 d.getElementById('next').click();assert.match(d.getElementById('clock').textContent,/Frame 1/);
 const slider=d.getElementById('timeline');slider.value=slider.max;slider.dispatchEvent(new dom.window.Event('input'));
 assert.match(d.getElementById('outcome').textContent,/Decision budget reached/);
 d.getElementById('match').value='1';d.getElementById('match').dispatchEvent(new dom.window.Event('change'));
 assert.match(d.getElementById('clock').textContent,/Frame 0/);
 d.getElementById('play').click();await new Promise(r=>setTimeout(r,500));
 assert.doesNotMatch(d.getElementById('clock').textContent,/Frame 0 /);
 d.getElementById('restart').click();assert.match(d.getElementById('clock').textContent,/Frame 0/);
 console.log('Actual viewer script: canvas pixels, stats, step, scrub, match switch, playback and restart passed.');
 }finally{dom.window.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
