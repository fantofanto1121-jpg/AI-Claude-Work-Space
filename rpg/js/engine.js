/* =====================================================================
 * engine.js  :  中枢（状態・成長・セーブ・シーン管理・ループ・入力）
 *   最後に読み込まれ、window 読込後に Game.boot() で起動する。
 * ===================================================================== */

window.Game = window.Game || {};

(function () {
  'use strict';
  const D = () => Game.Data;

  /* ---------- 共有ステート ---------- */
  Game.state = null;
  const SAVE_KEY = 'eterna_save_v1';

  function makeHero(id, level) {
    const def = D().HEROES[id];
    level = level || 1;
    const h = { id, name: def.name, level: 1, exp: 0,
      maxhp: 0, hp: 0, maxmp: 0, mp: 0, atk: 0, def: 0, mag: 0, spd: 0,
      skills: D().getStartingSkills(id) };
    recalc(h, true);
    // 目標レベルまで上げる
    while (h.level < level) { h.level++; recalc(h, true); mergeSkills(h); }
    h.hp = h.maxhp; h.mp = h.maxmp;
    return h;
  }
  function recalc(h, keepFull) {
    const def = D().HEROES[h.id];
    const lv = h.level - 1;
    const s = {
      maxhp: Math.round(def.base.maxhp + def.growth.maxhp * lv),
      maxmp: Math.round(def.base.maxmp + def.growth.maxmp * lv),
      atk: Math.round(def.base.atk + def.growth.atk * lv),
      def: Math.round(def.base.def + def.growth.def * lv),
      mag: Math.round(def.base.mag + def.growth.mag * lv),
      spd: Math.round(def.base.spd + def.growth.spd * lv)
    };
    // 差分をHP/MPに加算（レベルアップで少し回復）
    const dhp = s.maxhp - h.maxhp, dmp = s.maxmp - h.maxmp;
    h.maxhp = s.maxhp; h.maxmp = s.maxmp; h.atk = s.atk; h.def = s.def; h.mag = s.mag; h.spd = s.spd;
    if (keepFull) { h.hp = h.maxhp; h.mp = h.maxmp; }
    else { h.hp = Math.min(h.maxhp, h.hp + Math.max(0, dhp)); h.mp = Math.min(h.maxmp, h.mp + Math.max(0, dmp)); }
  }
  function mergeSkills(h) {
    D().allLearnedUpTo(h.id, h.level).forEach((sid) => { if (h.skills.indexOf(sid) < 0) h.skills.push(sid); });
  }

  Game.gainExp = function (hero, exp) {
    const msgs = [];
    hero.exp += exp;
    while (hero.level < 99 && hero.exp >= D().expForLevel(hero.level + 1)) {
      hero.level++;
      const before = hero.skills.slice();
      recalc(hero, false);
      const learned = D().learnedAt(hero.id, hero.level);
      learned.forEach((sid) => { if (hero.skills.indexOf(sid) < 0) hero.skills.push(sid); });
      msgs.push(hero.name + ' は レベル ' + hero.level + ' に あがった!');
      const newly = hero.skills.filter((s) => before.indexOf(s) < 0);
      newly.forEach((s) => msgs.push(hero.name + ' は 『' + D().SKILLS[s].name + '』を おぼえた!'));
    }
    return msgs;
  };

  Game.joinParty = function (id) {
    if (Game.state.party.some((m) => m.id === id)) return;
    // 加入時は先頭の平均レベル程度で
    const avg = Math.round(Game.state.party.reduce((s, m) => s + m.level, 0) / Game.state.party.length) || 1;
    Game.state.party.push(makeHero(id, Math.max(1, avg)));
  };

  Game.addItem = function (id, n) {
    Game.state.inventory[id] = (Game.state.inventory[id] || 0) + (n || 1);
  };
  Game.hasItem = function (id) { return (Game.state.inventory[id] || 0) > 0; };
  Game.removeItem = function (id, n) { Game.state.inventory[id] = Math.max(0, (Game.state.inventory[id] || 0) - (n || 1)); };
  Game.fullHeal = function () { Game.state.party.forEach((h) => { h.hp = h.maxhp; h.mp = h.maxmp; }); };

  /* ---------- ニューゲーム ---------- */
  Game.newGame = function () {
    Game.state = {
      party: [makeHero('lio', 1)],
      inventory: { herb: 3 },
      gold: 60,
      flags: {},
      currentMap: 'village'
    };
    Game.World.load('village');
    setScene('world');
  };

  /* ---------- セーブ/ロード ---------- */
  Game.saveGame = function () {
    try {
      const data = { state: Game.state, ver: 1, t: Date.now() };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) { console.warn('save failed', e); }
  };
  Game.hasSave = function () {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  };
  Game.loadGame = function () {
    try {
      const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false;
      const data = JSON.parse(raw);
      Game.state = data.state;
      Game.World.load(Game.state.currentMap || 'village');
      setScene('world');
      return true;
    } catch (e) { console.warn('load failed', e); return false; }
  };

  /* ---------- バトル起動（Promise） ---------- */
  Game.startBattle = function (opts) {
    return new Promise((resolve) => {
      setScene('battle');
      Game.Battle.resize(W, H);
      Game.Battle.begin(Object.assign({}, opts, {
        onEnd: (result) => { setScene('world'); resolve(result); }
      }));
    });
  };

  /* ---------- ゲームオーバー / エンディング ---------- */
  Game.gameOver = function () {
    Game.Audio.stopBgm();
    setScene('gameover');
    showOverlay('gameover');
  };
  Game.reachEnding = function () {
    Game.Audio.stopBgm(); Game.Audio.sfx('fanfare');
    // クリアフラグ
    Game.state.flags.cleared = true;
    Game.saveGame();
    setScene('ending');
    showOverlay('ending');
  };

  /* ---------- シーン管理 ---------- */
  let scene = 'title';
  function setScene(s) {
    scene = s;
    Game.UI.setControlsVisible(s === 'world');
    if (s === 'world') Game.World.enter();
  }

  /* ---------- キャンバス & ループ ---------- */
  let canvas, ctx, W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = canvas.getBoundingClientRect();
    W = Math.round(rect.width); H = Math.round(rect.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (Game.World) Game.World.resize(W, H);
    if (Game.Battle) Game.Battle.resize(W, H);
  }

  let last = 0;
  function loop(ts) {
    const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
    if (scene === 'world') { Game.World.update(dt); Game.World.render(ctx, W, H); }
    else if (scene === 'battle') { Game.Battle.update(dt); Game.Battle.render(ctx, W, H); }
    else if (scene === 'title' || scene === 'gameover' || scene === 'ending') { renderBackdrop(ts / 1000); }
    requestAnimationFrame(loop);
  }
  function renderBackdrop(t) {
    // タイトル等の背景：星空
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0f28'); g.addColorStop(1, '#05070f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 80; i++) {
      const x = (i * 89) % W, y = (i * 143) % H;
      ctx.globalAlpha = 0.2 + 0.6 * Math.abs(Math.sin(t + i));
      const s = (i % 5 === 0) ? 2 : 1;
      ctx.fillRect(x, y, s, s);
    }
    ctx.globalAlpha = 1;
    // 大きな星（消えかけ→復活の演出的に明滅）
    ctx.save();
    ctx.translate(W * 0.5, H * 0.28);
    const pulse = 0.7 + 0.3 * Math.sin(t * 1.5);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = 'rgba(180,200,255,0.9)';
    Game.Gfx.star(ctx, 0, 0, Math.min(W, H) * 0.09, Math.min(W, H) * 0.04, 5);
    ctx.restore();
  }

  /* ---------- タイトル/オーバーレイ（DOM） ---------- */
  let overlayEl;
  function buildOverlay(rootEl) {
    overlayEl = document.createElement('div');
    overlayEl.className = 'overlay-screen hidden';
    rootEl.appendChild(overlayEl);
  }
  function showOverlay(kind) {
    overlayEl.classList.remove('hidden');
    overlayEl.innerHTML = '';
    const panel = document.createElement('div'); panel.className = 'title-panel'; overlayEl.appendChild(panel);
    const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; panel.appendChild(e); return e; };
    if (kind === 'title') {
      mk('div', 'title-sub', '星継ぎの');
      mk('h1', 'title-main', 'エテルナ');
      mk('p', 'title-lead', '消えゆく星を継ぐ、ひとつの旅。');
      const start = mk('button', 'btn primary big', 'はじめから');
      start.addEventListener('pointerdown', (e) => { e.preventDefault(); Game.Audio.init(); Game.Audio.sfx('confirm'); hideOverlay(); Game.newGame(); });
      if (Game.hasSave()) {
        const cont = mk('button', 'btn big', 'つづきから');
        cont.addEventListener('pointerdown', (e) => { e.preventDefault(); Game.Audio.init(); Game.Audio.sfx('confirm'); hideOverlay(); Game.loadGame(); });
      }
      mk('p', 'title-hint', '移動: 十字キー / 矢印　　しらべる: ● / Enter　　メニュー: ≡ / Esc');
    } else if (kind === 'gameover') {
      mk('h1', 'title-main gameover', 'GAME OVER');
      mk('p', 'title-lead', '星の光は、まだ消えてはいない…');
      if (Game.hasSave()) {
        const cont = mk('button', 'btn primary big', 'つづきから');
        cont.addEventListener('pointerdown', (e) => { e.preventDefault(); Game.Audio.sfx('confirm'); hideOverlay(); Game.loadGame(); });
      }
      const t = mk('button', 'btn big', 'タイトルへ');
      t.addEventListener('pointerdown', (e) => { e.preventDefault(); Game.Audio.sfx('cancel'); hideOverlay(); showOverlay('title'); setScene('title'); });
    } else if (kind === 'ending') {
      mk('div', 'title-sub', 'ありがとう、星守');
      mk('h1', 'title-main', 'THE END');
      mk('p', 'title-lead', '星継ぎのエテルナ　を クリアした!');
      const t = mk('button', 'btn primary big', 'タイトルへ');
      t.addEventListener('pointerdown', (e) => { e.preventDefault(); Game.Audio.sfx('confirm'); hideOverlay(); showOverlay('title'); setScene('title'); });
    }
  }
  function hideOverlay() { overlayEl.classList.add('hidden'); }

  /* ---------- 起動 ---------- */
  Game.boot = function () {
    canvas = document.getElementById('game');
    ctx = canvas.getContext('2d');
    const uiRoot = document.getElementById('ui-root');
    Game.UI.init(uiRoot);
    buildOverlay(uiRoot);

    Game.UI.setButtonHandler((btn) => {
      if (scene !== 'world') return;
      if (btn === 'A') Game.World.onAction();
      else if (btn === 'menu') Game.World.openMenu();
    });

    window.addEventListener('resize', resize);
    resize();
    // 初回タップでオーディオ有効化
    window.addEventListener('pointerdown', () => Game.Audio.init(), { once: true });

    setScene('title');
    showOverlay('title');
    requestAnimationFrame(loop);
  };

  window.addEventListener('load', Game.boot);
})();
