/* =====================================================================
 * audio.js  :  WebAudio による効果音と簡易BGM（外部音源なし）
 *   Audio.init()          初回ユーザー操作で呼ぶ
 *   Audio.sfx(name)       効果音
 *   Audio.playBgm(theme)  'town'|'field'|'dungeon'|'battle'|'boss'|'victory'
 *   Audio.stopBgm()
 *   Audio.toggle()        ミュート切替 -> boolean(muted)
 * ===================================================================== */

window.Game = window.Game || {};

Game.Audio = (function () {
  'use strict';
  let ac = null, master = null, bgmGain = null, muted = false;
  let bgmTimer = null, bgmTheme = null;

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain(); master.gain.value = muted ? 0 : 0.7; master.connect(ac.destination);
      bgmGain = ac.createGain(); bgmGain.gain.value = 0.28; bgmGain.connect(master);
    } catch (e) { ac = null; }
  }

  function tone(freq, dur, type, when, gainv, dest) {
    if (!ac) return;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square'; o.frequency.value = freq;
    const t0 = (when != null ? when : ac.currentTime);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gainv != null ? gainv : 0.3, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(dest || master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, when, gainv, dest) {
    if (!ac) return;
    const n = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ac.createBufferSource(); src.buffer = buf;
    const g = ac.createGain(); g.gain.value = gainv != null ? gainv : 0.2;
    src.connect(g); g.connect(dest || master);
    src.start(when != null ? when : ac.currentTime);
  }

  const SFX = {
    cursor: () => tone(660, 0.06, 'square', 0, 0.18),
    confirm: () => { tone(660, 0.07, 'square'); tone(990, 0.09, 'square', ac && ac.currentTime + 0.05); },
    cancel: () => tone(330, 0.1, 'square', 0, 0.2),
    hit: () => { noise(0.12, 0, 0.25); tone(180, 0.1, 'sawtooth', 0, 0.2); },
    slash: () => { tone(900, 0.06, 'sawtooth', 0, 0.2); noise(0.08, ac && ac.currentTime + 0.03, 0.2); },
    fire: () => { noise(0.3, 0, 0.22); tone(220, 0.25, 'sawtooth', 0, 0.15); },
    thunder: () => { tone(1200, 0.05, 'square', 0, 0.25); noise(0.25, ac && ac.currentTime + 0.03, 0.3); },
    heal: () => { tone(660, 0.12, 'sine'); tone(880, 0.14, 'sine', ac && ac.currentTime + 0.08); tone(1320, 0.16, 'sine', ac && ac.currentTime + 0.16); },
    magic: () => { tone(500, 0.18, 'triangle', 0, 0.2); tone(760, 0.2, 'triangle', ac && ac.currentTime + 0.06, 0.15); },
    levelup: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'square', ac && ac.currentTime + i * 0.09, 0.22)); },
    encounter: () => { [440, 0, 440, 0, 587].forEach((f, i) => { if (f) tone(f, 0.1, 'square', ac && ac.currentTime + i * 0.08, 0.22); }); },
    item: () => { tone(784, 0.08, 'square'); tone(1046, 0.1, 'square', ac && ac.currentTime + 0.06); },
    door: () => { noise(0.15, 0, 0.15); tone(200, 0.12, 'triangle', 0, 0.12); },
    defeat: () => { [440, 392, 349, 262].forEach((f, i) => tone(f, 0.22, 'sawtooth', ac && ac.currentTime + i * 0.12, 0.2)); },
    fanfare: () => { [523, 523, 523, 659, 784].forEach((f, i) => tone(f, 0.16, 'square', ac && ac.currentTime + i * 0.1, 0.24)); }
  };
  function sfx(name) { if (!ac || muted) return; (SFX[name] || SFX.cursor)(); }

  // --- 簡易BGM：テーマごとの音階ループ ---
  const BGM = {
    town:    { tempo: 0.42, wave: 'triangle', notes: [523, 659, 784, 659, 587, 659, 494, 587, 523, 659, 784, 880, 784, 659, 587, 523] },
    field:   { tempo: 0.36, wave: 'square',   notes: [440, 554, 659, 554, 587, 494, 440, 392, 440, 554, 659, 740, 659, 587, 494, 440] },
    dungeon: { tempo: 0.46, wave: 'triangle', notes: [220, 262, 247, 220, 196, 220, 175, 196, 220, 262, 311, 262, 247, 220, 196, 175] },
    battle:  { tempo: 0.24, wave: 'square',   notes: [330, 392, 330, 440, 392, 330, 294, 330, 392, 494, 440, 392, 330, 294, 262, 294] },
    boss:    { tempo: 0.22, wave: 'sawtooth', notes: [196, 233, 196, 175, 233, 262, 233, 196, 175, 208, 175, 156, 208, 233, 262, 233] },
    victory: { tempo: 0.18, wave: 'square',   notes: [523, 659, 784, 1046, 784, 1046] }
  };
  function playBgm(theme) {
    if (!ac) return;
    if (bgmTheme === theme && bgmTimer) return;
    stopBgm();
    bgmTheme = theme;
    const cfg = BGM[theme]; if (!cfg) return;
    let i = 0;
    const step = () => {
      if (bgmTheme !== theme) return;
      const f = cfg.notes[i % cfg.notes.length];
      if (!muted) {
        tone(f, cfg.tempo * 0.9, cfg.wave, ac.currentTime, 0.16, bgmGain);
        if (i % 4 === 0) tone(f / 2, cfg.tempo * 1.6, 'sine', ac.currentTime, 0.12, bgmGain);
      }
      i++;
      bgmTimer = setTimeout(step, cfg.tempo * 1000);
    };
    step();
  }
  function stopBgm() { if (bgmTimer) { clearTimeout(bgmTimer); bgmTimer = null; } bgmTheme = null; }
  function toggle() {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.7;
    return muted;
  }
  function isMuted() { return muted; }

  return { init, sfx, playBgm, stopBgm, toggle, isMuted };
})();
