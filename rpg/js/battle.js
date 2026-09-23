/* =====================================================================
 * battle.js  :  ターン制コマンドバトル（シーン）
 *
 * engine が毎フレーム update(dt)/render(ctx,w,h) を呼ぶ。
 * Battle.begin({ enemies:[id...], boss, theme, onEnd(result) }) で開始。
 * result = { victory, fled, wiped }
 * 経験値・ゴールド・レベルアップ・ドロップ・アイテム消費は Battle 内で state に反映。
 * ===================================================================== */

window.Game = window.Game || {};

Game.Battle = (function () {
  'use strict';
  const D = () => Game.Data;
  const G = () => Game.Gfx;
  const A = () => Game.Audio;
  const UI = () => Game.UI;

  let active = false;
  let onEnd = null;
  let isBoss = false;
  let theme = 'field';
  let allies = [], enemies = [], all = [];
  let particles = null;
  let time = 0;
  let shake = 0;
  let flashColor = null, flashAlpha = 0;
  let bannerText = '', bannerT = 0;
  const view = { w: 0, h: 0 };

  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function rand(a, b) { return a + Math.random() * (b - a); }

  function makeAllyCombatant(hero) {
    return {
      side: 'ally', hero, name: hero.name, battler: D().HEROES[hero.id].battler,
      get hp() { return hero.hp; }, set hp(v) { hero.hp = v; },
      get mp() { return hero.mp; }, set mp(v) { hero.mp = v; },
      maxhp: hero.maxhp, maxmp: hero.maxmp,
      atk: hero.atk, def: hero.def, mag: hero.mag, spd: hero.spd,
      skills: hero.skills.slice(),
      get alive() { return hero.hp > 0; },
      guard: false, buffs: [], stunned: false,
      x: 0, y: 0, offx: 0, offy: 0, flash: 0
    };
  }
  function makeEnemyCombatant(id, idx, total) {
    const e = D().ENEMIES[id];
    return {
      side: 'enemy', id, name: e.name, def0: e, sprite: e.sprite, boss: !!e.boss,
      hp: e.hp, maxhp: e.hp, mp: e.mp, maxmp: e.mp,
      atk: e.atk, def: e.def, mag: e.mag, spd: e.spd,
      exp: e.exp, gold: e.gold, drops: e.drops || [], skills: (e.skills || []).slice(),
      alive: true, guard: false, buffs: [], stunned: false,
      x: 0, y: 0, offx: 0, offy: 0, flash: 0, idx, total, dispName: e.name
    };
  }

  /* -------- 属性相性（battle.js 内で定義。data.js は変更しない） --------
   * weak … その属性で こうかばつぐん(×1.6) / resist … いまひとつ(×0.5)
   * キーは敵ID。味方は id を持たないため常に等倍で安全。 */
  const AFFINITY = {
    slime:    { weak: ['fire'],    resist: [] },
    bat:      { weak: ['light'],   resist: [] },
    wolf:     { weak: ['fire'],    resist: [] },
    wisp:     { weak: ['light'],   resist: ['dark'] },
    golem:    { weak: ['thunder'], resist: ['earth', 'fire'] },
    shade:    { weak: ['light'],   resist: ['dark'] },
    revenant: { weak: ['light'],   resist: ['dark'] },
    warden:   { weak: ['thunder'], resist: ['earth'] },
    nox:      { weak: ['light'],   resist: ['dark'] }
  };
  function affinityMult(target, element) {
    if (!element || element === 'none') return 1;
    const a = AFFINITY[target.id];
    if (!a) return 1;
    if (a.weak && a.weak.indexOf(element) >= 0) return 1.6;
    if (a.resist && a.resist.indexOf(element) >= 0) return 0.5;
    return 1;
  }

  /* -------- 陣営ヘルパ（詠唱者から見た敵/味方を返す） -------- */
  function foesOf(c) { return c.side === 'ally' ? enemies : allies; }
  function friendsOf(c) { return c.side === 'ally' ? allies : enemies; }
  // 単体攻撃対象が死んでいたら生存者へ取り直す
  function validFoe(caster, target) {
    if (target && target.alive) return target;
    const pool = foesOf(caster).filter((c) => c.alive);
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }
  // 回復系対象が死んでいたら最も瀕死の生存者へ取り直す（蘇生は含めない）
  function neediestFriend(caster) {
    const pool = friendsOf(caster).filter((c) => c.alive);
    if (!pool.length) return null;
    return pool.reduce((a, b) => (b.hp / b.maxhp < a.hp / a.maxhp ? b : a));
  }

  function layout() {
    // 敵配置（上半分）
    const n = enemies.length;
    enemies.forEach((e, i) => {
      const spread = view.w / (n + 1);
      e.baseX = spread * (i + 1) - view.w * 0.09;
      e.baseY = view.h * (0.22 + (i % 2) * 0.06);
      e.size = e.boss ? view.w * 0.42 : view.w * 0.18;
      if (e.boss) { e.baseX = view.w * 0.5 - e.size / 2; e.baseY = view.h * 0.14; }
    });
    // 味方配置（右下寄り、横向き）
    allies.forEach((a, i) => {
      a.baseX = view.w * (0.62 + (i % 2) * 0.12);
      a.baseY = view.h * (0.5 + i * 0.1);
      a.size = view.w * 0.16;
    });
  }

  function begin(opts) {
    active = true; onEnd = opts.onEnd; isBoss = !!opts.boss;
    theme = opts.theme || 'field';
    particles = new (G().Particles)();
    time = 0; shake = 0; flashAlpha = 0; bannerT = 0;
    allies = Game.state.party.map(makeAllyCombatant);
    const list = opts.enemies || ['slime'];
    // 同名の敵に A/B/C を付ける
    const counts = {};
    enemies = list.map((id, i) => makeEnemyCombatant(id, i, list.length));
    const nameCount = {};
    enemies.forEach((e) => { nameCount[e.name] = (nameCount[e.name] || 0) + 1; });
    const seen = {};
    enemies.forEach((e) => {
      if (nameCount[e.name] > 1) {
        seen[e.name] = (seen[e.name] || 0) + 1;
        e.dispName = e.name + ' ' + String.fromCharCode(64 + seen[e.name]);
      }
    });
    all = allies.concat(enemies);
    A().playBgm(isBoss ? 'boss' : 'battle');
    UI().battleStatus(allies);
    runBattle();
  }

  function resize(w, h) { view.w = w; view.h = h; if (active) layout(); }

  /* -------- メインループ（async） -------- */
  async function runBattle() {
    layout();
    banner((isBoss ? '★ ' : '') + enemies.map((e) => e.dispName).join('・') + ' が あらわれた!');
    if (isBoss) A().sfx('encounter');
    await wait(1100);
    let round = 0;
    while (active) {
      round++;
      // 生存確認
      if (enemies.every((e) => !e.alive)) { await victory(); return; }
      if (allies.every((a) => !a.alive)) { await defeat(); return; }
      // ラウンド開始：バフ/ガード解除
      all.forEach((c) => { c.guard = false; });
      // コマンド入力
      const actions = await inputPhase();
      if (actions === 'flee') { if (await tryFlee()) return; else continue; }
      // 敵の行動決定（ひるみ中の敵も列に入れ、解決時に解除する）
      enemies.forEach((e) => { if (e.alive) actions.push(enemyDecide(e)); });
      // 速度順（イニシアチブを一度だけ確定させて安定ソート／ぼうぎょは最優先で先に発動）
      actions.forEach((a) => { a._init = a.type === 'guard' ? 9999 : (a.actor.spd + rand(-2, 2)); });
      actions.sort((x, y) => y._init - x._init);
      // 解決
      for (const act of actions) {
        if (!active) return;
        if (!act.actor.alive) continue;
        if (act.actor.stunned) { act.actor.stunned = false; await showMsg(act.actor.name + ' はひるんでいる!'); continue; }
        await resolveAction(act);
        tickBuffs(act.actor);
        if (enemies.every((e) => !e.alive)) { await victory(); return; }
        if (allies.every((a) => !a.alive)) { await defeat(); return; }
      }
      UI().battleStatus(allies);
    }
  }

  /* -------- コマンド入力 -------- */
  async function inputPhase() {
    const queue = [];
    for (let i = 0; i < allies.length; i++) {
      const me = allies[i];
      if (!me.alive) continue;
      let done = false;
      while (!done) {
        UI().battleStatus(allies, i);
        const cmd = await UI().menu(me.name + ' の こうどう', [
          { label: '⚔ たたかう' },
          { label: '✦ とくぎ', disabled: me.skills.length === 0 },
          { label: '🜂 どうぐ', disabled: invCount() === 0 },
          { label: '🛡 ぼうぎょ' },
          { label: '🏃 にげる' }
        ], { cancelable: i > 0 });
        if (cmd === -1) { // 戻る
          // ひとつ前の生存キャラへ
          let j = i - 1; while (j >= 0 && !allies[j].alive) j--;
          if (j >= 0) { queue.pop(); i = j - 1; }
          done = true; break;
        }
        if (cmd === 0) { const t = await chooseEnemy(); if (t) { queue.push({ actor: me, type: 'attack', target: t }); done = true; } }
        else if (cmd === 1) { const a = await chooseSkill(me); if (a) { queue.push(a); done = true; } }
        else if (cmd === 2) { const a = await chooseItem(me); if (a) { queue.push(a); done = true; } }
        else if (cmd === 3) { queue.push({ actor: me, type: 'guard' }); done = true; }
        else if (cmd === 4) { return 'flee'; }
      }
    }
    return queue;
  }

  async function chooseEnemy() {
    const living = enemies.filter((e) => e.alive);
    if (living.length === 1) return living[0];
    const idx = await UI().menu('だれに?', living.map((e) => ({ label: e.dispName })), { cancelable: true });
    if (idx === -1) return null;
    return living[idx];
  }
  async function chooseAlly(includeDead) {
    const living = allies.filter((a) => includeDead ? true : a.alive);
    const idx = await UI().menu('だれに?', living.map((a) => ({
      label: a.name + (a.alive ? '' : '（戦闘不能）'), sub: 'HP ' + a.hp + '/' + a.maxhp
    })), { cancelable: true });
    if (idx === -1) return null;
    return living[idx];
  }
  async function chooseSkill(me) {
    const opts = me.skills.map((sid) => {
      const s = D().SKILLS[sid];
      return { label: s.name, sub: 'MP ' + s.cost, disabled: me.mp < s.cost, desc: s.desc };
    });
    const idx = await UI().menu('とくぎ', opts, { cancelable: true });
    if (idx === -1) return null;
    const s = D().SKILLS[me.skills[idx]];
    let target = null;
    if (s.target === 'enemy') { target = await chooseEnemy(); if (!target) return null; }
    else if (s.target === 'ally') { target = await chooseAlly(s.type === 'revive'); if (!target) return null; }
    return { actor: me, type: 'skill', skill: s, target };
  }
  async function chooseItem(me) {
    const inv = Game.state.inventory;
    const ids = Object.keys(inv).filter((k) => inv[k] > 0 && D().ITEMS[k].type !== 'key');
    if (ids.length === 0) { await showMsg('つかえる どうぐが ない。'); return null; }
    const idx = await UI().menu('どうぐ', ids.map((id) => {
      const it = D().ITEMS[id]; return { label: it.name, sub: '×' + inv[id], desc: it.desc };
    }), { cancelable: true });
    if (idx === -1) return null;
    const it = D().ITEMS[ids[idx]];
    let target = null;
    if (it.type === 'offense') { target = await chooseEnemy(); if (!target) return null; }
    else { target = await chooseAlly(it.type === 'revive'); if (!target) return null; }
    return { actor: me, type: 'item', item: it, target };
  }
  function invCount() {
    const inv = Game.state.inventory;
    return Object.keys(inv).reduce((n, k) => n + (D().ITEMS[k].type !== 'key' ? inv[k] : 0), 0);
  }

  /* -------- 行動解決 -------- */
  async function resolveAction(act) {
    const me = act.actor;
    if (act.type === 'guard') {
      me.guard = true;
      await showMsg(me.name + ' は 身を守っている。', 500);
      return;
    }
    if (act.type === 'attack') {
      const t = validFoe(me, act.target);
      if (!t) return;
      act.target = t;
      await lunge(me, t);
      A().sfx('hit');
      const dmg = physDamage(me, t);
      applyDamage(t, dmg);
      hitFx(t, '#ffd24a');
      await showMsg(me.name + ' の こうげき! ' + t.name + ' に ' + dmg + ' のダメージ!' + (t._crit ? ' 会心の一撃!' : ''), 650);
      return;
    }
    if (act.type === 'skill') {
      const s = act.skill;
      if (me.side === 'ally' && me.mp < s.cost) { await showMsg(me.name + ' は MPが たりない!'); return; }
      me.mp = Math.max(0, me.mp - s.cost);
      await castFx(me, s);
      await applySkill(me, s, act.target);
      return;
    }
    if (act.type === 'item') {
      const it = act.item;
      Game.state.inventory[it.id] = Math.max(0, (Game.state.inventory[it.id] || 0) - 1);
      A().sfx('item');
      await applyItem(me, it, act.target);
      UI().battleStatus(allies);
      return;
    }
  }

  async function applySkill(me, s, target) {
    A().sfx(s.type === 'heal' ? 'heal' : (s.type === 'magic' ? 'magic' : 'slash'));
    if (s.type === 'phys') {
      let targets = s.target === 'all-enemy' ? foesOf(me).filter((c) => c.alive) : [validFoe(me, target)];
      targets = targets.filter(Boolean);
      if (!targets.length) { await showMsg('しかし 対象がいなかった。', 500); return; }
      for (const t of targets) {
        const mult = affinityMult(t, s.element);
        const dmg = Math.max(1, Math.round(physDamage(me, t) * s.power * mult));
        t._eff = mult > 1 ? 'weak' : (mult < 1 ? 'resist' : null);
        applyDamage(t, dmg);
        hitFx(t, s.element && s.element !== 'none' ? elementColor(s.element) : '#ffe08a');
        if (s.element && s.element !== 'none') elementBurst(t, s.element);
      }
      const stunned = applyStun(targets, s);
      shake = 8;
      await showMsg(me.name + ' の ' + s.name + '! ' + msgTargets(targets) + effSuffix(targets) + (stunned ? ' ひるませた!' : ''), 750);
    } else if (s.type === 'magic') {
      let targets = s.target === 'all-enemy' ? foesOf(me).filter((c) => c.alive) : [validFoe(me, target)];
      targets = targets.filter(Boolean);
      if (!targets.length) { await showMsg('しかし 対象がいなかった。', 500); return; }
      let total = 0;
      for (const t of targets) {
        const dmg = magicDamage(me, t, s);
        applyDamage(t, dmg); total += dmg;
        hitFx(t, elementColor(s.element));
        elementBurst(t, s.element);
      }
      if (s.drain) { const gain = Math.round(total * 0.5); me.hp = Math.min(me.maxhp, me.hp + gain); healFx(me); spawnHealNumber(me, gain); }
      shake = 6;
      await showMsg(me.name + ' は ' + s.name + ' を となえた! ' + msgTargets(targets) + effSuffix(targets), 750);
    } else if (s.type === 'heal') {
      const primary = (target && target.alive) ? target : neediestFriend(me);
      const targets = s.target === 'all-ally' ? friendsOf(me).filter((c) => c.alive) : [primary].filter(Boolean);
      if (!targets.length) { await showMsg('しかし 対象がいなかった。', 500); return; }
      for (const t of targets) {
        const heal = Math.round(s.power + me.mag * 0.6);
        const before = t.hp;
        t.hp = Math.min(t.maxhp, t.hp + heal); healFx(t); spawnHealNumber(t, t.hp - before);
      }
      await showMsg(me.name + ' の ' + s.name + '! HPが かいふくした!', 700);
      UI().battleStatus(allies);
    } else if (s.type === 'revive') {
      let t = (target && target.hp <= 0) ? target : friendsOf(me).filter((c) => c.hp <= 0)[0];
      if (t) {
        t.hp = Math.round(t.maxhp * (s.power || 0.5)); healFx(t); spawnHealNumber(t, t.hp);
        await showMsg(t.name + ' が いきをふきかえした!', 750);
      } else { await showMsg('しかし なにも おこらなかった。', 600); }
      UI().battleStatus(allies);
    } else if (s.type === 'buff') {
      applyBuff(me, s, target);
      await showMsg(me.name + ' の ' + s.name + '!', 600);
    }
  }
  // ひるみ付与（shieldBash 等の s.stun 確率）
  function applyStun(targets, s) {
    if (!s.stun) return false;
    let any = false;
    targets.forEach((t) => { if (t.alive && Math.random() < s.stun) { t.stunned = true; any = true; } });
    return any;
  }
  // こうかばつぐん/いまひとつ の一言
  function effSuffix(targets) {
    if (targets.some((t) => t._eff === 'weak')) return ' こうかは ばつぐんだ!';
    if (targets.length && targets.every((t) => t._eff === 'resist')) return ' こうかは いまひとつだ…';
    return '';
  }

  function applyBuff(me, s, target) {
    if (s.taunt) { me.taunt = s.taunt; }
    if (s.selfBuff) { me.buffs.push(Object.assign({ stat: 'atk' }, s.selfBuff)); }
    if (s.buff) {
      const targets = s.target === 'all-ally' ? friendsOf(me).filter((a) => a.alive)
        : s.target === 'self' ? [me] : [(target && target.alive) ? target : me];
      targets.forEach((t) => t.buffs.push({ stat: 'def', def: s.buff.def, turns: s.buff.turns }));
    }
  }
  function tickBuffs(actor) {
    if (actor.taunt) actor.taunt--;
    actor.buffs = actor.buffs.filter((b) => { b.turns--; return b.turns > 0; });
  }
  function defMult(c) {
    let m = 1;
    c.buffs.forEach((b) => { if (b.def) m *= (1 - b.def); });
    return m;
  }
  function atkMult(c) {
    let m = 1;
    c.buffs.forEach((b) => { if (b.atk) m *= (1 + b.atk); });
    return m;
  }

  async function applyItem(me, it, target) {
    if (it.type === 'heal') {
      const t = (target && target.alive) ? target : neediestFriend(me);
      if (!t) { await showMsg('しかし 対象がいなかった。', 500); return; }
      const before = t.hp; t.hp = Math.min(t.maxhp, t.hp + it.power); healFx(t); spawnHealNumber(t, t.hp - before);
      await showMsg(me.name + ' は ' + it.name + ' をつかった! ' + t.name + ' のHPが かいふく!', 700);
    } else if (it.type === 'mpheal') {
      const t = (target && target.alive) ? target : friendsOf(me).filter((c) => c.alive)[0];
      if (!t) { await showMsg('しかし 対象がいなかった。', 500); return; }
      t.mp = Math.min(t.maxmp, t.mp + it.power);
      await showMsg(me.name + ' は ' + it.name + ' をつかった! ' + t.name + ' のMPが かいふく!', 700);
    } else if (it.type === 'revive') {
      let t = (target && target.hp <= 0) ? target : friendsOf(me).filter((c) => c.hp <= 0)[0];
      if (t) { t.hp = Math.round(t.maxhp * it.power); healFx(t); spawnHealNumber(t, t.hp);
        await showMsg(t.name + ' が よみがえった!', 700); } else await showMsg('しかし なにも おこらなかった。', 600);
    } else if (it.type === 'offense') {
      const t = validFoe(me, target);
      if (!t) { await showMsg('しかし 対象がいなかった。', 500); return; }
      const mult = affinityMult(t, it.element);
      const dmg = Math.max(1, Math.round((it.power + rand(-8, 8)) * mult));
      t._eff = mult > 1 ? 'weak' : (mult < 1 ? 'resist' : null);
      applyDamage(t, dmg);
      hitFx(t, elementColor(it.element)); elementBurst(t, it.element); shake = 6;
      await showMsg(me.name + ' は ' + it.name + ' をなげた! ' + t.name + ' に ' + dmg + ' のダメージ!' + effSuffix([t]), 700);
    }
  }

  function msgTargets(targets) {
    return targets.map((t) => t.name + ' に ' + (t._lastDmg || 0)).join('、') + ' のダメージ!';
  }

  /* -------- ダメージ計算 -------- */
  function physDamage(att, def) {
    let base = att.atk * atkMult(att) * 1.0 - def.def * defMult(def) * 0.5;
    base *= rand(0.88, 1.12);
    let crit = false;
    // 会心：味方はやや高め＆爽快に、敵は控えめにして理不尽な即死を避ける
    const critRate = att.side === 'ally' ? 0.11 : 0.06;
    const critMul = att.side === 'ally' ? 1.8 : 1.5;
    if (Math.random() < critRate) { base *= critMul; crit = true; }
    if (def.guard) base *= 0.5;
    const dmg = Math.max(1, Math.round(base));
    def._crit = crit;
    return dmg;
  }
  function magicDamage(att, def, s) {
    let base = att.mag * s.power - def.def * defMult(def) * 0.2;
    base *= rand(0.9, 1.1);
    const mult = affinityMult(def, s.element);
    base *= mult;
    def._eff = mult > 1 ? 'weak' : (mult < 1 ? 'resist' : null);
    def._crit = false;
    if (def.guard) base *= 0.6;
    return Math.max(1, Math.round(base));
  }
  function applyDamage(target, dmg) {
    target._lastDmg = dmg;
    const was = target.hp;
    target.hp = Math.max(0, target.hp - dmg);
    spawnDamageNumber(target, dmg, target._crit);
    if (target._crit) shake = Math.max(shake, 10);
    if (target.hp <= 0) {
      if (target.side === 'enemy' && target.alive) {
        // 撃破演出：閃光＋粒子＋フェード
        target.alive = false;
        target.dying = 0.7;
        particles.spawn({ x: target.baseX + target.size / 2, y: target.baseY + target.size / 2,
          count: 26, speed: 170, life: 0.7, col: ['#ffffff', '#b8c4ff', '#6a80ff'], size: 5, grav: 40 });
        flash('#ffffff', 0.22);
      } else if (target.side === 'ally' && was > 0) {
        // 味方戦闘不能演出
        target.flash = 0.5;
        particles.spawn({ x: target.baseX + target.size / 2, y: target.baseY + target.size / 2,
          count: 14, speed: 90, life: 0.55, col: ['#ff6a6a', '#803030'], size: 4, grav: 60 });
      }
    }
  }

  /* -------- 敵AI -------- */
  // 状況に応じた狙い：挑発最優先→瀕死のとどめ→賢い敵は柔らかい魔法役を優先
  function chooseAITarget(e) {
    const foes = allies.filter((a) => a.alive);
    if (!foes.length) return null;
    const taunter = foes.find((a) => a.taunt > 0);
    if (taunter) return taunter;
    const smart = e.boss || e.mag >= 18; // 賢い敵：術者や柔らかい相手を狙う
    const scored = foes.map((a) => {
      let w = 1;
      const hpr = a.hp / a.maxhp;
      if (hpr < 0.3) w += 2.6;        // とどめを狙う
      else if (hpr < 0.6) w += 0.8;
      if (smart) { w += a.mag * 0.05; w += Math.max(0, 12 - a.def) * 0.08; }
      return { a, w };
    });
    const total = scored.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    for (const x of scored) { r -= x.w; if (r <= 0) return x.a; }
    return scored[scored.length - 1].a;
  }
  // 通常敵のスキル選択：自己強化済みなら再強化を避け、単体戦では全体技を避ける
  function pickEnemySkill(e, foeCount) {
    let ids = e.skills.slice();
    if (e.buffs.some((b) => b.atk)) {
      const f = ids.filter((id) => !D().SKILLS[id].selfBuff);
      if (f.length) ids = f;
    }
    if (foeCount < 2) {
      const f = ids.filter((id) => D().SKILLS[id].target !== 'all-enemy');
      if (f.length) ids = f;
    }
    return ids[Math.floor(Math.random() * ids.length)];
  }
  // ボスAI：HPフェーズで強技の使いどころを変える
  function bossDecide(e, target, foeCount) {
    const hpr = e.hp / e.maxhp;
    const has = (id) => e.skills.indexOf(id) >= 0;
    const r = Math.random();
    // 2割は通常攻撃で緩急をつける
    if (r < 0.2) return { actor: e, type: 'attack', target };
    let sid = null;
    if (hpr < 0.4 && has('e_devour') && Math.random() < 0.55) sid = 'e_devour';          // 追い詰められたら大技連発
    else if (has('e_starfall') && foeCount >= 2 && Math.random() < 0.45) sid = 'e_starfall'; // 複数居れば全体技
    else if (hpr < 0.7 && has('e_drain') && Math.random() < 0.45) sid = 'e_drain';        // 中盤は吸収で粘る
    else if (has('e_darkball')) sid = 'e_darkball';
    else sid = e.skills[Math.floor(Math.random() * e.skills.length)];
    const s = D().SKILLS[sid];
    // 強化技を持つボス（守番など）：強化済みなら通常攻撃に切替
    if (s.selfBuff && e.buffs.some((b) => b.atk)) return { actor: e, type: 'attack', target };
    return { actor: e, type: 'skill', skill: s, target: s.target === 'enemy' ? target : null };
  }
  function enemyDecide(e) {
    const foes = allies.filter((a) => a.alive);
    if (!foes.length) return { actor: e, type: 'guard' }; // 保険（通常この時点で戦闘は終了済み）
    const target = chooseAITarget(e);
    if (e.boss && e.skills.length) return bossDecide(e, target, foes.length);
    const useSkill = e.skills.length > 0 && Math.random() < 0.45;
    if (useSkill) {
      const s = D().SKILLS[pickEnemySkill(e, foes.length)];
      return { actor: e, type: 'skill', skill: s, target: s.target === 'enemy' ? target : null };
    }
    return { actor: e, type: 'attack', target };
  }

  /* -------- 逃走 -------- */
  async function tryFlee() {
    if (isBoss) { await showMsg('ボス戦からは にげられない!'); return false; }
    const aSpd = allies.filter((a) => a.alive).reduce((s, a) => s + a.spd, 0);
    const eSpd = enemies.filter((e) => e.alive).reduce((s, e) => s + e.spd, 0);
    const chance = 0.4 + 0.4 * (aSpd / (aSpd + eSpd));
    if (Math.random() < chance) {
      A().sfx('cancel');
      await showMsg('うまく にげ切った!');
      finish({ victory: false, fled: true, wiped: false });
      return true;
    }
    await showMsg('しかし まわりこまれてしまった!');
    // 逃走失敗：敵ターンだけ処理
    for (const e of enemies.filter((x) => x.alive)) {
      if (!active) return true;
      if (e.stunned) { e.stunned = false; await showMsg(e.name + ' はひるんでいる!'); continue; }
      await resolveAction(enemyDecide(e));
      tickBuffs(e);
      if (allies.every((a) => !a.alive)) { await defeat(); return true; }
    }
    return false;
  }

  /* -------- 勝敗 -------- */
  async function victory() {
    A().stopBgm(); A().sfx('fanfare'); A().playBgm('victory');
    banner('勝利!'); await wait(400);
    let exp = 0, gold = 0; const drops = [];
    enemies.forEach((e) => {
      exp += e.exp; gold += e.gold;
      (e.drops || []).forEach((d) => { if (Math.random() < d.rate) drops.push(d.item); });
    });
    Game.state.gold += gold;
    await showMsg('たたかいに 勝った!');
    if (exp > 0 || gold > 0) await showMsg(exp + ' の 経験値と ' + gold + ' ゴールドを 手に入れた!');
    for (const item of drops) {
      Game.addItem(item, 1);
      await showMsg(D().ITEMS[item].name + ' を 見つけた!');
    }
    // レベルアップ
    for (const a of allies) {
      if (!a.alive) continue;
      const msgs = Game.gainExp(a.hero, exp);
      for (const m of msgs) { A().sfx('levelup'); await showMsg(m); }
    }
    A().stopBgm();
    finish({ victory: true, fled: false, wiped: false });
  }
  async function defeat() {
    A().stopBgm(); A().sfx('defeat');
    banner('全滅…'); await wait(600);
    await showMsg('パーティは 全滅してしまった…');
    finish({ victory: false, fled: false, wiped: true });
  }
  function finish(result) {
    active = false;
    UI().hideBattleStatus();
    UI().hide();
    // HP/MP は hero に反映済み（getter/setter）
    if (onEnd) onEnd(result);
  }

  /* -------- 演出 -------- */
  function banner(text) { bannerText = text; bannerT = 1.4; }
  async function showMsg(text, ms) {
    await UI().battleMessage(text, ms || 900);
  }
  async function lunge(att, tgt) {
    const dx = (tgt.baseX - att.baseX), dy = (tgt.baseY - att.baseY);
    const d = Math.hypot(dx, dy) || 1;
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const k = i <= steps / 2 ? i / (steps / 2) : (steps - i) / (steps / 2);
      att.offx = dx / d * 30 * k; att.offy = dy / d * 30 * k;
      await wait(16);
    }
    att.offx = 0; att.offy = 0;
  }
  function hitFx(target, col) {
    target.flash = 0.25; shake = Math.max(shake, 5);
    particles.spawn({ x: target.baseX + target.size / 2, y: target.baseY + target.size / 2,
      count: 10, speed: 120, life: 0.4, col: col || '#fff', size: 4 });
  }
  function healFx(target) {
    particles.spawn({ x: target.baseX + target.size / 2, y: target.baseY + target.size / 2,
      count: 14, angle: -Math.PI / 2, spread: 0.6, speed: 60, life: 0.7, lift: 40,
      col: ['#8affc0', '#d6ffe6', '#5ad68a'], size: 4, grav: -20 });
  }
  async function castFx(me, s) {
    // 詠唱の光
    particles.spawn({ x: me.baseX + me.size / 2, y: me.baseY + me.size / 2,
      count: 12, speed: 40, life: 0.5, col: elementColor(s.element), size: 3, grav: -30 });
    await wait(250);
  }
  function elementColor(el) {
    return ({ fire: '#ff7a3a', thunder: '#ffe14a', dark: '#b46aff', light: '#fff2a0',
      earth: '#c9a24a', none: '#ffd24a' })[el] || '#ffd24a';
  }
  function elementBurst(t, el) {
    const col = elementColor(el);
    if (el === 'fire') particles.spawn({ x: t.baseX + t.size / 2, y: t.baseY + t.size / 2, count: 18, speed: 140, life: 0.5, col: ['#ff9a3a', '#ff5a2a', '#ffd24a'], size: 5, grav: -40 });
    else if (el === 'thunder') { flash('#ffe14a', 0.4); particles.spawn({ x: t.baseX + t.size / 2, y: t.baseY, count: 10, angle: Math.PI / 2, spread: 0.4, speed: 200, life: 0.3, col: '#fffbd0', size: 4 }); }
    else if (el === 'dark') particles.spawn({ x: t.baseX + t.size / 2, y: t.baseY + t.size / 2, count: 16, speed: 100, life: 0.6, col: ['#b46aff', '#6a2fb0', '#2a0a44'], size: 5, grav: 0 });
    else particles.spawn({ x: t.baseX + t.size / 2, y: t.baseY + t.size / 2, count: 12, speed: 120, life: 0.5, col: col, size: 4 });
  }
  function flash(col, a) { flashColor = col; flashAlpha = a; }
  const dmgNumbers = [];
  function spawnDamageNumber(t, dmg, crit) {
    dmgNumbers.push({ x: t.baseX + t.size / 2, y: t.baseY + t.size * 0.3, txt: '' + dmg,
      life: 0.9, crit: crit, side: t.side });
  }
  function spawnHealNumber(t, amt) {
    if (amt <= 0) return;
    dmgNumbers.push({ x: t.baseX + t.size / 2, y: t.baseY + t.size * 0.3, txt: '+' + amt,
      life: 0.9, crit: false, heal: true, side: t.side });
  }

  /* -------- 更新・描画 -------- */
  function update(dt) {
    if (!active) return;
    time += dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 40);
    if (flashAlpha > 0) flashAlpha = Math.max(0, flashAlpha - dt * 1.5);
    if (bannerT > 0) bannerT -= dt;
    all.forEach((c) => { if (c.flash > 0) c.flash = Math.max(0, c.flash - dt * 4); });
    enemies.forEach((e) => { if (e.dying > 0) e.dying = Math.max(0, e.dying - dt); });
    particles.update(dt);
    for (let i = dmgNumbers.length - 1; i >= 0; i--) {
      const d = dmgNumbers[i]; d.life -= dt; d.y -= dt * 40; if (d.life <= 0) dmgNumbers.splice(i, 1);
    }
  }

  function render(ctx, w, h) {
    if (!active) return;
    if (view.w !== w || view.h !== h) { view.w = w; view.h = h; layout(); }
    ctx.save();
    if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));
    G().battleBackground(ctx, w, h, theme, time);
    // 敵（撃破後は dying の間だけフェードして消える）
    enemies.forEach((e) => {
      if (!e.alive && !(e.dying > 0)) return;
      ctx.save();
      if (!e.alive) ctx.globalAlpha = Math.max(0, e.dying / 0.7);
      G().drawEnemy(ctx, e.sprite, e.baseX + e.offx, e.baseY + e.offy, e.size, { t: time, hitFlash: e.flash > 0 });
      ctx.restore();
    });
    // 味方（横向き＝左を向く=flip）
    allies.forEach((a, i) => {
      const bob = Math.sin(time * 2 + i) * 2;
      ctx.save();
      if (!a.alive) ctx.globalAlpha = 0.35;
      G().drawActor(ctx, a.battler, a.baseX + a.offx, a.baseY + a.offy + bob, a.size,
        { dir: 'left', frame: (Math.floor(time * 3) % 2), flip: false, tint: a.flash > 0 ? '#f66' : null, tintA: a.flash });
      ctx.restore();
    });
    // パーティクル
    particles.draw(ctx);
    // ダメージ数字
    dmgNumbers.forEach((d) => {
      ctx.globalAlpha = Math.min(1, d.life * 2);
      ctx.font = 'bold ' + (d.crit ? 28 : 22) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = '#000';
      ctx.fillStyle = d.heal ? '#8affc0' : (d.side === 'ally' ? '#ff8a8a' : (d.crit ? '#ffef6a' : '#ffffff'));
      ctx.strokeText(d.txt, d.x, d.y); ctx.fillText(d.txt, d.x, d.y);
      if (d.crit) { ctx.font = 'bold 12px system-ui'; ctx.fillText('CRITICAL!', d.x, d.y - 22); }
    });
    ctx.globalAlpha = 1;
    ctx.restore();
    // フラッシュ
    if (flashAlpha > 0) { ctx.fillStyle = flashColor; ctx.globalAlpha = flashAlpha; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }
    // バナー
    if (bannerT > 0) {
      ctx.globalAlpha = Math.min(1, bannerT);
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, h * 0.36, w, h * 0.12);
      ctx.fillStyle = '#fff'; ctx.font = 'bold ' + Math.round(w * 0.055) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(bannerText, w / 2, h * 0.42);
      ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
    }
  }

  function isActive() { return active; }

  return { begin, update, render, resize, isActive };
})();
