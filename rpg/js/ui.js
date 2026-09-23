/* =====================================================================
 * ui.js  :  DOM UI ツールキット（会話窓・メニュー・戦闘HUD・ショップ・仮想パッド）
 *
 * Promise ベースの API で battle.js / world.js / engine.js から利用する。
 * ===================================================================== */

window.Game = window.Game || {};

Game.UI = (function () {
  'use strict';
  let root, dialogue, dialogueName, dialogueText, dialogueFace, tapHint;
  let menuBox, menuTitle, menuList, menuDesc;
  let statusBar, shopBox, toastEl, confirmBox;
  let controls, dpadDirs = { up: 0, down: 0, left: 0, right: 0 };
  let onButton = null;
  const held = {};

  function el(tag, cls, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  function init(rootEl) {
    root = rootEl;

    // 会話窓
    dialogue = el('div', 'dialogue hidden', root);
    dialogueFace = el('div', 'dialogue-face', dialogue);
    const body = el('div', 'dialogue-body', dialogue);
    dialogueName = el('div', 'dialogue-name', body);
    dialogueText = el('div', 'dialogue-text', body);
    tapHint = el('div', 'dialogue-tap', dialogue); tapHint.textContent = '▼';

    // メニュー
    menuBox = el('div', 'menu hidden', root);
    menuTitle = el('div', 'menu-title', menuBox);
    menuList = el('div', 'menu-list', menuBox);
    menuDesc = el('div', 'menu-desc', menuBox);

    // 戦闘ステータス
    statusBar = el('div', 'status-bar hidden', root);

    // ショップ
    shopBox = el('div', 'shop hidden', root);

    // トースト
    toastEl = el('div', 'toast hidden', root);

    // 確認ダイアログ
    confirmBox = el('div', 'confirm hidden', root);

    buildControls();
    bindKeyboard();
  }

  /* ---------- 会話 ---------- */
  function message(text, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      dialogue.classList.remove('hidden');
      if (opts.name) { dialogueName.textContent = opts.name; dialogueName.style.display = ''; }
      else { dialogueName.textContent = ''; dialogueName.style.display = 'none'; }
      // 顔グラフィック
      if (opts.face) { dialogueFace.style.display = ''; drawFace(opts.face); }
      else { dialogueFace.style.display = 'none'; }
      // タイプライタ表示
      dialogueText.textContent = '';
      const full = text || '';
      let i = 0, done = false;
      tapHint.style.visibility = 'hidden';
      const timer = setInterval(() => {
        i += 2; dialogueText.textContent = full.slice(0, i);
        if (i >= full.length) { clearInterval(timer); done = true; tapHint.style.visibility = 'visible'; }
      }, 18);
      const handler = (ev) => {
        ev.preventDefault();
        if (!done) { clearInterval(timer); dialogueText.textContent = full; done = true; tapHint.style.visibility = 'visible'; return; }
        cleanup(); resolve();
      };
      function cleanup() {
        dialogue.removeEventListener('pointerdown', handler);
        window.removeEventListener('keydown', keyHandler);
      }
      function keyHandler(e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'z' || e.key === 'Z') { e.preventDefault(); handler(e); }
      }
      dialogue.addEventListener('pointerdown', handler);
      window.addEventListener('keydown', keyHandler);
    });
  }
  function hideDialogue() { dialogue.classList.add('hidden'); }

  function drawFace(faceId) {
    // 小さなキャンバスに actor を描いて顔グラ代わりに
    let c = dialogueFace._canvas;
    if (!c) { c = document.createElement('canvas'); c.width = 64; c.height = 64; dialogueFace._canvas = c; dialogueFace.appendChild(c); }
    const ctx = c.getContext('2d'); ctx.clearRect(0, 0, 64, 64);
    ctx.imageSmoothingEnabled = false;
    if (Game.Gfx && Game.Gfx.ACTOR[faceId]) {
      Game.Gfx.drawActor(ctx, faceId, 8, 4, 56, { dir: 'down', frame: 0 });
    }
  }

  /* ---------- メニュー ---------- */
  function menu(title, options, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      menuBox.classList.remove('hidden');
      menuTitle.textContent = title || '';
      menuList.innerHTML = '';
      menuDesc.textContent = '';
      let cursor = 0;
      const btns = [];
      options.forEach((o, idx) => {
        const b = el('button', 'menu-item' + (o.disabled ? ' disabled' : ''), menuList);
        const lab = el('span', 'menu-item-label', b); lab.textContent = o.label;
        if (o.sub != null) { const s = el('span', 'menu-item-sub', b); s.textContent = o.sub; }
        b.addEventListener('pointerenter', () => { if (o.desc) menuDesc.textContent = o.desc; });
        b.addEventListener('pointerdown', (ev) => {
          ev.preventDefault();
          if (o.disabled) { Game.Audio.sfx('cancel'); return; }
          Game.Audio.sfx('confirm'); cleanup(); resolve(idx);
        });
        btns.push(b);
      });
      if (opts.cancelable) {
        const b = el('button', 'menu-item cancel', menuList);
        b.textContent = '↩ もどる';
        b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); Game.Audio.sfx('cancel'); cleanup(); resolve(-1); });
      }
      // キーボード操作
      function highlight() { btns.forEach((b, i) => b.classList.toggle('sel', i === cursor)); if (options[cursor] && options[cursor].desc) menuDesc.textContent = options[cursor].desc; }
      function keyHandler(e) {
        if (e.key === 'ArrowDown' || e.key === 's') { cursor = (cursor + 1) % options.length; highlight(); Game.Audio.sfx('cursor'); e.preventDefault(); }
        else if (e.key === 'ArrowUp' || e.key === 'w') { cursor = (cursor - 1 + options.length) % options.length; highlight(); Game.Audio.sfx('cursor'); e.preventDefault(); }
        else if (e.key === 'Enter' || e.key === ' ' || e.key === 'z') { if (!options[cursor].disabled) { Game.Audio.sfx('confirm'); cleanup(); resolve(cursor); } e.preventDefault(); }
        else if ((e.key === 'Escape' || e.key === 'x') && opts.cancelable) { Game.Audio.sfx('cancel'); cleanup(); resolve(-1); e.preventDefault(); }
      }
      function cleanup() { menuBox.classList.add('hidden'); window.removeEventListener('keydown', keyHandler); }
      highlight();
      window.addEventListener('keydown', keyHandler);
    });
  }
  function hideMenu() { menuBox.classList.add('hidden'); }

  /* ---------- 戦闘メッセージ（自動送り＋タップスキップ） ---------- */
  function battleMessage(text, ms) {
    return new Promise((resolve) => {
      dialogue.classList.remove('hidden');
      dialogueName.style.display = 'none';
      dialogueFace.style.display = 'none';
      dialogueText.textContent = text;
      tapHint.style.visibility = 'hidden';
      let done = false;
      const finish = () => { if (done) return; done = true; clearTimeout(timer); dialogue.removeEventListener('pointerdown', finish); resolve(); };
      const timer = setTimeout(finish, ms || 900);
      dialogue.addEventListener('pointerdown', finish);
    });
  }

  /* ---------- 戦闘ステータスバー ---------- */
  function battleStatus(allies, activeIndex) {
    statusBar.classList.remove('hidden');
    statusBar.innerHTML = '';
    allies.forEach((a, i) => {
      const card = el('div', 'st-card' + (i === activeIndex ? ' active' : '') + (a.alive ? '' : ' dead'), statusBar);
      el('div', 'st-name', card).textContent = a.name;
      const hpRow = el('div', 'st-row', card);
      el('span', 'st-lab', hpRow).textContent = 'HP';
      const hpBar = el('div', 'st-bar', hpRow);
      const hpFill = el('div', 'st-fill hp', hpBar);
      hpFill.style.width = Math.max(0, Math.min(100, a.hp / a.maxhp * 100)) + '%';
      if (a.hp / a.maxhp < 0.25) hpFill.classList.add('low');
      el('span', 'st-num', hpRow).textContent = a.hp + '/' + a.maxhp;
      const mpRow = el('div', 'st-row', card);
      el('span', 'st-lab', mpRow).textContent = 'MP';
      const mpBar = el('div', 'st-bar', mpRow);
      const mpFill = el('div', 'st-fill mp', mpBar);
      mpFill.style.width = Math.max(0, Math.min(100, a.mp / Math.max(1, a.maxmp) * 100)) + '%';
      el('span', 'st-num', mpRow).textContent = a.mp + '/' + a.maxmp;
    });
  }
  function hideBattleStatus() { statusBar.classList.add('hidden'); }

  /* ---------- ショップ ---------- */
  function shop(shopId) {
    return new Promise((resolve) => {
      const D = Game.Data;
      const items = D.SHOPS[shopId] || [];
      shopBox.classList.remove('hidden');
      function render() {
        shopBox.innerHTML = '';
        el('div', 'shop-title', shopBox).textContent = '🛒 どうぐ屋　所持金 ' + Game.state.gold + ' G';
        const list = el('div', 'shop-list', shopBox);
        items.forEach((id) => {
          const it = D.ITEMS[id];
          const row = el('button', 'shop-item' + (Game.state.gold < it.price ? ' disabled' : ''), list);
          el('span', 'shop-name', row).textContent = it.name;
          el('span', 'shop-desc', row).textContent = it.desc;
          el('span', 'shop-price', row).textContent = it.price + ' G';
          row.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            if (Game.state.gold < it.price) { Game.Audio.sfx('cancel'); return; }
            Game.state.gold -= it.price; Game.addItem(id, 1); Game.Audio.sfx('confirm');
            toast(it.name + ' を 買った!'); render();
          });
        });
        const close = el('button', 'shop-close', shopBox); close.textContent = 'とじる';
        close.addEventListener('pointerdown', (ev) => { ev.preventDefault(); Game.Audio.sfx('cancel'); shopBox.classList.add('hidden'); resolve(); });
      }
      render();
    });
  }

  /* ---------- トースト ---------- */
  let toastTimer = null;
  function toast(text) {
    toastEl.textContent = text; toastEl.classList.remove('hidden'); toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.classList.remove('show'); setTimeout(() => toastEl.classList.add('hidden'), 300); }, 1400);
  }

  /* ---------- 確認 ---------- */
  function confirm(text) {
    return new Promise((resolve) => {
      confirmBox.classList.remove('hidden');
      confirmBox.innerHTML = '';
      el('div', 'confirm-text', confirmBox).textContent = text;
      const row = el('div', 'confirm-row', confirmBox);
      const yes = el('button', 'btn primary', row); yes.textContent = 'はい';
      const no = el('button', 'btn', row); no.textContent = 'いいえ';
      const close = (v) => { confirmBox.classList.add('hidden'); resolve(v); };
      yes.addEventListener('pointerdown', (e) => { e.preventDefault(); Game.Audio.sfx('confirm'); close(true); });
      no.addEventListener('pointerdown', (e) => { e.preventDefault(); Game.Audio.sfx('cancel'); close(false); });
    });
  }

  /* ---------- 仮想パッド ---------- */
  function buildControls() {
    controls = el('div', 'controls hidden', root);
    const dpad = el('div', 'dpad', controls);
    ['up', 'left', 'right', 'down'].forEach((dir) => {
      const b = el('button', 'dpad-btn dpad-' + dir, dpad);
      b.dataset.dir = dir;
      b.textContent = ({ up: '▲', down: '▼', left: '◀', right: '▶' })[dir];
      const set = (v) => (ev) => { ev.preventDefault(); dpadDirs[dir] = v; };
      b.addEventListener('pointerdown', set(1));
      b.addEventListener('pointerup', set(0));
      b.addEventListener('pointerleave', set(0));
      b.addEventListener('pointercancel', set(0));
    });
    const right = el('div', 'action-cluster', controls);
    const menuBtn = el('button', 'act-btn menu-btn', right); menuBtn.textContent = '≡';
    menuBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); if (onButton) onButton('menu'); });
    const aBtn = el('button', 'act-btn a-btn', right); aBtn.textContent = '●';
    aBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); if (onButton) onButton('A'); });
  }
  function bindKeyboard() {
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
    window.addEventListener('keydown', (e) => {
      if (map[e.key]) { held[map[e.key]] = 1; }
      else if ((e.key === 'Enter' || e.key === ' ' || e.key === 'z') && onButton && controlsVisible) { onButton('A'); }
      else if ((e.key === 'Escape' || e.key === 'm' || e.key === 'x') && onButton && controlsVisible) { onButton('menu'); }
    });
    window.addEventListener('keyup', (e) => { if (map[e.key]) held[map[e.key]] = 0; });
  }
  let controlsVisible = false;
  function setControlsVisible(v) { controlsVisible = v; controls.classList.toggle('hidden', !v); }
  function heldDir() {
    return {
      x: (dpadDirs.right || held.right ? 1 : 0) - (dpadDirs.left || held.left ? 1 : 0),
      y: (dpadDirs.down || held.down ? 1 : 0) - (dpadDirs.up || held.up ? 1 : 0)
    };
  }
  function setButtonHandler(fn) { onButton = fn; }

  function hide() { hideMenu(); /* 会話は個別に */ }

  return {
    init, message, hideDialogue, menu, hideMenu, battleMessage,
    battleStatus, hideBattleStatus, shop, toast, confirm,
    setControlsVisible, heldDir, setButtonHandler, hide
  };
})();
