const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('app.js','utf8');
function harness({voices=true,unsupported=false,storageFailure=false,speechError=false}={}){
 const nodes={};const documentEvents={};const tools=[];const spoken=[];const storage={};const timers=new Map();let timerId=0;let cancels=0;
 function node(id){return nodes[id]||(nodes[id]={id,innerHTML:'',textContent:'',open:false,dataset:{},classList:{toggle(){}},addEventListener(){},showModal(){this.open=true},close(){this.open=false},querySelector(){return null},focus(){},setAttribute(){}})}
 const document={getElementById:node,querySelectorAll(selector){if(selector==='dialog')return ['parent-dialog','help-dialog','stickers-dialog'].map(node);return []},activeElement:null,documentElement:{classList:{toggle(){}}},addEventListener(k,v){documentEvents[k]=v},modelContext:{registerTool(t){tools.push(t)}},hidden:false};
 node('app').querySelector=()=>null;
 const speechSynthesis={getVoices(){return voices?[{lang:'en-US',name:'Test English',voiceURI:'en',localService:true},{lang:'ko-KR',name:'Test Korean',voiceURI:'ko',localService:true}]:[]},cancel(){cancels++},addEventListener(){},speak(u){spoken.push({text:u.text,lang:u.lang,rate:u.rate,voice:u.voice?.voiceURI});if(speechError)u.onerror?.({error:'synthesis-failed'});else{u.onstart?.();u.onend?.()}}};
 function Utterance(text){this.text=text;}
 const window={matchMedia(){return {matches:false}},scrollTo(){},addEventListener(){},SpeechSynthesisUtterance:Utterance,...(unsupported?{}:{speechSynthesis})};
 const ctx=vm.createContext({console,document,window,SpeechSynthesisUtterance:Utterance,localStorage:{getItem(k){if(storageFailure)throw Error('no storage');return storage[k]||null},setItem(k,v){if(storageFailure)throw Error('no storage');storage[k]=v}},setTimeout(fn){timers.set(++timerId,fn);return timerId},clearTimeout(id){timers.delete(id)},AbortController,Math,JSON,Map,Set,Promise});
 vm.runInContext(source,ctx);
 return {eval(code){return vm.runInContext(code,ctx)},nodes,tools,spoken,storage,cancels:()=>cancels,timers};
}
let h=harness();
assert(h.nodes.app.innerHTML.includes('오늘은 어디서'));
assert.equal(h.eval('WORDS.length'),15);
assert.equal(h.eval('new Set(WORDS.map(w=>w.id)).size'),15);
const positions={2:new Set(),3:new Set()};let rounds=0;
for(const level of [1,2,3]) for(const game of ['animals','picnic','actions']) for(let run=0;run<35;run++){
 h.eval(`settings.level=${level};startGame('${game}')`);
 assert.equal(h.eval('session.rounds.length'),6);
 for(let n=0;n<6;n++){
  const r=h.eval('currentRound()');
  assert.equal(new Set(r.choices.map(w=>w.id)).size,level===3?3:2);
  assert.equal(r.choices.filter(w=>w.id===r.target.id).length,1);
  assert(r.choices.every(w=>w.topic===r.target.topic));
  positions[r.choices.length].add(r.choices.findIndex(w=>w.id===r.target.id));
  h.eval('nextRound()');assert.equal(h.eval('session.index'),n);
  h.eval(`choose('${r.target.id}')`);assert(h.eval('currentRound().correct'));
  h.eval('nextRound()');rounds++;
 }
 assert.equal(h.eval('screen'),'finish');
 assert(h.eval('saved.stickers.length')<=6);
}
assert.equal(positions[2].size,2);assert.equal(positions[3].size,3);
h.eval("startGame('animals')");let r=h.eval('currentRound()');let wrong=r.choices.find(w=>w.id!==r.target.id).id;
h.eval(`choose('${wrong}')`);assert(h.eval('currentRound().hinted'));assert(h.nodes.app.innerHTML.includes('괜찮아!'));assert(h.eval(`saved.missed.includes('${r.target.id}')`));h.eval(`choose('${r.target.id}')`);assert(h.eval('currentRound().correct'));
h.eval('settings.sound=false;render()');assert(h.nodes.app.innerHTML.includes('보호자가 읽어 주세요'));assert(h.nodes.app.innerHTML.includes('target-preview'));h.eval('settings.sound=true;prompt(true)');assert(h.spoken.some(s=>s.lang==='ko-KR'));assert(h.spoken.some(s=>s.lang==='en-US'));let cancelCount=h.cancels();h.eval('prompt()');assert(h.cancels()>cancelCount);
h.eval("settings.topic='colors';startGame('picnic')");assert(h.eval("session.rounds.every(r=>r.target.topic==='colors')"));
h.eval('openSettings()');assert(h.nodes['parent-dialog'].open);assert(h.nodes['parent-dialog'].innerHTML.includes('목소리 고르기'));
h.eval("dispatchAction('reset-ask')");assert(h.nodes['reset-area'].innerHTML.includes('모두 지울까요'));
h.eval("dispatchAction('reset-confirm')");assert.equal(h.eval('saved.stickers.length'),0);assert.equal(h.eval('saved.missed.length'),0);assert.equal(h.eval('settings.level'),1);assert.equal(h.eval('screen'),'home');
h.eval('openGuide()');assert(h.nodes['help-dialog'].innerHTML.includes('15개 영어'));
let read=h.tools.find(t=>t.name==='read_english_game_state'),start=h.tools.find(t=>t.name==='start_english_game');assert(read.annotations.readOnlyHint);assert.equal(start.execute({game:'picnic'}).game,'picnic');let state=read.execute({});assert.equal(state.totalRounds,6);assert.throws(()=>start.execute({game:'unknown'}));assert.equal(read.execute({}).game,'picnic');assert.throws(()=>read.execute({extra:true}));
for(const config of [{unsupported:true},{voices:false},{speechError:true},{storageFailure:true}]){let x=harness(config);x.eval("startGame('animals')");assert.equal(x.eval('screen'),'play');if(!config.storageFailure)assert(x.nodes.app.innerHTML.includes('보호자가 읽어 주세요'));if(config.speechError)assert(x.nodes.app.innerHTML.includes('소리가 재생되지 않았어요'));x.eval("choose(currentRound().target.id);nextRound()");assert.equal(x.eval('session.index'),1);}
console.log(JSON.stringify({passed:true,roundsValidated:rounds,sessionCount:315,gameCount:3,levels:3,choicePositions:[...positions[2],...positions[3]],checks:['round-validity','random-position-coverage','no-premature-advance','six-round-completion','gentle-hints','missed-word-review','local-persistence','parent-reset-confirmation','english-korean-utterance-queue','replay-cancels-old-speech','unsupported-voice-fallback','voice-error-fallback','storage-failure-resilience','webmcp-registration-and-valid-invalid-inputs-in-mock-context'],limitations:['No real browser layout, touch, keyboard or device speech verification in this environment.','WebMCP behavior was checked in a mocked registry, not a supported live WebMCP context.']},null,2));
