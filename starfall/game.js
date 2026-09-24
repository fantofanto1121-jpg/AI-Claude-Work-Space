/* =========================================================================
   STARFALL ARENA  —  neon survivor arena game
   Vanilla canvas, no dependencies. Designed for PC (keyboard + mouse).
   Graphics-first: cached additive glow sprites, parallax starfield, grid
   floor, particle explosions, bullet trails, screen shake, damage numbers.
   ========================================================================= */
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  //  Canvas / DOM
  // ---------------------------------------------------------------------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const el = (id) => document.getElementById(id);
  const hud = el("hud");
  const timeEl = el("time");
  const levelEl = el("level");
  const killsEl = el("kills");
  const bestEl = el("best");
  const hpFill = el("hp-fill");
  const hpText = el("hp-text");
  const xpFill = el("xp-fill");
  const waveBanner = el("wave-banner");
  const flashEl = el("flash");

  const startScreen = el("start-screen");
  const levelupScreen = el("levelup-screen");
  const pauseScreen = el("pause-screen");
  const gameoverScreen = el("gameover-screen");
  const upgradeCards = el("upgrade-cards");

  const STORAGE_KEY = "starfall-arena-best";

  // Arena is a bounded world larger than the viewport; camera follows player.
  const WORLD = { w: 3200, h: 3200 };

  let dpr = 1;
  let viewW = 0;
  let viewH = 0;

  function resize() {
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width = Math.floor(viewW * dpr);
    canvas.height = Math.floor(viewH * dpr);
    canvas.style.width = viewW + "px";
    canvas.style.height = viewH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);

  // ---------------------------------------------------------------------
  //  Utility
  // ---------------------------------------------------------------------
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  // ---------------------------------------------------------------------
  //  Glow sprite cache  (cheap bloom via drawImage + 'lighter')
  // ---------------------------------------------------------------------
  const glowCache = new Map();
  function glowSprite(color) {
    if (glowCache.has(color)) return glowCache.get(color);
    const size = 128;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, color);
    grd.addColorStop(0.25, color);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    glowCache.set(color, c);
    return c;
  }
  function drawGlow(x, y, radius, color, alpha) {
    const spr = glowSprite(color);
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(spr, x - radius, y - radius, radius * 2, radius * 2);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------
  //  Parallax starfield  (three depths) + drifting nebula motes
  // ---------------------------------------------------------------------
  const starLayers = [];
  function buildStars() {
    starLayers.length = 0;
    const defs = [
      { count: 90, depth: 0.2, size: [0.6, 1.2], color: "rgba(150,180,255," },
      { count: 60, depth: 0.45, size: [1.0, 1.8], color: "rgba(120,220,255," },
      { count: 34, depth: 0.8, size: [1.4, 2.6], color: "rgba(255,180,240," },
    ];
    for (const d of defs) {
      const stars = [];
      for (let i = 0; i < d.count; i++) {
        stars.push({
          x: Math.random() * WORLD.w,
          y: Math.random() * WORLD.h,
          r: rand(d.size[0], d.size[1]),
          tw: Math.random() * TAU,
          tws: rand(0.6, 2.2),
        });
      }
      starLayers.push({ depth: d.depth, color: d.color, stars });
    }
  }
  buildStars();

  // ---------------------------------------------------------------------
  //  Input
  // ---------------------------------------------------------------------
  const keys = Object.create(null);
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) {
      e.preventDefault();
    }
    if (k === "p" || k === "escape") togglePause();
    if (game.state === "levelup" && (k === "1" || k === "2" || k === "3")) {
      chooseUpgradeByIndex(parseInt(k, 10) - 1);
    }
    if ((k === "enter" || k === " ")) {
      if (game.state === "menu") startRun();
      else if (game.state === "gameover") startRun();
    }
  });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener("blur", () => {
    for (const k in keys) keys[k] = false;
    if (game.state === "playing") togglePause();
  });

  // --- Touch: floating virtual joystick (mobile) ---------------------------
  const touch = { active: false, id: null, ox: 0, oy: 0, kx: 0, ky: 0, nx: 0, ny: 0 };
  const JOY_MAX = 68; // px radius for full-speed input

  function touchStart(e) {
    if (game.state !== "playing") return; // overlays handle their own taps
    const t = e.changedTouches[0];
    if (!t) return;
    touch.active = true;
    touch.id = t.identifier;
    touch.ox = t.clientX; touch.oy = t.clientY;
    touch.kx = t.clientX; touch.ky = t.clientY;
    touch.nx = 0; touch.ny = 0;
    const a = audio();
    if (a && a.state === "suspended") a.resume().catch(() => {});
    if (e.cancelable) e.preventDefault();
  }
  function touchMove(e) {
    if (!touch.active) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== touch.id) continue;
      const dx = t.clientX - touch.ox;
      const dy = t.clientY - touch.oy;
      const len = Math.hypot(dx, dy);
      const mag = Math.min(len, JOY_MAX);
      const nrm = len > 0 ? mag / len : 0;
      touch.kx = touch.ox + dx * nrm;   // clamped knob position
      touch.ky = touch.oy + dy * nrm;
      const m = mag / JOY_MAX;           // analog magnitude 0..1
      touch.nx = len > 0 ? (dx / len) * m : 0;
      touch.ny = len > 0 ? (dy / len) * m : 0;
    }
    if (e.cancelable) e.preventDefault();
  }
  function touchEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === touch.id) {
        touch.active = false; touch.id = null; touch.nx = 0; touch.ny = 0;
      }
    }
    if (e.cancelable) e.preventDefault();
  }
  canvas.addEventListener("touchstart", touchStart, { passive: false });
  canvas.addEventListener("touchmove", touchMove, { passive: false });
  canvas.addEventListener("touchend", touchEnd, { passive: false });
  canvas.addEventListener("touchcancel", touchEnd, { passive: false });

  // ---------------------------------------------------------------------
  //  Game state
  // ---------------------------------------------------------------------
  const game = {
    state: "menu", // menu | playing | levelup | paused | gameover
    time: 0,
    kills: 0,
    best: 0,
    shake: 0,
    hitFlash: 0,
    cam: { x: 0, y: 0 },
    spawnTimer: 0,
    difficulty: 1,
    nextWaveAt: 30,
    waveCount: 0,
  };

  const player = {
    x: 0, y: 0, r: 16,
    speed: 240,
    hp: 100, maxHp: 100,
    regen: 0,
    level: 1, xp: 0, xpNext: 5,
    pickupRange: 120,
    invuln: 0,
    facing: 0,
    // combat multipliers (modified by upgrades)
    damageMul: 1,
    fireRateMul: 1,
    projectiles: 1,
    critChance: 0.05,
    xpMul: 1,
    weapons: {},   // id -> level
    passives: {},  // id -> level
    trail: [],
  };

  // Entity pools
  let enemies = [];
  let bullets = [];
  let gems = [];
  let particles = [];
  let floaters = []; // damage numbers / text
  let shockwaves = [];
  let orbiters = [];

  // ---------------------------------------------------------------------
  //  Audio (light WebAudio SFX)
  // ---------------------------------------------------------------------
  let actx = null;
  function audio() {
    if (actx) return actx;
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
    return actx;
  }
  function beep(freq, dur, type, gain) {
    const a = audio();
    if (!a) return;
    if (a.state === "suspended") a.resume().catch(() => {});
    const now = a.currentTime;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain || 0.06, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    o.connect(g).connect(a.destination);
    o.start(now);
    o.stop(now + dur + 0.03);
  }
  const sfx = {
    shoot: () => beep(520, 0.06, "square", 0.025),
    hit: () => beep(300, 0.05, "sawtooth", 0.02),
    kill: () => beep(180, 0.09, "triangle", 0.05),
    gem: () => beep(880, 0.05, "sine", 0.03),
    level: () => { beep(660, 0.1, "triangle", 0.07); setTimeout(() => beep(990, 0.14, "triangle", 0.06), 70); },
    hurt: () => beep(120, 0.18, "sawtooth", 0.08),
    nova: () => beep(90, 0.25, "sine", 0.09),
    dead: () => { beep(160, 0.3, "sawtooth", 0.09); setTimeout(() => beep(80, 0.5, "sine", 0.08), 120); },
  };

  // ---------------------------------------------------------------------
  //  Weapon & Upgrade definitions
  // ---------------------------------------------------------------------
  // Each weapon has: name, icon, color, accent, max level, and per-level stats.
  const WEAPONS = {
    pulse: {
      name: "パルスキャノン", icon: "✦", tag: "WEAPON",
      color: "rgba(56,246,255,1)", accent: "#38f6ff", glow: "rgba(56,246,255,0.55)",
      max: 8,
      desc: (lv) => lv === 0 ? "正面の敵へ光弾を連射する基本武器。"
        : "弾数と威力が増す。(Lv" + (lv + 1) + ")",
    },
    orbit: {
      name: "オービットセイバー", icon: "◍", tag: "WEAPON",
      color: "rgba(165,107,255,1)", accent: "#a56bff", glow: "rgba(165,107,255,0.55)",
      max: 6,
      desc: (lv) => lv === 0 ? "周囲を回る光刃。触れた敵を斬り続ける。"
        : "刃の数と回転が増す。(Lv" + (lv + 1) + ")",
    },
    nova: {
      name: "ノヴァパルス", icon: "✸", tag: "WEAPON",
      color: "rgba(255,62,165,1)", accent: "#ff3ea5", glow: "rgba(255,62,165,0.55)",
      max: 6,
      desc: (lv) => lv === 0 ? "一定間隔で全方位に衝撃波を放つ。"
        : "範囲と威力が拡大する。(Lv" + (lv + 1) + ")",
    },
    spread: {
      name: "シャードバースト", icon: "✵", tag: "WEAPON",
      color: "rgba(255,209,102,1)", accent: "#ffd166", glow: "rgba(255,209,102,0.55)",
      max: 6,
      desc: (lv) => lv === 0 ? "扇状に鋭い破片を撒き散らす近距離砲。"
        : "破片数と角度が広がる。(Lv" + (lv + 1) + ")",
    },
    beam: {
      name: "レールランス", icon: "⟶", tag: "WEAPON",
      color: "rgba(120,255,190,1)", accent: "#78ffbe", glow: "rgba(120,255,190,0.5)",
      max: 6,
      desc: (lv) => lv === 0 ? "貫通する高速の光線を最も近い敵へ撃つ。"
        : "貫通・威力・連射が上がる。(Lv" + (lv + 1) + ")",
    },
  };

  const PASSIVES = {
    power: { name: "オーバードライブ", icon: "⚡", tag: "PASSIVE", accent: "#ff9d5a", glow: "rgba(255,157,90,0.5)", max: 8,
      desc: () => "全武器のダメージ +15%。" },
    haste: { name: "ヘイストコア", icon: "⏩", tag: "PASSIVE", accent: "#38f6ff", glow: "rgba(56,246,255,0.5)", max: 8,
      desc: () => "攻撃速度 +12%。" },
    swift: { name: "スラスター", icon: "➤", tag: "PASSIVE", accent: "#78ffbe", glow: "rgba(120,255,190,0.5)", max: 6,
      desc: () => "移動速度 +10%。" },
    vitality: { name: "ハルプレート", icon: "❤", tag: "PASSIVE", accent: "#ff5a5a", glow: "rgba(255,90,90,0.5)", max: 8,
      desc: () => "最大HP +25 （＆全回復）。" },
    regen: { name: "ナノリペア", icon: "✚", tag: "PASSIVE", accent: "#78ffbe", glow: "rgba(120,255,190,0.5)", max: 6,
      desc: () => "毎秒HP自動回復 +1.2。" },
    magnet: { name: "マグネットフィールド", icon: "◎", tag: "PASSIVE", accent: "#a56bff", glow: "rgba(165,107,255,0.5)", max: 5,
      desc: () => "欠片の回収範囲 +40%。" },
    crit: { name: "フォーカスレンズ", icon: "◆", tag: "PASSIVE", accent: "#ffd166", glow: "rgba(255,209,102,0.5)", max: 6,
      desc: () => "クリティカル率 +8%（2倍ダメージ）。" },
    greed: { name: "スターグリード", icon: "★", tag: "PASSIVE", accent: "#ffd166", glow: "rgba(255,209,102,0.5)", max: 5,
      desc: () => "獲得経験値 +20%。" },
  };

  // ---------------------------------------------------------------------
  //  Weapon stat resolvers (level-scaled)
  // ---------------------------------------------------------------------
  function weaponLv(id) { return player.weapons[id] || 0; }

  function pulseStats() {
    const lv = weaponLv("pulse");
    return {
      cooldown: 0.42 / player.fireRateMul,
      damage: (10 + lv * 5) * player.damageMul,
      speed: 620,
      radius: 6 + lv * 0.6,
      count: player.projectiles + Math.floor(lv / 2),
      spread: 0.12,
      range: 560 + lv * 20,
    };
  }
  function orbitCount() { const lv = weaponLv("orbit"); return lv === 0 ? 0 : 2 + Math.floor(lv * 0.9); }
  function orbitStats() {
    const lv = weaponLv("orbit");
    return {
      count: orbitCount(),
      damage: (8 + lv * 4) * player.damageMul,
      radius: 78 + lv * 8,
      spin: 2.2 + lv * 0.25,
      size: 12 + lv * 1.2,
    };
  }
  function novaStats() {
    const lv = weaponLv("nova");
    return {
      cooldown: 2.6 / player.fireRateMul,
      damage: (16 + lv * 9) * player.damageMul,
      radius: 150 + lv * 34,
    };
  }
  function spreadStats() {
    const lv = weaponLv("spread");
    return {
      cooldown: 0.9 / player.fireRateMul,
      damage: (7 + lv * 4) * player.damageMul,
      speed: 520,
      count: 4 + lv,
      arc: 0.6 + lv * 0.08,
      radius: 5,
      life: 0.5,
      range: 360,
    };
  }
  function beamStats() {
    const lv = weaponLv("beam");
    return {
      cooldown: 1.3 / player.fireRateMul,
      damage: (22 + lv * 12) * player.damageMul,
      pierce: 3 + lv,
      speed: 1100,
      radius: 7 + lv,
      range: 720,
    };
  }

  // weapon timers
  const wt = { pulse: 0, nova: 0, spread: 0, beam: 0 };

  // ---------------------------------------------------------------------
  //  Enemy types
  // ---------------------------------------------------------------------
  const ENEMY_TYPES = {
    drifter: { r: 15, hp: 18, speed: 70, dmg: 8, xp: 1, color: "rgba(120,200,255,1)", glow: "rgba(90,160,255,0.5)", shape: "diamond" },
    rusher:  { r: 11, hp: 10, speed: 155, dmg: 6, xp: 1, color: "rgba(120,255,190,1)", glow: "rgba(80,255,170,0.5)", shape: "tri" },
    tank:    { r: 26, hp: 80, speed: 46, dmg: 16, xp: 4, color: "rgba(255,120,120,1)", glow: "rgba(255,90,90,0.5)", shape: "hex" },
    orbiter: { r: 13, hp: 26, speed: 92, dmg: 9, xp: 2, color: "rgba(200,140,255,1)", glow: "rgba(165,107,255,0.5)", shape: "star" },
    splitter:{ r: 18, hp: 34, speed: 64, dmg: 10, xp: 2, color: "rgba(255,180,90,1)", glow: "rgba(255,157,90,0.5)", shape: "diamond", splits: true },
    boss:    { r: 46, hp: 900, speed: 40, dmg: 26, xp: 40, color: "rgba(255,80,180,1)", glow: "rgba(255,62,165,0.6)", shape: "hex", boss: true },
  };

  function spawnEnemy(type, x, y, hpScale) {
    const t = ENEMY_TYPES[type];
    const e = {
      type, x, y,
      r: t.r, maxHp: t.hp * (hpScale || 1), hp: t.hp * (hpScale || 1),
      speed: t.speed, dmg: t.dmg, xp: t.xp,
      color: t.color, glow: t.glow, shape: t.shape,
      splits: !!t.splits, boss: !!t.boss,
      hitFlash: 0, phase: Math.random() * TAU, angle: 0,
      knock: { x: 0, y: 0 },
    };
    enemies.push(e);
    return e;
  }

  // Spawn just outside the current view around the player.
  function spawnAtEdge(type, hpScale) {
    const ang = Math.random() * TAU;
    const rad = Math.max(viewW, viewH) * 0.62 + 60;
    let x = player.x + Math.cos(ang) * rad;
    let y = player.y + Math.sin(ang) * rad;
    x = clamp(x, 40, WORLD.w - 40);
    y = clamp(y, 40, WORLD.h - 40);
    return spawnEnemy(type, x, y, hpScale);
  }

  // ---------------------------------------------------------------------
  //  Difficulty / spawner
  // ---------------------------------------------------------------------
  function updateSpawner(dt) {
    game.difficulty = 1 + game.time / 45;
    const hpScale = 1 + game.time / 55;

    // steady stream, faster over time
    game.spawnTimer -= dt;
    const interval = clamp(1.15 - game.time * 0.007, 0.22, 1.15);
    if (game.spawnTimer <= 0) {
      game.spawnTimer = interval;
      const batch = 1 + Math.floor(game.time / 40);
      for (let i = 0; i < batch; i++) {
        spawnAtEdge(rollEnemyType(), hpScale);
      }
    }

    // timed waves / boss
    if (game.time >= game.nextWaveAt) {
      game.waveCount++;
      game.nextWaveAt += 30;
      if (game.waveCount % 3 === 0) {
        const b = spawnAtEdge("boss", hpScale * (1 + game.waveCount * 0.12));
        showWave("⚠ BOSS APPROACHING ⚠");
      } else {
        const n = 8 + game.waveCount * 2;
        for (let i = 0; i < n; i++) spawnAtEdge(rollEnemyType(), hpScale);
        showWave("WAVE " + game.waveCount);
      }
      game.shake = Math.max(game.shake, 8);
    }
  }

  function rollEnemyType() {
    const t = game.time;
    const r = Math.random();
    if (t < 20) return r < 0.75 ? "drifter" : "rusher";
    if (t < 60) {
      if (r < 0.45) return "drifter";
      if (r < 0.75) return "rusher";
      if (r < 0.9) return "orbiter";
      return "tank";
    }
    if (r < 0.3) return "drifter";
    if (r < 0.55) return "rusher";
    if (r < 0.72) return "orbiter";
    if (r < 0.86) return "splitter";
    return "tank";
  }

  let waveTimer = 0;
  function showWave(text) {
    waveBanner.textContent = text;
    waveBanner.classList.remove("hidden", "show");
    void waveBanner.offsetWidth;
    waveBanner.classList.add("show");
    waveTimer = 2.2;
  }

  // ---------------------------------------------------------------------
  //  Particles / floaters / shockwaves
  // ---------------------------------------------------------------------
  function burst(x, y, color, count, spd, sizeRange, life) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = rand(spd * 0.3, spd);
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(life * 0.6, life), maxLife: life,
        size: rand(sizeRange[0], sizeRange[1]), color, drag: 0.9,
      });
      if (particles.length > 620) particles.shift();
    }
  }
  function floater(x, y, text, color, big) {
    floaters.push({ x, y, text, color, life: 1, vy: -34, size: big ? 22 : 15 });
    if (floaters.length > 60) floaters.shift();
  }
  function shockwave(x, y, radius, color) {
    shockwaves.push({ x, y, r: 8, max: radius, color, life: 1 });
  }

  // ---------------------------------------------------------------------
  //  Combat
  // ---------------------------------------------------------------------
  function nearestEnemy(x, y, maxD2) {
    let best = null, bd = maxD2 == null ? Infinity : maxD2;
    for (const e of enemies) {
      const d = dist2(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function damageEnemy(e, amount, kx, ky, isCrit) {
    e.hp -= amount;
    e.hitFlash = 1;
    if (kx || ky) { e.knock.x += kx; e.knock.y += ky; }
    floater(e.x, e.y - e.r, Math.round(amount), isCrit ? "#ffd166" : "#ffffff", isCrit);
    if (e.hp <= 0) killEnemy(e);
  }

  function killEnemy(e) {
    e.dead = true;
    game.kills++;
    burst(e.x, e.y, e.color, e.boss ? 46 : 14, e.boss ? 320 : 190, [1.5, e.boss ? 5 : 3.5], e.boss ? 0.9 : 0.55);
    shockwave(e.x, e.y, e.boss ? 180 : 46, e.glow);
    if (e.boss) { game.shake = Math.max(game.shake, 14); sfx.nova(); }
    else sfx.kill();

    // drop XP gems
    const gemCount = e.boss ? 14 : e.type === "tank" ? 3 : 1;
    for (let i = 0; i < gemCount; i++) {
      const a = Math.random() * TAU;
      const off = e.boss ? rand(0, 60) : rand(0, 12);
      gems.push({
        x: e.x + Math.cos(a) * off,
        y: e.y + Math.sin(a) * off,
        xp: Math.max(1, Math.round(e.xp / gemCount)) || 1,
        r: 5, phase: Math.random() * TAU, vx: 0, vy: 0, homing: false,
      });
    }
    if (e.splits && e.r > 10) {
      for (let i = 0; i < 2; i++) {
        const c = spawnEnemy("rusher", e.x + rand(-14, 14), e.y + rand(-14, 14), 0.5);
        c.color = e.color; c.glow = e.glow;
      }
    }
  }

  function fireWeapons(dt) {
    // PULSE
    if (weaponLv("pulse") > 0) {
      wt.pulse -= dt;
      if (wt.pulse <= 0) {
        const s = pulseStats();
        const target = nearestEnemy(player.x, player.y, s.range * s.range);
        if (target) {
          wt.pulse = s.cooldown;
          const base = Math.atan2(target.y - player.y, target.x - player.x);
          for (let i = 0; i < s.count; i++) {
            const off = (i - (s.count - 1) / 2) * s.spread;
            fireBullet(base + off, s.speed, s.damage, s.radius, WEAPONS.pulse.color, WEAPONS.pulse.glow, 999, false);
          }
          sfx.shoot();
        }
      }
    }
    // SPREAD
    if (weaponLv("spread") > 0) {
      wt.spread -= dt;
      if (wt.spread <= 0) {
        const s = spreadStats();
        const target = nearestEnemy(player.x, player.y, s.range * s.range);
        if (target) {
          wt.spread = s.cooldown;
          const base = Math.atan2(target.y - player.y, target.x - player.x);
          for (let i = 0; i < s.count; i++) {
            const off = (i - (s.count - 1) / 2) * (s.arc / s.count);
            const b = fireBullet(base + off, s.speed, s.damage, s.radius, WEAPONS.spread.color, WEAPONS.spread.glow, 1, false);
            b.life = s.life;
          }
          sfx.shoot();
        }
      }
    }
    // BEAM (piercing)
    if (weaponLv("beam") > 0) {
      wt.beam -= dt;
      if (wt.beam <= 0) {
        const s = beamStats();
        const target = nearestEnemy(player.x, player.y, s.range * s.range);
        if (target) {
          wt.beam = s.cooldown;
          const a = Math.atan2(target.y - player.y, target.x - player.x);
          const b = fireBullet(a, s.speed, s.damage, s.radius, WEAPONS.beam.color, WEAPONS.beam.glow, s.pierce, true);
          b.long = true;
          sfx.shoot();
        }
      }
    }
    // NOVA
    if (weaponLv("nova") > 0) {
      wt.nova -= dt;
      if (wt.nova <= 0) {
        const s = novaStats();
        wt.nova = s.cooldown;
        shockwave(player.x, player.y, s.radius, WEAPONS.nova.glow);
        game.shake = Math.max(game.shake, 5);
        sfx.nova();
        const r2 = s.radius * s.radius;
        for (const e of enemies) {
          if (dist2(player.x, player.y, e.x, e.y) < r2) {
            const a = Math.atan2(e.y - player.y, e.x - player.x);
            damageEnemy(e, s.damage, Math.cos(a) * 160, Math.sin(a) * 160, false);
          }
        }
        burst(player.x, player.y, WEAPONS.nova.color, 26, 260, [2, 4], 0.6);
      }
    }
  }

  function fireBullet(angle, speed, damage, radius, color, glow, pierce, isBeam) {
    const crit = Math.random() < player.critChance;
    const b = {
      x: player.x, y: player.y,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      damage: crit ? damage * 2 : damage, crit,
      r: radius, color, glow, pierce, hits: new Set(),
      life: isBeam ? 0.9 : 1.6, angle, long: false,
      trail: [],
    };
    bullets.push(b);
    if (bullets.length > 260) bullets.shift();
    return b;
  }

  // Orbiter update (rotating blades)
  let orbitAngle = 0;
  function updateOrbiters(dt) {
    const s = orbitStats();
    if (s.count === 0) { orbiters.length = 0; return; }
    orbitAngle += s.spin * dt;
    // rebuild positions each frame
    orbiters.length = 0;
    for (let i = 0; i < s.count; i++) {
      const a = orbitAngle + (TAU * i) / s.count;
      orbiters.push({
        x: player.x + Math.cos(a) * s.radius,
        y: player.y + Math.sin(a) * s.radius,
        r: s.size, damage: s.damage,
      });
    }
    // collide
    for (const o of orbiters) {
      for (const e of enemies) {
        if (e.dead) continue;
        const rr = (o.r + e.r);
        if (dist2(o.x, o.y, e.x, e.y) < rr * rr) {
          if (!e._orbCd || e._orbCd <= 0) {
            const a = Math.atan2(e.y - player.y, e.x - player.x);
            damageEnemy(e, o.damage, Math.cos(a) * 80, Math.sin(a) * 80, false);
            e._orbCd = 0.25;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  //  Update loop pieces
  // ---------------------------------------------------------------------
  function updatePlayer(dt) {
    let mx = 0, my = 0;
    if (keys["w"] || keys["arrowup"]) my -= 1;
    if (keys["s"] || keys["arrowdown"]) my += 1;
    if (keys["a"] || keys["arrowleft"]) mx -= 1;
    if (keys["d"] || keys["arrowright"]) mx += 1;
    if (mx || my) {
      const len = Math.hypot(mx, my);
      mx /= len; my /= len;
    }
    // touch joystick overrides keyboard when active (analog magnitude)
    if (touch.active && (touch.nx || touch.ny)) {
      mx = touch.nx; my = touch.ny;
    }
    if (mx || my) {
      player.facing = Math.atan2(my, mx);
      // trail
      player.trail.push({ x: player.x, y: player.y, life: 1 });
      if (player.trail.length > 16) player.trail.shift();
    }
    player.x = clamp(player.x + mx * player.speed * dt, player.r, WORLD.w - player.r);
    player.y = clamp(player.y + my * player.speed * dt, player.r, WORLD.h - player.r);

    for (const t of player.trail) t.life -= dt * 2.6;
    player.trail = player.trail.filter((t) => t.life > 0);

    // regen
    if (player.regen > 0 && player.hp < player.maxHp) {
      player.hp = Math.min(player.maxHp, player.hp + player.regen * dt);
    }
    if (player.invuln > 0) player.invuln -= dt;
  }

  function updateEnemies(dt) {
    for (const e of enemies) {
      if (e.dead) continue;
      if (e.hitFlash > 0) e.hitFlash -= dt * 4;
      if (e._orbCd > 0) e._orbCd -= dt;
      e.phase += dt * 3;

      let ang = Math.atan2(player.y - e.y, player.x - e.x);
      // orbiter type circles the player
      if (e.type === "orbiter") ang += 0.9;
      let vx = Math.cos(ang) * e.speed;
      let vy = Math.sin(ang) * e.speed;
      // knockback
      vx += e.knock.x; vy += e.knock.y;
      e.knock.x *= 0.86; e.knock.y *= 0.86;
      e.x += vx * dt;
      e.y += vy * dt;
      e.x = clamp(e.x, 20, WORLD.w - 20);
      e.y = clamp(e.y, 20, WORLD.h - 20);
      e.angle = ang;

      // contact damage to player
      const rr = e.r + player.r;
      if (player.invuln <= 0 && dist2(e.x, e.y, player.x, player.y) < rr * rr) {
        hurtPlayer(e.dmg);
        const a = Math.atan2(player.y - e.y, player.x - e.x);
        e.knock.x -= Math.cos(a) * 60;
        e.knock.y -= Math.sin(a) * 60;
      }
    }
    // simple separation so enemies don't fully overlap (cheap, sampled)
    for (let i = 0; i < enemies.length; i++) {
      const a = enemies[i];
      if (a.dead) continue;
      for (let j = i + 1; j < i + 6 && j < enemies.length; j++) {
        const b = enemies[j];
        if (b.dead) continue;
        const min = a.r + b.r;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.01 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = (min - d) * 0.5;
          const ux = dx / d, uy = dy / d;
          a.x -= ux * push; a.y -= uy * push;
          b.x += ux * push; b.y += uy * push;
        }
      }
    }
    enemies = enemies.filter((e) => !e.dead);
  }

  function hurtPlayer(amount) {
    if (player.invuln > 0) return;
    player.hp -= amount;
    player.invuln = 0.6;
    game.shake = Math.max(game.shake, 10);
    game.hitFlash = 1;
    burst(player.x, player.y, "rgba(255,90,90,1)", 12, 200, [2, 4], 0.5);
    sfx.hurt();
    if (player.hp <= 0) {
      player.hp = 0;
      die();
    }
  }

  function updateBullets(dt) {
    for (const b of bullets) {
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > (b.long ? 10 : 6)) b.trail.shift();
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.x < -40 || b.y < -40 || b.x > WORLD.w + 40 || b.y > WORLD.h + 40) b.life = 0;
      // collide
      for (const e of enemies) {
        if (e.dead || b.hits.has(e)) continue;
        const rr = e.r + b.r;
        if (dist2(b.x, b.y, e.x, e.y) < rr * rr) {
          const a = Math.atan2(b.vy, b.vx);
          damageEnemy(e, b.damage, Math.cos(a) * 70, Math.sin(a) * 70, b.crit);
          b.hits.add(e);
          burst(b.x, b.y, b.color, 4, 120, [1, 2.4], 0.3);
          b.pierce--;
          if (b.pierce <= 0) { b.life = 0; break; }
        }
      }
    }
    bullets = bullets.filter((b) => b.life > 0);
  }

  function updateGems(dt) {
    const range = player.pickupRange;
    const range2 = range * range;
    const grab = (player.r + 6) * (player.r + 6);
    for (const g of gems) {
      g.phase += dt * 5;
      const d2 = dist2(g.x, g.y, player.x, player.y);
      const a = Math.atan2(player.y - g.y, player.x - g.x);
      if (d2 < range2 || g.homing) {
        // within pickup range: fast homing that accelerates as it nears
        g.homing = true;
        const sp = lerp(140, 500, 1 - clamp(Math.sqrt(d2) / range, 0, 1));
        g.x += Math.cos(a) * sp * dt;
        g.y += Math.sin(a) * sp * dt;
      } else {
        // outside range: gentle global drift so XP is never permanently stranded
        g.x += Math.cos(a) * 55 * dt;
        g.y += Math.sin(a) * 55 * dt;
      }
      if (d2 < grab) {
        gainXp(g.xp);
        g.dead = true;
        burst(g.x, g.y, "rgba(120,240,255,1)", 3, 90, [1, 2], 0.3);
        sfx.gem();
      }
    }
    gems = gems.filter((g) => !g.dead);
  }

  function updateEffects(dt) {
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.life -= dt;
    }
    particles = particles.filter((p) => p.life > 0);

    for (const f of floaters) {
      f.y += f.vy * dt;
      f.vy *= 0.92;
      f.life -= dt * 1.3;
    }
    floaters = floaters.filter((f) => f.life > 0);

    for (const s of shockwaves) {
      s.r += (s.max - s.r) * dt * 6;
      s.life -= dt * 1.8;
    }
    shockwaves = shockwaves.filter((s) => s.life > 0);

    if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 34);
    if (game.hitFlash > 0) game.hitFlash = Math.max(0, game.hitFlash - dt * 2.4);
    flashEl.style.opacity = game.hitFlash * 0.6;

    if (waveTimer > 0) {
      waveTimer -= dt;
      if (waveTimer <= 0) waveBanner.classList.add("hidden");
    }
  }

  // ---------------------------------------------------------------------
  //  XP / leveling
  // ---------------------------------------------------------------------
  function gainXp(amount) {
    player.xp += amount * player.xpMul;
    while (player.xp >= player.xpNext) {
      player.xp -= player.xpNext;
      player.level++;
      player.xpNext = Math.round(5 + player.level * 3.2 + player.level * player.level * 0.35);
      openLevelUp();
    }
  }

  // ---------------------------------------------------------------------
  //  Upgrade selection
  // ---------------------------------------------------------------------
  let pendingChoices = [];

  function buildChoicePool() {
    const pool = [];
    // weapons: offer if not maxed
    for (const id in WEAPONS) {
      const lv = weaponLv(id);
      if (lv < WEAPONS[id].max) {
        pool.push({ kind: "weapon", id, lv });
      }
    }
    // passives
    for (const id in PASSIVES) {
      const lv = player.passives[id] || 0;
      if (lv < PASSIVES[id].max) {
        pool.push({ kind: "passive", id, lv });
      }
    }
    return pool;
  }

  function openLevelUp() {
    // don't stack multiple modals; queue is handled by re-open after choice
    if (game.state === "levelup") return;
    let pool = buildChoicePool();
    // Bias: if player has few weapons, prioritise offering a new/leveled weapon.
    shuffle(pool);
    const owned = Object.keys(player.weapons).length;
    if (owned < 3) {
      pool.sort((a, b) => (a.kind === "weapon" ? -1 : 1) - (b.kind === "weapon" ? -1 : 1));
    }
    pendingChoices = pool.slice(0, 3);
    if (pendingChoices.length === 0) {
      // everything maxed — grant a heal instead
      player.hp = player.maxHp;
      return;
    }
    renderCards();
    setState("levelup");
    sfx.level();
  }

  function renderCards() {
    upgradeCards.innerHTML = "";
    el("levelup-num").textContent = player.level;
    pendingChoices.forEach((c, i) => {
      const def = c.kind === "weapon" ? WEAPONS[c.id] : PASSIVES[c.id];
      const isNew = c.lv === 0 && c.kind === "weapon";
      const card = document.createElement("div");
      card.className = "card";
      card.style.setProperty("--card-accent", def.accent);
      card.style.setProperty("--card-glow", def.glow);
      const lvLabel = c.kind === "weapon"
        ? (isNew ? "NEW" : "Lv " + (c.lv + 1))
        : "Lv " + (c.lv + 1);
      card.innerHTML =
        '<span class="card-key">' + (i + 1) + '</span>' +
        '<span class="card-lv">' + lvLabel + '</span>' +
        '<div class="card-icon">' + def.icon + '</div>' +
        '<div class="card-name">' + def.name + '</div>' +
        '<span class="card-tag">' + def.tag + '</span>' +
        '<div class="card-desc">' + def.desc(c.lv) + '</div>';
      card.addEventListener("click", () => chooseUpgradeByIndex(i));
      upgradeCards.appendChild(card);
    });
  }

  function chooseUpgradeByIndex(i) {
    if (game.state !== "levelup") return;
    const c = pendingChoices[i];
    if (!c) return;
    applyUpgrade(c);
    burst(player.x, player.y, "rgba(255,209,102,1)", 20, 200, [2, 4], 0.6);
    shockwave(player.x, player.y, 120, "rgba(255,209,102,0.5)");
    // if more levels queued (multi-level from big gem), openLevelUp re-triggers via gainXp loop.
    setState("playing");
    // handle case where another level was reached during the same gain loop:
    if (player.xp >= player.xpNext) {
      // there is a pending level; re-open
      // (gainXp loop already incremented level & xpNext, so open once more)
    }
  }

  function applyUpgrade(c) {
    if (c.kind === "weapon") {
      player.weapons[c.id] = (player.weapons[c.id] || 0) + 1;
    } else {
      player.passives[c.id] = (player.passives[c.id] || 0) + 1;
      switch (c.id) {
        case "power": player.damageMul += 0.15; break;
        case "haste": player.fireRateMul += 0.12; break;
        case "swift": player.speed += 24; break;
        case "vitality": player.maxHp += 25; player.hp = player.maxHp; break;
        case "regen": player.regen += 1.2; break;
        case "magnet": player.pickupRange *= 1.4; break;
        case "crit": player.critChance = clamp(player.critChance + 0.08, 0, 0.9); break;
        case "greed": player.xpMul += 0.2; break;
      }
    }
  }

  // ---------------------------------------------------------------------
  //  Rendering
  // ---------------------------------------------------------------------
  function render() {
    ctx.clearRect(0, 0, viewW, viewH);

    // camera (clamped) + shake
    let camX = clamp(player.x - viewW / 2, 0, Math.max(0, WORLD.w - viewW));
    let camY = clamp(player.y - viewH / 2, 0, Math.max(0, WORLD.h - viewH));
    if (WORLD.w < viewW) camX = (WORLD.w - viewW) / 2;
    if (WORLD.h < viewH) camY = (WORLD.h - viewH) / 2;
    let sx = 0, sy = 0;
    if (game.shake > 0.2) {
      sx = rand(-game.shake, game.shake);
      sy = rand(-game.shake, game.shake);
    }
    game.cam.x = camX; game.cam.y = camY;

    ctx.save();
    ctx.translate(-camX + sx, -camY + sy);

    drawBackground(camX, camY);
    drawArenaBorder();
    drawGems();
    drawEnemies();
    drawBullets();
    drawOrbiters();
    drawPlayer();
    drawShockwaves();
    drawParticles();
    drawFloaters();

    ctx.restore();

    drawJoystick();
  }

  function drawJoystick() {
    if (!touch.active) return;
    ctx.save();
    // outer ring
    ctx.strokeStyle = "rgba(56,246,255,0.45)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(touch.ox, touch.oy, JOY_MAX, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = "rgba(56,246,255,0.06)";
    ctx.beginPath();
    ctx.arc(touch.ox, touch.oy, JOY_MAX, 0, TAU);
    ctx.fill();
    // knob (glow)
    ctx.globalCompositeOperation = "lighter";
    drawGlow(touch.kx, touch.ky, 30, "rgba(56,246,255,0.7)", 0.8);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(230,250,255,0.95)";
    ctx.beginPath();
    ctx.arc(touch.kx, touch.ky, 17, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawBackground(camX, camY) {
    // parallax stars
    ctx.globalCompositeOperation = "lighter";
    for (const layer of starLayers) {
      for (const s of layer.stars) {
        // parallax: shift by camera * (1 - depth) but keep within world by wrapping
        const px = s.x - camX * (1 - layer.depth) * 0.0; // stars fixed in world space
        const py = s.y - camY * (1 - layer.depth) * 0.0;
        // only draw if near view
        if (px < camX - 20 || px > camX + viewW + 20 || py < camY - 20 || py > camY + viewH + 20) continue;
        const tw = 0.5 + 0.5 * Math.sin(s.tw + game.time * s.tws);
        ctx.fillStyle = layer.color + (0.25 + tw * 0.6) + ")";
        ctx.beginPath();
        ctx.arc(px, py, s.r * (0.7 + tw * 0.5), 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";

    // grid floor
    const grid = 80;
    const startX = Math.floor(camX / grid) * grid;
    const startY = Math.floor(camY / grid) * grid;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(90,130,220,0.09)";
    ctx.beginPath();
    for (let x = startX; x <= camX + viewW + grid; x += grid) {
      ctx.moveTo(x, camY - grid);
      ctx.lineTo(x, camY + viewH + grid);
    }
    for (let y = startY; y <= camY + viewH + grid; y += grid) {
      ctx.moveTo(camX - grid, y);
      ctx.lineTo(camX + viewW + grid, y);
    }
    ctx.stroke();
  }

  function drawArenaBorder() {
    ctx.save();
    ctx.strokeStyle = "rgba(56,246,255,0.5)";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(56,246,255,0.8)";
    ctx.shadowBlur = 24;
    ctx.strokeRect(0, 0, WORLD.w, WORLD.h);
    ctx.restore();
  }

  function drawPlayer() {
    // trail
    ctx.globalCompositeOperation = "lighter";
    for (const t of player.trail) {
      drawGlow(t.x, t.y, player.r * 1.6 * t.life, "rgba(56,246,255,0.4)", t.life * 0.5);
    }
    ctx.globalCompositeOperation = "source-over";

    // pickup range ring (subtle)
    ctx.strokeStyle = "rgba(120,200,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.pickupRange, 0, TAU);
    ctx.stroke();

    const blink = player.invuln > 0 && Math.floor(player.invuln * 20) % 2 === 0;
    drawGlow(player.x, player.y, player.r * 2.6, "rgba(56,246,255,0.6)", blink ? 0.4 : 0.9);

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.facing + Math.PI / 2);
    // ship body — sleek triangle
    ctx.beginPath();
    ctx.moveTo(0, -player.r * 1.3);
    ctx.lineTo(player.r * 0.9, player.r);
    ctx.lineTo(0, player.r * 0.55);
    ctx.lineTo(-player.r * 0.9, player.r);
    ctx.closePath();
    const grd = ctx.createLinearGradient(0, -player.r, 0, player.r);
    grd.addColorStop(0, "#eafcff");
    grd.addColorStop(0.5, "#38f6ff");
    grd.addColorStop(1, "#1b6fff");
    ctx.fillStyle = grd;
    ctx.globalAlpha = blink ? 0.6 : 1;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.stroke();
    // engine flame
    ctx.globalCompositeOperation = "lighter";
    drawGlow(0, player.r * 1.1, 10 + Math.sin(game.time * 30) * 3, "rgba(120,220,255,0.9)", 0.8);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawEnemies() {
    for (const e of enemies) {
      drawGlow(e.x, e.y, e.r * 2.1, e.glow, e.boss ? 0.9 : 0.7);
    }
    for (const e of enemies) {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.angle + e.phase * 0.2);
      const flash = e.hitFlash > 0;
      ctx.fillStyle = flash ? "#ffffff" : e.color;
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = e.boss ? 3 : 1.6;
      drawShape(e.shape, e.r, e.phase);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // boss hp bar
      if (e.boss) {
        const w = e.r * 2.2, h = 6;
        const p = clamp(e.hp / e.maxHp, 0, 1);
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(e.x - w / 2, e.y - e.r - 16, w, h);
        ctx.fillStyle = "#ff3ea5";
        ctx.fillRect(e.x - w / 2, e.y - e.r - 16, w * p, h);
      }
    }
  }

  function drawShape(shape, r, phase) {
    ctx.beginPath();
    if (shape === "diamond") {
      ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath();
    } else if (shape === "tri") {
      ctx.moveTo(0, -r); ctx.lineTo(r * 0.9, r * 0.7); ctx.lineTo(-r * 0.9, r * 0.7); ctx.closePath();
    } else if (shape === "hex") {
      for (let i = 0; i < 6; i++) {
        const a = (TAU * i) / 6;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
    } else if (shape === "star") {
      for (let i = 0; i < 10; i++) {
        const a = (TAU * i) / 10 - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.45;
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
    } else {
      ctx.arc(0, 0, r, 0, TAU);
    }
  }

  function drawBullets() {
    ctx.globalCompositeOperation = "lighter";
    for (const b of bullets) {
      // trail
      if (b.trail.length > 1) {
        ctx.strokeStyle = b.glow;
        ctx.lineWidth = b.r * (b.long ? 1.8 : 1.2);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(b.trail[0].x, b.trail[0].y);
        for (let i = 1; i < b.trail.length; i++) ctx.lineTo(b.trail[i].x, b.trail[i].y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      drawGlow(b.x, b.y, b.r * 3, b.glow, 0.9);
      ctx.fillStyle = b.crit ? "#fff7d6" : "#ffffff";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.7, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawOrbiters() {
    ctx.globalCompositeOperation = "lighter";
    for (const o of orbiters) {
      drawGlow(o.x, o.y, o.r * 2.4, WEAPONS.orbit.glow, 0.9);
      ctx.fillStyle = "#eae0ff";
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r * 0.55, 0, TAU);
      ctx.fill();
    }
    // connecting energy line to player
    if (orbiters.length) {
      ctx.strokeStyle = "rgba(165,107,255,0.25)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const o of orbiters) {
        ctx.moveTo(player.x, player.y);
        ctx.lineTo(o.x, o.y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawGems() {
    ctx.globalCompositeOperation = "lighter";
    for (const g of gems) {
      const pulse = 0.7 + 0.3 * Math.sin(g.phase);
      drawGlow(g.x, g.y, 12 * pulse, "rgba(56,246,255,0.7)", 0.8);
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.phase * 0.4);
      ctx.fillStyle = "#bff6ff";
      ctx.beginPath();
      const r = g.r;
      ctx.moveTo(0, -r); ctx.lineTo(r * 0.7, 0); ctx.lineTo(0, r); ctx.lineTo(-r * 0.7, 0); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawShockwaves() {
    ctx.globalCompositeOperation = "lighter";
    for (const s of shockwaves) {
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = clamp(s.life, 0, 1);
      ctx.lineWidth = 3 + (1 - s.life) * 4;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function drawParticles() {
    ctx.globalCompositeOperation = "lighter";
    for (const p of particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function drawFloaters() {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of floaters) {
      const a = clamp(f.life, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = "800 " + f.size + "px system-ui, sans-serif";
      ctx.fillStyle = f.color;
      ctx.shadowColor = "rgba(0,0,0,0.9)";
      ctx.shadowBlur = 4;
      ctx.fillText(f.text, f.x, f.y);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------
  //  HUD
  // ---------------------------------------------------------------------
  function updateHud() {
    timeEl.textContent = fmtTime(game.time);
    levelEl.textContent = player.level;
    killsEl.textContent = game.kills;
    bestEl.textContent = fmtTime(game.best);
    const hpP = clamp(player.hp / player.maxHp, 0, 1);
    hpFill.style.width = (hpP * 100) + "%";
    hpText.textContent = Math.ceil(player.hp) + " / " + player.maxHp;
    const xpP = clamp(player.xp / player.xpNext, 0, 1);
    xpFill.style.width = (xpP * 100) + "%";
  }

  // ---------------------------------------------------------------------
  //  Game flow
  // ---------------------------------------------------------------------
  function setState(s) {
    game.state = s;
    if (s !== "playing") { touch.active = false; touch.id = null; touch.nx = 0; touch.ny = 0; }
    startScreen.classList.toggle("hidden", s !== "menu");
    levelupScreen.classList.toggle("hidden", s !== "levelup");
    pauseScreen.classList.toggle("hidden", s !== "paused");
    gameoverScreen.classList.toggle("hidden", s !== "gameover");
    hud.classList.toggle("hidden", s === "menu");
  }

  function resetRun() {
    enemies = []; bullets = []; gems = []; particles = [];
    floaters = []; shockwaves = []; orbiters = [];
    game.time = 0; game.kills = 0; game.shake = 0; game.hitFlash = 0;
    game.spawnTimer = 0; game.nextWaveAt = 30; game.waveCount = 0;
    wt.pulse = 0; wt.nova = 0; wt.spread = 0; wt.beam = 0;
    orbitAngle = 0;

    player.x = WORLD.w / 2; player.y = WORLD.h / 2;
    player.speed = 240; player.maxHp = 100; player.hp = 100;
    player.regen = 0; player.level = 1; player.xp = 0; player.xpNext = 5;
    player.pickupRange = 90; player.invuln = 0; player.facing = -Math.PI / 2;
    player.damageMul = 1; player.fireRateMul = 1; player.projectiles = 1;
    player.critChance = 0.05; player.xpMul = 1;
    player.weapons = { pulse: 1 };
    player.passives = {};
    player.trail = [];
    buildStars();
  }

  function startRun() {
    audio();
    resetRun();
    setState("playing");
    showWave("SURVIVE");
  }

  function togglePause() {
    if (game.state === "playing") { setState("paused"); renderBuildList(); }
    else if (game.state === "paused") setState("playing");
  }

  function renderBuildList() {
    const list = el("build-list");
    list.innerHTML = "";
    const add = (def, lv) => {
      const chip = document.createElement("div");
      chip.className = "build-chip";
      chip.innerHTML = '<span style="color:' + def.accent + '">' + def.icon + '</span>' +
        def.name + ' <b>Lv' + lv + '</b>';
      list.appendChild(chip);
    };
    for (const id in player.weapons) add(WEAPONS[id], player.weapons[id]);
    for (const id in player.passives) add(PASSIVES[id], player.passives[id]);
  }

  function die() {
    setState("gameover");
    sfx.dead();
    game.shake = 16;
    burst(player.x, player.y, "rgba(56,246,255,1)", 40, 300, [2, 5], 0.9);
    const isBest = game.time > game.best;
    if (isBest) { game.best = game.time; saveBest(); }
    el("final-time").textContent = fmtTime(game.time);
    el("final-level").textContent = player.level;
    el("final-kills").textContent = game.kills;
    el("final-best").textContent = fmtTime(game.best);
    el("newbest-badge").classList.toggle("hidden", !isBest);
  }

  function loadBest() {
    try {
      const v = parseFloat(localStorage.getItem(STORAGE_KEY) || "0");
      game.best = isFinite(v) ? v : 0;
    } catch (e) { game.best = 0; }
    el("start-best").textContent = fmtTime(game.best);
  }
  function saveBest() {
    try { localStorage.setItem(STORAGE_KEY, String(game.best)); } catch (e) {}
    el("start-best").textContent = fmtTime(game.best);
  }

  // ---------------------------------------------------------------------
  //  Main loop
  // ---------------------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // clamp big gaps

    if (game.state === "playing") {
      game.time += dt;
      updatePlayer(dt);
      fireWeapons(dt);
      updateOrbiters(dt);
      updateBullets(dt);
      updateEnemies(dt);
      updateGems(dt);
      updateSpawner(dt);
      updateEffects(dt);
      updateHud();
    } else {
      // keep effects alive on game over / menu for ambiance
      updateEffects(dt);
      if (game.state === "menu") game.time += 0; // frozen
    }

    // Always render the world (so menus show a live background if desired)
    if (game.state === "menu") {
      renderMenuBackground();
    } else {
      render();
    }

    requestAnimationFrame(frame);
  }

  // ambient background for the title screen
  let menuT = 0;
  function renderMenuBackground() {
    menuT += 0.016;
    ctx.clearRect(0, 0, viewW, viewH);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const layer of starLayers) {
      for (const s of layer.stars) {
        const px = (s.x * 0.4 + menuT * 12 * layer.depth) % viewW;
        const py = (s.y * 0.4) % viewH;
        const tw = 0.5 + 0.5 * Math.sin(s.tw + menuT * s.tws);
        ctx.fillStyle = layer.color + (0.2 + tw * 0.5) + ")";
        ctx.beginPath();
        ctx.arc(px, py, s.r * (0.7 + tw * 0.5), 0, TAU);
        ctx.fill();
      }
    }
    // slow drifting glow orbs
    for (let i = 0; i < 4; i++) {
      const x = viewW * (0.2 + 0.2 * i) + Math.sin(menuT * 0.4 + i) * 60;
      const y = viewH * 0.5 + Math.cos(menuT * 0.3 + i * 1.7) * 120;
      const colors = ["rgba(56,246,255,0.25)", "rgba(165,107,255,0.25)", "rgba(255,62,165,0.22)", "rgba(255,209,102,0.2)"];
      drawGlow(x, y, 140, colors[i], 0.6);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------
  //  Buttons
  // ---------------------------------------------------------------------
  el("start-btn").addEventListener("click", startRun);
  el("retry-btn").addEventListener("click", startRun);
  el("resume-btn").addEventListener("click", () => setState("playing"));
  el("quit-btn").addEventListener("click", () => setState("menu"));
  el("pause-btn").addEventListener("click", togglePause);

  // ---------------------------------------------------------------------
  //  Boot
  // ---------------------------------------------------------------------
  resize();
  loadBest();
  setState("menu");
  requestAnimationFrame(frame);
})();
