'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(process.argv[2]||'app.js','utf8');
const EN={lang:'en-US',name:'English',voiceURI:'en',localService:true};
const KO={lang:'ko-KR',name:'Korean',voiceURI:'ko',localService:true};
function harness(availableVoices){
  const nodes={},queued=[],utterances=[],played=[],timers=new Map();let nextTimer=0,cancels=0;
  function node(id){return nodes[id]||(nodes[id]={innerHTML:'',textContent:'',open:false,querySelector(){return null},classList:{toggle(){}},addEventListener(){},showModal(){this.open=true},close(){this.open=false},focus(){}});}
  function Utterance(text){this.text=text;}
  const synth={getVoices(){return availableVoices},addEventListener(){},cancel(){cancels++;queued.length=0},speak(u){queued.push(u);utterances.push(u)}};
  const document={getElementById:node,querySelectorAll(){return[]},activeElement:null,documentElement:{classList:{toggle(){}}},addEventListener(){},hidden:false};
  const window={speechSynthesis:synth,SpeechSynthesisUtterance:Utterance,matchMedia(){return{matches:false}},scrollTo(){},addEventListener(){}};
  const context=vm.createContext({window,document,SpeechSynthesisUtterance:Utterance,localStorage:{getItem(){return null},setItem(){}},setTimeout(fn){timers.set(++nextTimer,fn);return nextTimer},clearTimeout(id){timers.delete(id)},AbortController,console,Map,Set,Math,JSON,Promise});
  const evaluate=code=>vm.runInContext(code,context);evaluate(source);
  function flush(){let ticks=0;while(queued.length){assert(++ticks<20);const u=queued.shift();if(!availableVoices.some(v=>v.lang===u.lang)){u.onerror?.({error:'language-unavailable'});}else{u.onstart?.();played.push(u.lang);u.onend?.();}}}
  return {evaluate,queued,utterances,played,timers,nodes,flush,cancels:()=>cancels};
}
let failures=0;
function test(name,fn){try{fn();console.log('PASS '+name)}catch(error){failures++;console.log('FAIL '+name+': '+error.message)}}
test('English-only device skips unavailable Korean and plays the English target',()=>{
  const h=harness([EN]);h.evaluate("startGame('animals')");
  h.flush();assert.deepEqual(h.played,['en-US']);assert.equal(h.evaluate('audioState'),'idle');
});
test('English-only voice preview plays English',()=>{
  const h=harness([EN]);h.evaluate("dispatchAction('test-voice')");h.flush();assert.deepEqual(h.played,['en-US']);assert.equal(h.evaluate('audioState'),'idle');
});
test('Available Korean and English retain both utterances',()=>{
  const h=harness([EN,KO]);h.evaluate("startGame('animals')");h.flush();assert.deepEqual(h.played,['ko-KR','en-US']);assert.equal(h.evaluate('audioState'),'idle');
});
test('Empty initial voice list retains browser-default attempt and safe failure',()=>{
  const h=harness([]);h.evaluate("startGame('animals')");assert.deepEqual(h.queued.map(u=>u.lang),['ko-KR','en-US']);h.flush();assert.equal(h.evaluate('audioState'),'error');assert(h.nodes.app.innerHTML.includes('보호자가 읽어 주세요'));
});
test('Replay cancels pending old utterances and keeps the current English target',()=>{
  const h=harness([EN]);h.evaluate("startGame('animals')");const old=h.utterances[0];const before=h.cancels();h.evaluate('prompt()');assert(h.cancels()>before);old.onerror?.({error:'synthesis-failed'});h.flush();assert.deepEqual(h.played,['en-US']);assert.equal(h.evaluate('audioState'),'idle');
});
test('Never-starting English attempt reaches fallback',()=>{
  const h=harness([EN]);h.evaluate("startGame('animals')");for(const fn of [...h.timers.values()])fn();assert.equal(h.evaluate('audioState'),'error');assert.equal(h.queued.length,0);
});
test('Home and restart reset six-round state even with no voices',()=>{
  const h=harness([]);h.evaluate("startGame('animals');choose(currentRound().target.id);nextRound();home();startGame('picnic')");assert.equal(h.evaluate('session.index'),0);assert.equal(h.evaluate('session.rounds.length'),6);assert.equal(h.evaluate('session.game'),'picnic');
});
test('English-only speaking completion does not claim English is unavailable',()=>{
  const h=harness([EN]);h.evaluate("startSpeaking('echo')");h.flush();h.evaluate('completeSpeaking()');h.flush();assert.equal(h.evaluate('audioState'),'idle');assert(!h.nodes.app.innerHTML.includes('영어 목소리를 아직 찾지 못했어요'));
});
test('English-only paired friend shows Korean text without unavailable error',()=>{
  const h=harness([EN]);h.evaluate("settings.pairPractice=true;startSpeaking('roleplay','greeting')");h.flush();assert.equal(h.evaluate('audioState'),'idle');assert.equal(h.queued.length,0);h.evaluate('speakingPrompt()');h.flush();assert.deepEqual(h.played,['en-US']);
});
test('Speaking replay ignores callbacks from audio cancelled by home navigation',()=>{
  const h=harness([EN]);h.evaluate("startSpeaking('echo')");const old=h.utterances[0];h.evaluate('home()');old.onstart?.();old.onerror?.({error:'synthesis-failed'});old.onend?.();assert.equal(h.evaluate('screen'),'home');assert.equal(h.evaluate('audioState'),'idle');assert.equal(h.queued.length,0);
});
console.log(JSON.stringify({passed:failures===0,failures,scope:'Mock browser speech queue, no real audio output'}));process.exitCode=failures?1:0;
