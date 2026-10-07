'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function harness({ voices = true, unsupported = false, storageFailure = false, speechError = false, initialSaved = null } = {}) {
  const nodes = {}, spoken = [], storage = {}, timers = new Map();
  if (initialSaved) storage['hello-forest-v1'] = JSON.stringify(initialSaved);
  let timerId = 0;
  function node(id) {
    return nodes[id] || (nodes[id] = {
      innerHTML: '', textContent: '', open: false, dataset: {},
      classList: { toggle() {} }, addEventListener() {}, querySelector() { return null; },
      focus() {}, setAttribute() {}, showModal() { this.open = true; }, close() { this.open = false; }
    });
  }
  const document = {
    getElementById: node, activeElement: null, hidden: false,
    querySelectorAll(selector) { return selector === 'dialog' ? ['parent-dialog', 'help-dialog', 'stickers-dialog'].map(node) : []; },
    documentElement: { classList: { toggle() {} } }, addEventListener() {}
  };
  function Utterance(text) { this.text = text; }
  const synth = {
    getVoices() { return voices ? [
      { lang: 'en-US', voiceURI: 'en', name: 'English', localService: true },
      { lang: 'ko-KR', voiceURI: 'ko', name: 'Korean', localService: true }
    ] : []; },
    cancel() {}, addEventListener() {},
    speak(utterance) {
      spoken.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate });
      if (speechError) utterance.onerror?.({ error: 'synthesis-failed' });
      else { utterance.onstart?.(); utterance.onend?.(); }
    }
  };
  const window = {
    matchMedia() { return { matches: false }; }, scrollTo() {}, addEventListener() {},
    SpeechSynthesisUtterance: Utterance, ...(unsupported ? {} : { speechSynthesis: synth })
  };
  const context = vm.createContext({
    window, document, SpeechSynthesisUtterance: Utterance,
    localStorage: {
      getItem(key) { if (storageFailure) throw Error('Storage unavailable'); return storage[key] || null; },
      setItem(key, value) { if (storageFailure) throw Error('Storage unavailable'); storage[key] = value; }
    },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); }, AbortController, console, Math, JSON, Map, Set, Promise
  });
  vm.runInContext(source, context);
  return { evaluate(code) { return vm.runInContext(code, context); }, nodes, spoken };
}

let sessions = 0, rounds = 0;
const configurations = [{}, { unsupported: true }, { voices: false }, { speechError: true }, { storageFailure: true }];
for (const config of configurations) {
  for (const level of [1, 2, 3]) for (const pair of [false, true]) {
    for (const game of ['echo', 'greeting', 'picnic']) for (const skip of [false, true]) {
      const h = harness(config), total = game === 'echo' ? 6 : 4;
      h.evaluate(`settings.speakingLevel=${level};settings.pairPractice=${pair};startSpeaking('${game === 'echo' ? 'echo' : 'roleplay'}','${game}')`);
      assert.equal(h.evaluate('session.rounds.length'), total);
      assert.equal(h.evaluate('session.level'), level);
      let automaticSpeech = h.spoken.slice();
      for (let i = 0; i < total; i++) {
        assert.equal(h.evaluate('nextSpeaking()'), false, 'No automatic advance before manual completion');
        assert.equal(h.evaluate('session.index'), i);
        assert.equal(h.evaluate('currentRound().role'), 'child');
        assert.equal(h.evaluate('currentRound().modelRevealed'), level === 1);
        if (game !== 'echo' && pair) {
          assert.equal(automaticSpeech.filter(part => part.lang === 'en-US').length, 0, 'Paired mode leaves automatic questions to the parent');
        }
        if (level > 1) {
          assert.equal(h.evaluate('stateSnapshot().phrase'), null, 'Hidden model is absent from the visible-state API');
          assert(!h.nodes.app.innerHTML.includes(h.evaluate('esc(currentRound().target.en)')), 'Hidden model is absent from the DOM');
          assert(!automaticSpeech.some(part => part.text === h.evaluate('currentRound().target.en')), 'Hidden model is not spoken automatically');
        } else {
          assert(h.nodes.app.innerHTML.includes(h.evaluate('esc(currentRound().target.en)')));
          assert(h.evaluate('currentRound().target.en.split(/\\s+/).length') >= 4, 'Tier one has sentence models, not isolated words');
        }
        const before = h.spoken.length;
        h.evaluate('speakingPrompt(true,true)');
        if (!config.unsupported) {
          const english = h.spoken.slice(before).filter(part => part.lang === 'en-US');
          assert.equal(english.length, level === 1 ? 2 : 1, 'Replay reads the question, adding a model only at tier one');
          assert.equal(english[0].text, h.evaluate('currentSpeakingQuestion()'));
          assert(english.every(part => part.rate === .55));
        }
        if (level > 1) assert.equal(h.evaluate('currentRound().modelRevealed'), false, 'Korean question help keeps model hidden');
        if (h.evaluate('!!currentRound().item.options')) {
          assert.equal(h.evaluate('selectSpeakingOption(1)'), true);
          assert.equal(h.evaluate('currentRound().optionIndex'), 1);
          assert.equal(h.evaluate('selectSpeakingOption(99)'), false);
          assert.equal(h.evaluate('selectSpeakingOption(-1)'), false);
          if (level > 1) assert.equal(h.evaluate('currentRound().modelRevealed'), false);
        }
        const beforeReveal = h.spoken.length;
        h.evaluate('revealSpeakingModel(true)');
        assert.equal(h.evaluate('currentRound().modelRevealed'), true);
        assert(h.nodes.app.innerHTML.includes(h.evaluate('esc(currentRound().target.en)')));
        if (!config.unsupported) {
          const modelSpeech = h.spoken.slice(beforeReveal).filter(part => part.lang === 'en-US');
          assert.equal(modelSpeech.length, 1);
          assert.equal(modelSpeech[0].text, h.evaluate('currentRound().target.en'));
          assert.equal(modelSpeech[0].rate, .55);
        }
        assert.equal(h.evaluate('session.index'), i, 'Replay does not advance the round');
        assert.equal(h.evaluate(`completeSpeaking(${skip})`), true);
        assert.equal(h.evaluate('currentRound().skipped'), skip);
        assert.equal(h.evaluate('completeSpeaking()'), false, 'Repeated confirmation is ignored');
        assert.equal(h.evaluate('selectSpeakingOption(0)'), false, 'Completed turns do not change selection');
        const beforeAdvance = h.spoken.length;
        assert.equal(h.evaluate('nextSpeaking()'), true);
        automaticSpeech = h.spoken.slice(beforeAdvance);
        rounds++;
      }
      assert.equal(h.evaluate('screen'), 'finish');
      assert.equal(h.evaluate('session.finished'), true);
      assert.equal(h.evaluate('saved.stickers.length'), 1);
      assert.equal(h.evaluate('saved.missed.length'), 0, 'Speaking or skipping never adds a missed word');
      assert.equal(h.evaluate('nextSpeaking()'), false);
      h.evaluate("dispatchAction('speaking-restart')");
      assert.equal(h.evaluate('session.index'), 0);
      assert.equal(h.evaluate('screen'), 'play');
      h.evaluate("openStories();home();startGame('animals')");
      assert.equal(h.evaluate('session.speaking'), undefined);
      assert.equal(h.evaluate('session.rounds.length'), 6);
      sessions++;
    }
  }
}

const snapshot = harness();
snapshot.evaluate("settings.level=1;settings.speakingLevel=3;settings.pairPractice=true;startSpeaking('roleplay','greeting');settings.speakingLevel=1;settings.pairPractice=false;render()");
assert.equal(snapshot.evaluate('session.level'), 3);
assert.equal(snapshot.evaluate('session.pairPractice'), true);
assert(snapshot.nodes.app.innerHTML.includes('보호자가 친구의 질문을 읽어 주세요'));
assert.equal(snapshot.evaluate('settings.level'), 1, 'Speaking settings do not alter the picture-game level');

for (const savedLevel of [undefined, 0, 4, '3', null]) {
  const migrated = harness({ initialSaved: { settings: { level: 3, speakingLevel: savedLevel }, stickers: [2], missed: ['cat'] } });
  assert.equal(migrated.evaluate('settings.speakingLevel'), 2);
  assert.equal(migrated.evaluate('settings.level'), 3);
  assert.equal(migrated.evaluate('saved.stickers[0]'), 2);
  assert.equal(migrated.evaluate('saved.missed[0]'), 'cat');
}
for (const speakingLevel of [1, 2, 3]) {
  const migrated = harness({ initialSaved: { settings: { level: 1, speakingLevel }, stickers: [], missed: [] } });
  assert.equal(migrated.evaluate('settings.speakingLevel'), speakingLevel);
}

console.log(JSON.stringify({
  passed: true, sessions, speakingRoundsValidated: rounds, audioStorageConfigurations: configurations.length,
  checks: ['all levels', 'both stories', 'pair on/off', 'manual confirm and skip', 'slow replay',
    'double-confirm guard', 'finish reward', 'restart', 'home/stories/picture navigation', 'session settings snapshot',
    'hidden model in DOM/audio/API', 'question-only replay and Korean help', 'option selection', 'explicit model reveal',
    'parent-led automatic questions', 'legacy settings migration', 'full-sentence tier-one models'],
  limitations: ['DOM and speech are mocked; this does not verify real browser layout, touch, keyboard focus, or device audio.']
}, null, 2));
