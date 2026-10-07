const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('app.js','utf8');
function harness({voices=true,unsupported=false,storageFailure=false,speechError=false,initialSaved=null}={}){
 const nodes={};const documentEvents={};const tools=[];const spoken=[];const storage=initialSaved?{'hello-forest-v1':JSON.stringify(initialSaved)}:{};const timers=new Map();let timerId=0;let cancels=0;
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
let checks=0,turns=0;
function test(name,fn){fn();checks++;console.log('PASS '+name)}
test('Five games remain, sentence games lead and recommended level 2 is separate',()=>{const h=harness();assert.equal(h.eval('settings.level'),1);assert.equal(h.eval('settings.speakingLevel'),2);assert(h.nodes.app.innerHTML.indexOf('data-start="echo"')<h.nodes.app.innerHTML.indexOf('data-start="animals"'));h.eval('openStories()');assert(h.nodes.app.innerHTML.includes('data-story="greeting"'));assert(h.nodes.app.innerHTML.includes('data-story="picnic"'))});
for(const level of [1,2,3])test('Six sentence challenges at level '+level,()=>{
 const h=harness();h.eval(`settings.speakingLevel=${level};startSpeaking('echo')`);assert.equal(h.eval('session.level'),level);assert.equal(h.eval('session.rounds.length'),6);
 for(let i=0;i<6;i++){
  assert.equal(h.eval('session.index'),i);assert.equal(h.eval('nextSpeaking()'),false);assert.equal(h.eval('choose("dog")'),false);
  const answer=h.eval('currentRound().target.en');assert(answer.split(/\s+/).length>=4);assert.equal(h.eval('currentRound().modelRevealed'),level===1);
  if(level>1){assert(!h.nodes.app.innerHTML.includes(answer));assert.equal(h.eval('stateSnapshot().phrase'),null)}
  if(level===3)assert(h.nodes.app.innerHTML.includes(h.eval('currentRound().item.followup')));
  h.eval('completeSpeaking()');assert.equal(h.eval('completeSpeaking()'),false);assert(h.nodes.app.innerHTML.includes('내 생각을 말해 주었구나'));
  h.eval('nextSpeaking()');assert.equal(h.eval('nextSpeaking()'),false);turns++;
 }
 assert.equal(h.eval('screen'),'finish');assert.equal(h.eval('saved.stickers.length'),1);h.eval('finish()');assert.equal(h.eval('saved.stickers.length'),1);
 h.eval("dispatchAction('speaking-restart')");assert.equal(h.eval('session.index'),0);assert.equal(h.eval('session.level'),level);h.eval('home()');assert.equal(h.eval('session'),null);
});
for(const story of ['greeting','picnic'])for(const pair of [false,true])for(const level of [1,2,3])test(`Four child responses ${story}, pair ${pair}, level ${level}`,()=>{
 const h=harness();h.eval(`settings.speakingLevel=${level};settings.pairPractice=${pair};startSpeaking('roleplay','${story}')`);assert.equal(h.eval('session.rounds.length'),4);
 for(let i=0;i<4;i++){
  assert.equal(h.eval('session.index'),i);assert.equal(h.eval('stateSnapshot().story'),story);assert.equal(h.eval('currentRound().role'),'child');assert(h.nodes.app.innerHTML.includes('말했어요'));
  if(pair)assert(h.nodes.app.innerHTML.includes('보호자가 친구의 질문을 읽어 주세요'));
  h.eval('completeSpeaking();nextSpeaking()');turns++;
 }
 assert.equal(h.eval('screen'),'finish');assert.equal(h.eval('saved.missed.length'),0);h.eval("dispatchAction('speaking-restart')");assert.equal(h.eval('session.story'),story);assert.equal(h.eval('session.index'),0);
});
test('Upper levels speak only the question before deliberate model reveal',()=>{
 for(const level of [2,3]){const h=harness();h.eval(`settings.speakingLevel=${level};startSpeaking('echo')`);assert(!h.spoken.some(p=>p.text===h.eval('currentRound().target.en')));assert.equal(h.spoken.at(-1).text,h.eval('currentSpeakingQuestion()'));h.eval('revealSpeakingModel()');assert.equal(h.eval('currentRound().modelRevealed'),true);assert.equal(h.spoken.at(-1).text,h.eval('currentRound().target.en'));assert(h.nodes.app.innerHTML.includes('이렇게 말해 볼 수도 있어요'))}
});
test('Slow question and slow model replay cancel previous audio without advancement',()=>{
 const h=harness();h.eval("startSpeaking('echo')");let prior=h.cancels();h.eval('speakingPrompt(true)');assert(h.cancels()>prior);assert.equal(h.spoken.at(-1).rate,.55);assert.equal(h.eval('currentRound().modelRevealed'),false);h.eval('revealSpeakingModel(true)');assert.equal(h.spoken.at(-1).rate,.55);h.eval('speakingPrompt()');assert.equal(h.spoken.at(-1).rate,.77);assert.equal(h.eval('session.index'),0);assert.equal(h.eval('currentRound().done'),false);
});
test('Picture choices update only examples, preserve hidden models, and never mark correct',()=>{
 const h=harness();h.eval("startSpeaking('echo')");assert.equal(h.eval('selectSpeakingOption(1)'),true);assert(h.eval('currentRound().target.en').includes('banana'));assert.equal(h.eval('currentRound().done'),false);assert.equal(h.eval('currentRound().modelRevealed'),false);assert.equal(h.eval('selectSpeakingOption(99)'),false);h.eval('completeSpeaking()');assert.equal(h.eval('selectSpeakingOption(0)'),false);
});
test('Korean help reveals question meaning without revealing model',()=>{
 const h=harness();h.eval("startSpeaking('echo');speakingPrompt(false,true)");assert.equal(h.eval('currentRound().helpVisible'),true);assert.equal(h.eval('currentRound().modelRevealed'),false);assert(h.nodes.app.innerHTML.includes('무엇을 먹고 싶나요?'));
});
test('Pair mode does not auto-play parent questions; requested replay works',()=>{
 const h=harness();h.eval("settings.pairPractice=true;startSpeaking('roleplay','picnic')");assert.equal(h.spoken.length,0);h.eval('speakingPrompt()');assert.equal(h.spoken.at(-1).text,h.eval('currentSpeakingQuestion()'));h.eval('completeSpeaking()');let count=h.spoken.length;h.eval('nextSpeaking()');assert.equal(h.spoken.length,count);
});
test('Old stored level 1, sticker and review records migrate with new level 2',()=>{
 const h=harness({initialSaved:{settings:{level:1,sound:false},stickers:[2],missed:['cat']}});assert.equal(h.eval('settings.level'),1);assert.equal(h.eval('settings.speakingLevel'),2);h.eval("startSpeaking('echo')");assert.equal(h.eval('session.level'),2);assert.equal(h.eval('saved.stickers[0]'),2);assert.equal(h.eval('saved.missed[0]'),'cat');h.eval('persist()');assert(JSON.parse(h.storage['hello-forest-v1']).stickers.includes(2));h.eval("startGame('animals')");assert.equal(h.eval('session.level'),1);
});
test('Stored invalid speaking level is normalized and reset restores independent defaults',()=>{
 const h=harness({initialSaved:{settings:{speakingLevel:99,level:3},stickers:[1]}});assert.equal(h.eval('settings.speakingLevel'),2);assert.equal(h.eval('settings.level'),3);h.eval("dispatchAction('reset-confirm')");assert.equal(h.eval('settings.speakingLevel'),2);assert.equal(h.eval('settings.level'),1);assert.equal(h.eval('saved.stickers.length'),0);
});
test('Skipping all questions has no penalty and still grants a play sticker',()=>{
 const h=harness();h.eval("startSpeaking('echo')");for(let i=0;i<6;i++)h.eval('completeSpeaking(true);nextSpeaking()');assert.equal(h.eval('screen'),'finish');assert.equal(h.eval('saved.missed.length'),0);assert.equal(h.eval('saved.stickers.length'),1);
});
for(const config of [{unsupported:true},{voices:false},{speechError:true},{storageFailure:true}])test('Sentence play tolerates '+Object.keys(config)[0],()=>{const h=harness(config);h.eval("startSpeaking('roleplay','picnic');completeSpeaking();nextSpeaking()");assert.equal(h.eval('session.index'),1);h.eval('home()');assert.equal(h.eval('screen'),'home')});
test('Scene/count content and question changes are explicit',()=>{const h=harness();assert(h.eval("speakingScene(SPEAKING_WORDS[2])").includes('나무 옆에 있는 고양이'));const counts=h.eval('speakingScene(SPEAKING_WORDS[4])');assert.equal((counts.match(/🍎/gu)||[]).length,3);assert.equal((counts.match(/🍌/gu)||[]).length,2);assert(h.eval("STORIES.greeting.turns[3].emoji").includes('🌧️'));assert(h.eval("STORIES.greeting.turns[3].question").includes('rain'))});
test('Model registry handles all new screens without revealing hidden examples',()=>{const h=harness();const start=h.tools.find(t=>t.name==='start_english_game');assert.equal(start.execute({game:'echo'}).phrase,null);assert.equal(start.execute({game:'roleplay'}).screen,'stories');assert.throws(()=>start.execute({game:'bad'}));h.eval('home()');assert.equal(h.eval('stateSnapshot().turnDone'),false)});
test('Keyboard focus survives picture choices and sentence level selection',()=>{const h=harness();h.eval("startSpeaking('echo');app.querySelector=selector=>({focus(){globalThis.lastFocusedSelector=selector}});document.activeElement={dataset:{speakingChoice:'1'}};selectSpeakingOption(1)");assert.equal(h.eval('lastFocusedSelector'),'[data-speaking-choice=\"1\"]');h.eval("home();document.activeElement={dataset:{speakingLevel:'3'}};settings.speakingLevel=3;render()");assert.equal(h.eval('lastFocusedSelector'),'[data-speaking-level=\"3\"]')});
console.log(JSON.stringify({passed:true,checks,speakingTurnsValidated:turns,echoLevels:3,stories:2,parentPairModes:2,manualCompletion:true,limitations:['Runtime and speech synthesis are mocked; no real device audio or visual layout verified.']},null,2));
