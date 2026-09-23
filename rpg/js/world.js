/* =====================================================================
 * world.js  :  オーバーワールド（探索）シーン
 *
 * engine が update(dt)/render(ctx,w,h) を呼ぶ。移動・会話・イベント・
 * エンカウント・マップ遷移・メインメニューを扱う。
 * バトルは await Game.startBattle(opts) で engine に委譲する。
 * ===================================================================== */

window.Game = window.Game || {};

Game.World = (function () {
  'use strict';
  const D = () => Game.Data;
  const G = () => Game.Gfx;
  const A = () => Game.Audio;
  const UI = () => Game.UI;

  let map = null, rows = [];
  let player = { tx: 0, ty: 0, dir: 'down', moving: false, prog: 0, fromX: 0, fromY: 0, frame: 0, animT: 0 };
  let cam = { x: 0, y: 0 };
  let tile = 24;              // 描画時のタイルpx（resizeで決定）
  const view = { w: 0, h: 0 };
  let busy = false;           // 会話/戦闘/遷移中は移動停止
  let stepsSinceEncounter = 0;
  let fade = 0, fadeDir = 0;  // 遷移フェード
  let time = 0;
  let npcAnimT = 0;
  let nameBanner = { text: '', t: 0 };  // マップ名の入場表示

  function isSolidTile(ch) { return D().SOLID.has(ch); }
  function tileAt(x, y) {
    if (y < 0 || y >= rows.length || x < 0 || x >= rows[y].length) return '#';
    return rows[y][x];
  }
  function npcAt(x, y) { return map.npcs.find((n) => n.tx === x && n.ty === y && !n.gone); }
  function walkable(x, y) {
    if (isSolidTile(tileAt(x, y))) return false;
    if (npcAt(x, y)) return false;
    return true;
  }

  function load(mapId, spawn, faceDir) {
    map = JSON.parse(JSON.stringify(D().MAPS[mapId])); // ディープコピー（NPC状態など）
    rows = map.rows;
    Game.state.currentMap = mapId;
    // NPC を tx/ty に正規化 & 既に加入済みなら消す
    map.npcs.forEach((n) => {
      n.tx = n.x; n.ty = n.y;
      if (n.joinable && Game.state.party.some((m) => m.id === n.joinable)) n.gone = true;
    });
    // 完了済みイベントを反映
    map.events.forEach((e) => { if (Game.state.flags['ev_' + e.id]) e.done = true; });
    const sp = spawn || map.spawn;
    player.tx = sp.x; player.ty = sp.y; player.moving = false; player.prog = 0;
    player.dir = faceDir || 'down';
    stepsSinceEncounter = 0;
    updateCamera(true);
    A().playBgm(map.bgm || 'field');
    UI().setControlsVisible(true);
    nameBanner = { text: map.name, t: 2.4 };
    // マップ移動ごとのオートセーブ（進行が消えにくいように）
    if (Game.state) Game.saveGame();
  }

  function resize(w, h) {
    view.w = w; view.h = h;
    // 見せるタイル数から算出（縦基準、収まるように）
    tile = Math.floor(Math.min(w / D().VIEW_TILES_X, h / D().VIEW_TILES_Y));
    tile = Math.max(16, tile);
    if (rows.length) updateCamera(true);
  }

  function updateCamera(snap) {
    if (!rows.length) return;
    const mapW = rows[0].length * tile, mapH = rows.length * tile;
    const px = player.tx * tile + (player.moving ? lerp(player.fromX, player.tx, player.prog) - player.tx : 0) * tile;
    // プレイヤーのピクセル中心
    const pcx = curPixelX() + tile / 2;
    const pcy = curPixelY() + tile / 2;
    let tx = pcx - view.w / 2;
    let ty = pcy - view.h / 2;
    if (mapW <= view.w) tx = (mapW - view.w) / 2; else tx = Math.max(0, Math.min(tx, mapW - view.w));
    if (mapH <= view.h) ty = (mapH - view.h) / 2; else ty = Math.max(0, Math.min(ty, mapH - view.h));
    if (snap) { cam.x = tx; cam.y = ty; }
    else { cam.x += (tx - cam.x) * 0.2; cam.y += (ty - cam.y) * 0.2; }
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function curPixelX() { return (player.moving ? lerp(player.fromX, player.tx, player.prog) : player.tx) * tile; }
  function curPixelY() { return (player.moving ? lerp(player.fromY, player.ty, player.prog) : player.ty) * tile; }

  const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const MOVE_DUR = 0.16;

  function update(dt) {
    time += dt; npcAnimT += dt;
    if (nameBanner.t > 0) nameBanner.t -= dt;
    if (fadeDir !== 0) { fade += fadeDir * dt * 3; if (fade >= 1) { fade = 1; fadeDir = 0; if (pendingWarp) doWarp(); } else if (fade <= 0) { fade = 0; fadeDir = 0; } }
    if (busy || fadeDir !== 0 || fade > 0.01) { updateCamera(false); return; }

    if (player.moving) {
      player.prog += dt / MOVE_DUR;
      player.animT += dt;
      player.frame = Math.floor(player.animT * 6) % 2;
      if (player.prog >= 1) {
        player.prog = 0; player.moving = false;
        onArrive();
      }
    } else {
      const d = UI().heldDir();
      if (d.x !== 0 || d.y !== 0) {
        // 斜めは縦優先
        let dir = d.y < 0 ? 'up' : d.y > 0 ? 'down' : (d.x < 0 ? 'left' : 'right');
        if (d.x !== 0 && d.y === 0) dir = d.x < 0 ? 'left' : 'right';
        player.dir = dir;
        const [dx, dy] = DIRV[dir];
        if (walkable(player.tx + dx, player.ty + dy)) {
          player.fromX = player.tx; player.fromY = player.ty;
          player.tx += dx; player.ty += dy; player.moving = true; player.prog = 0;
        } else { player.frame = 0; }
      } else { player.animT = 0; player.frame = 0; }
    }
    updateCamera(false);
  }

  function onArrive() {
    // 出口
    const ex = (map.exits || []).find((e) => e.x === player.tx && e.y === player.ty);
    if (ex) {
      if (ex.need && !Game.hasItem(ex.need)) {
        UI().toast('『' + D().ITEMS[ex.need].name + '』が 必要だ…');
        // 押し戻す
        player.tx = player.fromX; player.ty = player.fromY;
        return;
      }
      startWarp(ex); return;
    }
    // イベント
    const evt = (map.events || []).find((e) => e.x === player.tx && e.y === player.ty && !e.done);
    if (evt) { triggerEvent(evt); return; }
    // エンカウント
    if (map.encounter) {
      stepsSinceEncounter++;
      if (stepsSinceEncounter >= 2 && Math.random() < map.encounter.rate) {
        stepsSinceEncounter = 0; triggerEncounter();
      }
    }
  }

  /* ---------- 遷移 ---------- */
  let pendingWarp = null;
  function startWarp(ex) { busy = true; pendingWarp = ex; fadeDir = 1; A().sfx('door'); }
  function doWarp() {
    const ex = pendingWarp; pendingWarp = null;
    load(ex.to, { x: ex.tx, y: ex.ty }, ex.tx < 2 ? 'right' : ex.ty < 2 ? 'down' : 'up');
    fadeDir = -1;
    setTimeout(() => { busy = false; }, 260);
  }

  /* ---------- エンカウント ---------- */
  async function triggerEncounter() {
    busy = true;
    A().sfx('encounter');
    await flashScreen();
    const group = rollEncounterGroup();
    const result = await Game.startBattle({ enemies: group, boss: false, theme: map.bgm === 'dungeon' ? 'dungeon' : 'field' });
    afterBattle(result);
  }
  function rollEncounterGroup() {
    const enc = map.encounter;
    const total = enc.table.reduce((s, t) => s + t.weight, 0);
    const n = 1 + Math.floor(Math.random() * (enc.maxGroup || 2));
    const out = [];
    for (let i = 0; i < n; i++) {
      let r = Math.random() * total, pick = enc.table[0].enemy;
      for (const t of enc.table) { r -= t.weight; if (r <= 0) { pick = t.enemy; break; } }
      out.push(pick);
    }
    return out;
  }
  function afterBattle(result) {
    A().playBgm(map.bgm || 'field');
    if (result.wiped) { Game.gameOver(); return; }
    busy = false;
  }
  function flashScreen() {
    return new Promise((res) => { fade = 0; fadeDir = 1; const iv = setInterval(() => { if (fade >= 1) { clearInterval(iv); fade = 0; fadeDir = 0; res(); } }, 16); });
  }

  /* ---------- イベント ---------- */
  async function triggerEvent(evt) {
    busy = true;
    if (evt.type === 'chest') {
      A().sfx('item'); Game.addItem(evt.item, 1);
      markEvent(evt);
      await UI().message('宝箱を あけた! 『' + D().ITEMS[evt.item].name + '』を 手に入れた!', {});
      UI().hideDialogue();
      busy = false; return;
    }
    if (evt.story) {
      await runScript(evt.story);
      markEvent(evt);
    }
    UI().hideDialogue();
    busy = false;
  }
  function markEvent(evt) { evt.done = true; Game.state.flags['ev_' + evt.id] = true; }

  /* ---------- A（しらべる/はなす） ---------- */
  async function onAction() {
    if (busy) return;
    const [dx, dy] = DIRV[player.dir];
    const fx = player.tx + dx, fy = player.ty + dy;
    const npc = npcAt(fx, fy);
    if (npc) { await talk(npc); return; }
    // 正面の回復ポイント（星の泉など・繰り返し可）
    const heal = (map.events || []).find((e) => e.x === fx && e.y === fy && e.type === 'heal');
    if (heal) { await restAt(); return; }
    // 正面のイベント（祭壇など）
    const evt = (map.events || []).find((e) => e.x === fx && e.y === fy && !e.done && e.story);
    if (evt) { await triggerEvent(evt); }
  }

  async function restAt() {
    busy = true;
    A().sfx('heal');
    Game.fullHeal();
    await UI().message('星の泉に手をひたすと、あたたかな光がパーティを包んだ。\nHPとMPが かんぜんに かいふくした!', { name: '星の泉' });
    UI().hideDialogue();
    busy = false;
  }

  async function talk(npc) {
    busy = true;
    // NPC はプレイヤーの方を向く
    npc.dir = { up: 'down', down: 'up', left: 'right', right: 'left' }[player.dir] || 'down';
    await runScript(npc.story);
    UI().hideDialogue();
    busy = false;
  }

  /* ---------- スクリプト実行 ---------- */
  async function runScript(key) {
    const steps = Game.Story.getScript(key, Game.state);
    await runSteps(steps);
  }
  async function runSteps(steps) {
    for (const step of steps) {
      if (step.text != null) {
        await UI().message(step.text, { name: step.name, face: step.face });
      } else if (step.do === 'join') {
        Game.joinParty(step.who); A().sfx('levelup');
        markNpcJoined(step.who);
      } else if (step.do === 'shop') {
        UI().hideDialogue(); await UI().shop(step.shop);
      } else if (step.do === 'give') {
        Game.addItem(step.item, 1); A().sfx('item');
      } else if (step.do === 'flag') {
        Game.state.flags[step.flag] = true;
      } else if (step.do === 'heal') {
        Game.fullHeal();
      } else if (step.do === 'boss') {
        UI().hideDialogue();
        const result = await Game.startBattle({ enemies: [step.enemy], boss: true, theme: 'dungeon' });
        A().playBgm(map.bgm || 'field');
        if (result.wiped) { Game.gameOver(); return; }
        if (result.fled) { return; } // ボスは逃走不可なので通常来ない
        if (step.flag) Game.state.flags[step.flag] = true;
        if (step.reward) { Game.addItem(step.reward, 1); }
        if (step.afterKey) { await runScript(step.afterKey); }
      } else if (step.do === 'ending') {
        Game.reachEnding();
        return;
      } else if (step.do === 'warp') {
        startWarp({ to: step.to, tx: step.tx, ty: step.ty });
        return;
      }
    }
  }
  function markNpcJoined(id) {
    if (map && map.npcs) { const n = map.npcs.find((x) => x.joinable === id); if (n) n.gone = true; }
  }

  /* ---------- メインメニュー ---------- */
  async function openMenu() {
    if (busy) return;
    busy = true;
    let open = true;
    while (open) {
      const idx = await UI().menu('メニュー', [
        { label: '👤 つよさ' },
        { label: '🜂 どうぐ', disabled: usableItemCount() === 0 },
        { label: '💾 セーブ' },
        { label: (A().isMuted() ? '🔇 サウンド OFF' : '🔊 サウンド ON') },
        { label: '↩ とじる' }
      ], { cancelable: true });
      if (idx === -1 || idx === 4) open = false;
      else if (idx === 0) await showStatus();
      else if (idx === 1) await useItemMenu();
      else if (idx === 2) { Game.saveGame(); UI().toast('セーブしました'); }
      else if (idx === 3) { A().toggle(); A().init(); if (!A().isMuted()) A().playBgm(map.bgm || 'field'); }
    }
    UI().hideMenu();
    busy = false;
  }
  function usableItemCount() {
    const inv = Game.state.inventory;
    return Object.keys(inv).reduce((n, k) => {
      const t = D().ITEMS[k].type; return n + ((t === 'heal' || t === 'mpheal' || t === 'revive') && inv[k] > 0 ? inv[k] : 0);
    }, 0);
  }
  async function showStatus() {
    let viewing = true;
    while (viewing) {
      const opts = Game.state.party.map((h) => ({
        label: h.name + '  Lv' + h.level,
        sub: 'HP ' + h.hp + '/' + h.maxhp
      }));
      const idx = await UI().menu('つよさ　所持金 ' + Game.state.gold + 'G', opts, { cancelable: true });
      if (idx === -1) { viewing = false; break; }
      const h = Game.state.party[idx];
      const skills = h.skills.map((s) => D().SKILLS[s].name).join('、') || 'なし';
      const nextExp = D().expForLevel(h.level + 1) - h.exp;
      await UI().message(
        h.name + '　Lv' + h.level + '\n' +
        'HP ' + h.hp + '/' + h.maxhp + '　MP ' + h.mp + '/' + h.maxmp + '\n' +
        'ちから ' + h.atk + '　まもり ' + h.def + '　まりょく ' + h.mag + '　すばやさ ' + h.spd + '\n' +
        'つぎのLvまで ' + Math.max(0, nextExp) + '\n' +
        'とくぎ: ' + skills, { name: h.name });
      UI().hideDialogue();
    }
  }
  async function useItemMenu() {
    let open = true;
    while (open) {
      const inv = Game.state.inventory;
      const ids = Object.keys(inv).filter((k) => { const t = D().ITEMS[k].type; return inv[k] > 0 && (t === 'heal' || t === 'mpheal' || t === 'revive'); });
      if (ids.length === 0) { open = false; break; }
      const idx = await UI().menu('どうぐ（フィールド）', ids.map((id) => {
        const it = D().ITEMS[id]; return { label: it.name, sub: '×' + inv[id], desc: it.desc };
      }), { cancelable: true });
      if (idx === -1) { open = false; break; }
      const it = D().ITEMS[ids[idx]];
      // 対象選択
      const targetIdx = await UI().menu('だれに?', Game.state.party.map((h) => ({
        label: h.name, sub: 'HP ' + h.hp + '/' + h.maxhp
      })), { cancelable: true });
      if (targetIdx === -1) continue;
      const h = Game.state.party[targetIdx];
      let used = true;
      if (it.type === 'heal') { if (h.hp <= 0) { UI().toast('戦闘不能には使えない'); used = false; } else { h.hp = Math.min(h.maxhp, h.hp + it.power); } }
      else if (it.type === 'mpheal') { h.mp = Math.min(h.maxmp, h.mp + it.power); }
      else if (it.type === 'revive') { if (h.hp > 0) { UI().toast('たおれていない'); used = false; } else h.hp = Math.round(h.maxhp * it.power); }
      if (used) { inv[it.id]--; A().sfx('item'); UI().toast(it.name + ' をつかった'); }
    }
    UI().hideMenu();
  }

  /* ---------- 描画 ---------- */
  function render(ctx, w, h) {
    if (view.w !== w || view.h !== h) resize(w, h);
    ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, w, h);
    const x0 = Math.floor(cam.x / tile), y0 = Math.floor(cam.y / tile);
    const x1 = Math.ceil((cam.x + w) / tile), y1 = Math.ceil((cam.y + h) / tile);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const ch = tileAt(x, y);
        G().drawTile(ctx, ch, Math.round(x * tile - cam.x), Math.round(y * tile - cam.y), tile, { gx: x, gy: y });
      }
    }
    // NPC
    const frame = Math.floor(npcAnimT * 2) % 2;
    map.npcs.forEach((n) => {
      if (n.gone) return;
      G().drawActor(ctx, n.sprite, Math.round(n.tx * tile - cam.x), Math.round(n.ty * tile - cam.y + (tile - actorSize())), actorSize(), { dir: n.dir, frame: frame });
      // 頭上マーク（話せる相手）
      if (n.story) {
        ctx.fillStyle = 'rgba(255,220,90,' + (0.5 + 0.4 * Math.sin(time * 4)) + ')';
        ctx.font = 'bold ' + Math.round(tile * 0.5) + 'px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('!', Math.round(n.tx * tile - cam.x + tile / 2), Math.round(n.ty * tile - cam.y - tile * 0.1));
      }
    });
    // イベント（宝箱など未取得）
    (map.events || []).forEach((e) => {
      if (e.marker && !e.done) {
        // 回復ポイント等の目印：ゆらめく星のきらめき
        const ex = Math.round(e.x * tile - cam.x + tile / 2);
        const ey = Math.round(e.y * tile - cam.y + tile / 2);
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.4 * Math.sin(time * 3);
        ctx.fillStyle = '#bfe0ff';
        G().star(ctx, ex, ey - tile * 0.2, tile * 0.28, tile * 0.12, 4);
        ctx.restore();
      }
    });
    // プレイヤー
    const psize = actorSize();
    const pdx = Math.round(curPixelX() - cam.x);
    const pdy = Math.round(curPixelY() - cam.y + (tile - psize));
    G().drawActor(ctx, 'lio', pdx, pdy, psize, { dir: player.dir, frame: player.moving ? player.frame : 0 });

    // 暗いマップのビネット
    if (map.dark) {
      const cx = pdx + psize / 2, cy = pdy + psize / 2;
      const g = ctx.createRadialGradient(cx, cy, tile * 1.5, cx, cy, tile * 5);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,10,0.82)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    // マップ名（入場時にフェードは省略、常時上部に薄く）
    // フェード
    if (fade > 0) { ctx.fillStyle = 'rgba(0,0,0,' + fade + ')'; ctx.fillRect(0, 0, w, h); }
    // マップ名バナー
    if (nameBanner.t > 0) {
      const a = Math.min(1, nameBanner.t) * Math.min(1, (2.4 - nameBanner.t) * 3);
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      const bw = Math.min(w * 0.7, 320), bh = 44, bx = (w - bw) / 2, by = h * 0.08;
      ctx.fillStyle = 'rgba(8,10,26,0.86)';
      ctx.strokeStyle = 'rgba(120,150,255,0.6)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(bx, by, bw, bh); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffd66a';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(nameBanner.text, w / 2, by + bh / 2);
      ctx.restore();
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
  }
  function actorSize() { return Math.round(tile * 1.3); }

  function enter() { UI().setControlsVisible(true); if (map) A().playBgm(map.bgm || 'field'); }
  function leave() { UI().setControlsVisible(false); }
  function isBusy() { return busy; }
  function mapName() { return map ? map.name : ''; }

  function pos() { return { tx: player.tx, ty: player.ty, map: map && map.id, busy: busy, moving: player.moving }; }

  return { load, update, render, resize, onAction, openMenu, enter, leave, isBusy, mapName, pos };
})();
