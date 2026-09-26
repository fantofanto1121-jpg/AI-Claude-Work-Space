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
  const dashBtn = el("dash-btn");
  const dashCdEl = dashBtn ? dashBtn.querySelector(".dash-cd") : null;

  const startScreen = el("start-screen");
  const levelupScreen = el("levelup-screen");
  const pauseScreen = el("pause-screen");
  const gameoverScreen = el("gameover-screen");
  const upgradeCards = el("upgrade-cards");

  const STORAGE_KEY = "starfall-arena-best-v2";
  const DIFF_KEY = "starfall-arena-diff";
  const modeEl = el("mode");

  // ---------------------------------------------------------------------
  //  Difficulty settings
  // ---------------------------------------------------------------------
  const DIFFICULTIES = {
    easy:   { key: "easy",   label: "イージー", hud: "EASY",
      enemyHpMul: 0.7, enemyDmgMul: 0.6, spawnMul: 1.35, bossHpMul: 0.78, xpMul: 1.15, startHp: 120,
      desc: "敵が柔らかく攻撃も控えめ。じっくり試したい人向け。" },
    normal: { key: "normal", label: "ノーマル", hud: "NORMAL",
      enemyHpMul: 1.0, enemyDmgMul: 1.0, spawnMul: 1.0, bossHpMul: 1.0, xpMul: 1.0, startHp: 100,
      desc: "設計どおりの標準バランス。" },
    hard:   { key: "hard",   label: "ハード", hud: "HARD",
      enemyHpMul: 1.4, enemyDmgMul: 1.35, spawnMul: 0.72, bossHpMul: 1.45, xpMul: 0.9, startHp: 80,
      desc: "敵が硬く手数も多い。ビルドの完成度が問われる。" },
    inferno: { key: "inferno", label: "インフェルノ", hud: "INFERNO",
      enemyHpMul: 1.9, enemyDmgMul: 2.0, spawnMul: 0.52, bossHpMul: 2.0, xpMul: 0.8, startHp: 60,
      desc: "最高難度。敵は激増し一撃が重い。極めても、油断は死。" },
  };
  let difficulty = "normal";
  let diff = DIFFICULTIES.normal;

  // Arena is a bounded world larger than the viewport; camera follows player.
  const WORLD = { w: 3200, h: 3200 };

  // Soft cap on concurrent non-boss enemies. The spawner ramps up forever, so
  // without this the field can balloon into hundreds (unfair walls + FPS drops)
  // when a run stalls. The cap keeps on-screen pressure high but bounded; bosses
  // and their adds are exempt so boss waves always arrive.
  const ENEMY_CAP = 300;

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
    if (k === " " && game.state === "playing") doDash();
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

  // Dash button — its own touch so it never feeds the movement joystick.
  if (dashBtn) {
    dashBtn.addEventListener("touchstart", (e) => {
      const a = audio();
      if (a && a.state === "suspended") a.resume().catch(() => {});
      doDash();
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    dashBtn.addEventListener("click", () => doDash());
  }

  // ---------------------------------------------------------------------
  //  Game state
  // ---------------------------------------------------------------------
  const game = {
    state: "menu", // menu | playing | levelup | paused | gameover
    time: 0,
    kills: 0,
    bossKills: 0,
    _committed: false,
    freeze: 0,
    slow: 0,          // bullet-time on player hit
    expFlash: 0,      // explosion-light screen flash
    expFlashCol: "255,240,220",
    best: 0,
    bests: { easy: 0, normal: 0, hard: 0, inferno: 0 },
    shake: 0,
    hitFlash: 0,
    cam: { x: 0, y: 0 },
    spawnTimer: 0,
    difficulty: 1,
    nextWaveAt: 30,
    waveCount: 0,
    bossIndex: 0,
  };

  const player = {
    x: 0, y: 0, r: 16,
    speed: 240,
    hp: 100, maxHp: 100,
    level: 1, xp: 0, xpNext: 4,
    pickupRange: 120,
    invuln: 0,
    facing: 0,
    // dash (space / on-screen button): brief burst that runs enemies over
    dashTime: 0, dashCd: 0, dashDX: 0, dashDY: -1, dashHit: null,
    // combat multipliers (modified by upgrades)
    damageMul: 1,
    fireRateMul: 1,
    projectiles: 1,
    critChance: 0.05,
    critMul: 2,           // crit damage multiplier
    xpMul: 1,
    rangeMul: 1,          // weapon range multiplier
    projSpeedMul: 1,      // projectile speed multiplier
    aoeMul: 1,            // nova / aura radius multiplier
    armor: 0,             // fraction of damage reduced
    lifestealChance: 0,   // chance to heal on kill
    lifestealHeal: 6,     // hp healed when it procs
    projectileSize: 1,    // bullet radius multiplier
    revives: 0,           // extra lives
    berserk: false,       // low-hp damage bonus
    thorns: 0,            // contact reflect damage
    // signature mechanics
    shieldMax: 0, shield: 0, shieldTimer: 0, // regenerating absorb shield
    counter: 0,           // nova on taking damage (level)
    executePct: 0,        // execute enemies below this HP fraction
    critblast: 0,         // AoE on crit (level)
    coldblood: 0,         // crit up while still (level)
    stillTime: 0,         // seconds stationary
    voidburst: 0,         // enemies explode on death (level)
    bloodhitChance: 0,    // heal chance on hit
    vapor: 0,             // damaging move-trail (level)
    // new signature mechanics
    cryo: 0,              // chance to deep-freeze struck enemies (level)
    ricochet: 0,          // bullets bounce to new targets (level = bounces)
    overload: 0,          // kills build temporary damage stacks (level)
    overStacks: 0, overTimer: 0,
    // extended-roster mechanics
    pierceBonus: 0,       // +pierce on every bullet
    bossDmg: 0,           // bonus damage vs bosses (weakpoint)
    regen: 0,             // hp regenerated per second
    bulwark: 0,           // extra armor while stationary (level)
    swarm: 0,             // damage scales with nearby enemy count (level)
    crowdBonus: 0,        // cached swarm bonus this frame
    adrenaline: 0,        // damage/speed surge after taking a hit (level)
    adrenTimer: 0,
    harvest: 0,           // heal on gem pickup (level)
    momentum: 0,          // damage while moving (level)
    weapons: {},   // id -> level
    passives: {},  // id -> level
    trail: [],
    vaporTrail: [],
    // power-ups & scoring
    buffs: [],     // active timed power-ups: {type, t, deltas?}
    score: 0, combo: 0, comboTimer: 0,
    comboEdge: 0,  // damage scales with combo
    luck: 0,       // power-up drop rate
  };

  // Effective damage multiplier (folds in the dynamic berserk bonus).
  function dmgMul() {
    let m = player.damageMul;
    if (player.berserk) m *= 1 + 0.45 * (1 - clamp(player.hp / player.maxHp, 0, 1));
    if (player.comboEdge && player.combo > 0) {
      m *= 1 + Math.min(player.comboEdge * 0.2, player.combo * 0.008 * player.comboEdge);
    }
    if (player.overStacks > 0) m *= 1 + player.overStacks * 0.03; // overload snowball
    if (player.crowdBonus > 0) m *= 1 + player.crowdBonus;                                  // swarm core
    if (player.momentum > 0 && player.stillTime < 0.12) m *= 1 + player.momentum * 0.08;    // momentum (while moving)
    if (player.adrenaline > 0 && player.adrenTimer > 0) m *= 1 + player.adrenaline * 0.12;  // adrenaline surge
    return m;
  }

  // Entity pools
  let enemies = [];
  let bullets = [];
  let gems = [];
  let powerups = []; // timed power-up drops
  let sparks = [];   // muzzle flashes / impact sparks / kill flashes (additive)
  let debris = [];   // spinning shrapnel shards from explosions
  let booms = [];     // scheduled secondary blasts (boss chain explosions)
  let smoke = [];     // soft lingering smoke puffs
  let particles = [];
  let floaters = []; // damage numbers / text
  let shockwaves = [];
  let orbiters = [];
  let lightnings = []; // chain-lightning arcs (visual, short-lived)
  let slashes = [];    // arc-whip sweep arcs (visual, short-lived)
  let enemyBullets = []; // hostile projectiles (sentry boss)

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
    dash: () => { beep(420, 0.08, "sawtooth", 0.05); setTimeout(() => beep(820, 0.1, "sine", 0.045), 45); },
    power: () => { beep(700, 0.09, "triangle", 0.06); setTimeout(() => beep(1180, 0.16, "sine", 0.05), 60); },
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
    chain: {
      name: "チェインライトニング", icon: "↯", tag: "WEAPON",
      color: "rgba(140,220,255,1)", accent: "#8cdcff", glow: "rgba(140,220,255,0.55)",
      max: 6,
      desc: (lv) => lv === 0 ? "敵から敵へ連鎖する稲妻を放つ。"
        : "連鎖数と威力が増す。(Lv" + (lv + 1) + ")",
    },
    homing: {
      name: "ホーミングドローン", icon: "◈", tag: "WEAPON",
      color: "rgba(120,255,190,1)", accent: "#68ffc0", glow: "rgba(120,255,190,0.55)",
      max: 6,
      desc: (lv) => lv === 0 ? "敵を追尾する誘導弾を射出する。"
        : "弾数と旋回・威力が上がる。(Lv" + (lv + 1) + ")",
    },
    aura: {
      name: "パルサーオーラ", icon: "◉", tag: "WEAPON",
      color: "rgba(255,120,210,1)", accent: "#ff78d2", glow: "rgba(255,120,210,0.5)",
      max: 6,
      desc: (lv) => lv === 0 ? "自機を包む破壊の光輪。触れた敵を焼く。"
        : "範囲と威力が拡大する。(Lv" + (lv + 1) + ")",
    },
    missile: {
      name: "ミサイルポッド", icon: "➶", tag: "WEAPON",
      color: "rgba(255,150,90,1)", accent: "#ff965a", glow: "rgba(255,150,90,0.55)",
      max: 6,
      desc: (lv) => lv === 0 ? "着弾で炸裂する誘導ミサイルを撃ち出す。"
        : "弾数・威力・爆風が拡大する。(Lv" + (lv + 1) + ")",
    },
    boomerang: {
      name: "グレイブブーメラン", icon: "↺", tag: "WEAPON",
      color: "rgba(120,255,235,1)", accent: "#78ffeb", glow: "rgba(120,255,235,0.55)",
      max: 6,
      desc: (lv) => lv === 0 ? "往復して貫通する回転刃。行きも帰りも敵を斬る。"
        : "刃数・威力・射程が伸びる。(Lv" + (lv + 1) + ")",
    },
    // ---- signature weapons ------------------------------------------------
    gravity: {
      name: "グラビティウェル", icon: "⊛", tag: "ウォーデン専用",
      color: "rgba(120,255,190,1)", accent: "#7affc8", glow: "rgba(80,255,170,0.5)",
      max: 6,
      desc: (lv) => lv === 0 ? "自機の周囲に重力場を展開。中の敵を鈍足化し削る。"
        : "範囲・威力・減速が強まる。(Lv" + (lv + 1) + ")",
    },
    storm: {
      name: "ストームコール", icon: "彡", tag: "テンペスト専用",
      color: "rgba(160,180,255,1)", accent: "#a6b4ff", glow: "rgba(150,170,255,0.55)",
      max: 6,
      desc: (lv) => lv === 0 ? "無差別に落雷を呼び、範囲内の敵を撃つ。"
        : "落雷数と威力が増す。(Lv" + (lv + 1) + ")",
    },
    deadeye: {
      name: "デッドアイ", icon: "⊹", tag: "ハンター専用",
      color: "rgba(255,209,102,1)", accent: "#ffd166", glow: "rgba(255,209,102,0.5)",
      max: 6,
      desc: (lv) => lv === 0 ? "低速だが超高威力の貫通弾を最も硬い敵へ撃つ。"
        : "威力・貫通・連射が上がる。(Lv" + (lv + 1) + ")",
    },
    staticfield: {
      name: "静電フィールド", icon: "⌇", tag: "テンペスト専用",
      color: "rgba(160,180,255,1)", accent: "#a6b4ff", glow: "rgba(150,170,255,0.55)",
      max: 5,
      desc: (lv) => lv === 0 ? "周囲の敵へ絶えず微弱な電撃を放つ帯電フィールド。"
        : "射程と電撃数・威力が増す。(Lv" + (lv + 1) + ")",
    },
    // ---- extended weapons (widen playstyles / cut roster overlap) ----
    flak: {
      name: "フラックバースト", icon: "✺", tag: "WEAPON",
      color: "rgba(255,170,90,1)", accent: "#ffaa5a", glow: "rgba(255,150,70,0.55)",
      max: 6,
      desc: (lv) => lv === 0 ? "低速の榴弾を撃ち、着弾点で炸裂して範囲の敵を薙ぐ。"
        : "弾数・爆風・威力が拡大する。(Lv" + (lv + 1) + ")",
    },
    fork: {
      name: "スプリットショット", icon: "Ψ", tag: "WEAPON",
      color: "rgba(120,255,235,1)", accent: "#78ffeb", glow: "rgba(120,255,235,0.55)",
      max: 6,
      desc: (lv) => lv === 0 ? "命中した弾が分裂し、左右の敵へ二次弾を撒く速射砲。"
        : "分裂数・連射・威力が増す。(Lv" + (lv + 1) + ")",
    },
    plasmaorb: {
      name: "プラズマオーブ", icon: "⦿", tag: "WEAPON",
      color: "rgba(180,130,255,1)", accent: "#b482ff", glow: "rgba(165,107,255,0.55)",
      max: 6,
      desc: (lv) => lv === 0 ? "低速の巨大プラズマ球を放ち、群れを貫いて焼き払う。"
        : "サイズ・貫通・威力が拡大する。(Lv" + (lv + 1) + ")",
    },
    frost: {
      name: "フロストランス", icon: "❆", tag: "WEAPON",
      color: "rgba(150,225,255,1)", accent: "#96e1ff", glow: "rgba(140,220,255,0.55)",
      max: 6,
      desc: (lv) => lv === 0 ? "貫通する氷槍を撃ち、当たった敵を凍らせ鈍足化する。"
        : "貫通・威力・凍結が強まる。(Lv" + (lv + 1) + ")",
    },
    cluster: {
      name: "クラスターボム", icon: "⁂", tag: "WEAPON",
      color: "rgba(255,140,110,1)", accent: "#ff8c6e", glow: "rgba(255,120,90,0.55)",
      max: 6,
      desc: (lv) => lv === 0 ? "着弾で炸裂し、四方へ子弾を撒き散らす拡散弾。"
        : "子弾数・爆風・威力が増す。(Lv" + (lv + 1) + ")",
    },
    whip: {
      name: "アークウィップ", icon: "⟋", tag: "WEAPON",
      color: "rgba(255,120,200,1)", accent: "#ff78c8", glow: "rgba(255,120,200,0.55)",
      max: 6,
      desc: (lv) => lv === 0 ? "自機の前方を薙ぐ光の鞭。近距離の敵をまとめて斬る。"
        : "範囲・威力・薙ぎ速度が増す。(Lv" + (lv + 1) + ")",
    },
    seeker: {
      name: "シーカー", icon: "⊚", tag: "WEAPON",
      color: "rgba(120,255,190,1)", accent: "#78ffbe", glow: "rgba(120,255,190,0.55)",
      max: 6,
      desc: (lv) => lv === 0 ? "多数の小型追尾弾を斉射し、敵を執拗に追い回す。"
        : "弾数・旋回・威力が増す。(Lv" + (lv + 1) + ")",
    },
  };

  const PASSIVES = {
    power: { name: "オーバードライブ", icon: "❖", tag: "PASSIVE", accent: "#ff9d5a", glow: "rgba(255,157,90,0.5)", max: 8,
      desc: () => "全武器のダメージ +15%。" },
    haste: { name: "ヘイストコア", icon: "≫", tag: "PASSIVE", accent: "#38f6ff", glow: "rgba(56,246,255,0.5)", max: 8,
      desc: () => "攻撃速度 +12%。" },
    swift: { name: "スラスター", icon: "➤", tag: "PASSIVE", accent: "#78ffbe", glow: "rgba(120,255,190,0.5)", max: 6,
      desc: () => "移動速度 +10%。" },
    vitality: { name: "ハルプレート", icon: "✛", tag: "共通・レア", accent: "#ff5a5a", glow: "rgba(255,90,90,0.5)", max: 8,
      desc: () => "最大HP +25 （＆全回復）。極稀に出現。" },
    fullheal: { name: "リペアバースト", icon: "✚", tag: "共通・レア", accent: "#78ffbe", glow: "rgba(120,255,190,0.5)", max: 99,
      desc: () => "HPを全回復する。極稀に出現。" },
    magnet: { name: "マグネットフィールド", icon: "◎", tag: "PASSIVE", accent: "#a56bff", glow: "rgba(165,107,255,0.5)", max: 5,
      desc: () => "欠片の回収範囲 +40%。" },
    crit: { name: "フォーカスレンズ", icon: "◆", tag: "PASSIVE", accent: "#ffd166", glow: "rgba(255,209,102,0.5)", max: 6,
      desc: () => "クリティカル率 +8%（2倍ダメージ）。" },
    greed: { name: "スターグリード", icon: "★", tag: "PASSIVE", accent: "#ffd166", glow: "rgba(255,209,102,0.5)", max: 5,
      desc: () => "獲得経験値 +20%。" },
    armor: { name: "アダマント装甲", icon: "⬡", tag: "PASSIVE", accent: "#9fb4ff", glow: "rgba(159,180,255,0.5)", max: 6,
      desc: () => "被ダメージを 10% 軽減。" },
    lifesteal: { name: "ヴァンパイアコア", icon: "♥", tag: "PASSIVE", accent: "#ff5a8a", glow: "rgba(255,90,138,0.5)", max: 5,
      desc: () => "撃破時 10% の確率でHPを 6 回復。" },
    bigshot: { name: "ヘヴィラウンド", icon: "⬤", tag: "PASSIVE", accent: "#ffb84d", glow: "rgba(255,184,77,0.5)", max: 5,
      desc: () => "弾のサイズ +20%（＆威力 +6%）。" },
    revive: { name: "フェニックスコア", icon: "✧", tag: "PASSIVE", accent: "#ff9d5a", glow: "rgba(255,157,90,0.55)", max: 1,
      desc: () => "力尽きた時1度だけ復活（HP半分＆周囲を一掃）。" },
    multishot: { name: "マルチショット", icon: "⋔", tag: "PASSIVE", accent: "#38f6ff", glow: "rgba(56,246,255,0.5)", max: 2,
      desc: () => "射出する弾を1発追加。" },
    longshot: { name: "ロングバレル", icon: "⟜", tag: "PASSIVE", accent: "#8cdcff", glow: "rgba(140,220,255,0.5)", max: 5,
      desc: () => "武器の射程 +18%。" },
    velocity: { name: "アクセルチャージ", icon: "»", tag: "PASSIVE", accent: "#78ffbe", glow: "rgba(120,255,190,0.5)", max: 5,
      desc: () => "弾速 +18%。" },
    blast: { name: "エクスパンダー", icon: "◌", tag: "PASSIVE", accent: "#ff78d2", glow: "rgba(255,120,210,0.5)", max: 5,
      desc: () => "ノヴァ／オーラの範囲 +16%。" },
    sniper: { name: "クリティカルエッジ", icon: "✦", tag: "PASSIVE", accent: "#ffd166", glow: "rgba(255,209,102,0.5)", max: 4,
      desc: () => "クリティカル倍率 +0.4。" },
    glass: { name: "グラスキャノン", icon: "◇", tag: "PASSIVE", accent: "#ff5a8a", glow: "rgba(255,90,138,0.5)", max: 1,
      desc: () => "ダメージ +40%／最大HP -20。" },
    berserk: { name: "バーサーカー", icon: "⯍", tag: "ファントム専用", accent: "#ff5a5a", glow: "rgba(255,90,90,0.5)", max: 1,
      desc: () => "HPが低いほどダメージ上昇（最大 +45%）。" },
    thorns: { name: "ソーンオーラ", icon: "✷", tag: "ウォーデン専用", accent: "#9fb4ff", glow: "rgba(159,180,255,0.5)", max: 5,
      desc: () => "接触した敵に反射ダメージ。" },
    // ---- Warden signatures ----
    shield: { name: "バリアジェネレータ", icon: "⛭", tag: "ウォーデン専用", accent: "#9fb4ff", glow: "rgba(159,180,255,0.5)", max: 5,
      desc: () => "被弾を肩代わりする再生シールド +25（時間で回復）。" },
    counter: { name: "リアクティブノヴァ", icon: "⊕", tag: "ウォーデン専用", accent: "#7affc8", glow: "rgba(80,255,170,0.5)", max: 4,
      desc: () => "被弾時に衝撃波で反撃する。" },
    // ---- Hunter signatures ----
    execute: { name: "ハンターズマーク", icon: "†", tag: "ハンター専用", accent: "#ffd166", glow: "rgba(255,209,102,0.5)", max: 4,
      desc: (lv) => "HPが " + (8 + (lv||0) * 3) + "% 以下の敵を即撃破（ボス除く）。" },
    critblast: { name: "ヘッドショット", icon: "✸", tag: "ハンター専用", accent: "#ffb84d", glow: "rgba(255,184,77,0.5)", max: 4,
      desc: () => "会心命中で小爆発を起こす。" },
    coldblood: { name: "コールドブラッド", icon: "❄", tag: "ハンター専用", accent: "#8cdcff", glow: "rgba(140,220,255,0.5)", max: 4,
      desc: () => "静止中はクリティカル率が大きく上がる。" },
    // ---- Phantom signatures ----
    voidburst: { name: "ヴォイドバースト", icon: "❂", tag: "ファントム専用", accent: "#ff5a7a", glow: "rgba(255,90,120,0.5)", max: 4,
      desc: () => "撃破した敵が爆発し周囲を巻き込む。" },
    bloodhit: { name: "ブラッドドリンカー", icon: "♢", tag: "ファントム専用", accent: "#ff5a8a", glow: "rgba(255,90,138,0.5)", max: 4,
      desc: () => "攻撃命中時に確率でHPを吸収する。" },
    vapor: { name: "ヴェイパートレイル", icon: "≈", tag: "ファントム専用", accent: "#ff9dc0", glow: "rgba(255,157,192,0.5)", max: 4,
      desc: () => "移動中に敵を焼く残像を残す。" },
    // ---- new signature mechanics (drive the unlockable costumes' identities) ----
    cryo: { name: "クライオバースト", icon: "❄", tag: "グレイシア専用", accent: "#8cdcff", glow: "rgba(140,220,255,0.55)", max: 5,
      desc: (lv) => "命中時 " + (13 + (lv || 0) * 9) + "% で敵を氷結・鈍足化する。" },
    ricochet: { name: "リコシェット", icon: "⟳", tag: "リフレクス専用", accent: "#78ffbe", glow: "rgba(120,255,190,0.55)", max: 5,
      desc: (lv) => "弾が命中後、別の敵へ跳ね返る（" + ((lv || 0) + 1) + "回）。" },
    overload: { name: "オーバーロード", icon: "≡", tag: "イグニス専用", accent: "#ffb84d", glow: "rgba(255,184,77,0.55)", max: 5,
      desc: (lv) => "撃破ごとにダメージが累積上昇（最大 +" + ((lv || 0) + 1) * 12 * 3 + "%、止まると解除）。" },
    // ---- combo / power-up synergies ----
    comboedge: { name: "コンボエッジ", icon: "⟰", tag: "PASSIVE", accent: "#ff78d2", glow: "rgba(255,120,210,0.5)", max: 5,
      desc: (lv) => "コンボ中、コンボ数に応じてダメージ上昇（最大 +" + (((lv || 0) + 1) * 20) + "%）。" },
    lucky: { name: "ラッキースター", icon: "❉", tag: "PASSIVE", accent: "#ffd166", glow: "rgba(255,209,102,0.5)", max: 4,
      desc: () => "パワーアップの出現率が上昇する。" },
    // ---- extended roster (adds distinct playstyles; reduces overlap) ----
    pierce: { name: "ペネトレイター", icon: "↠", tag: "PASSIVE", accent: "#8cdcff", glow: "rgba(140,220,255,0.5)", max: 4,
      desc: () => "弾の貫通数 +1。" },
    weakpoint: { name: "ウィークポイント", icon: "⊙", tag: "PASSIVE", accent: "#ffd166", glow: "rgba(255,209,102,0.5)", max: 5,
      desc: (lv) => "ボスへ与えるダメージ +" + (((lv || 0) + 1) * 20) + "%。" },
    regen: { name: "リジェネコア", icon: "✜", tag: "PASSIVE", accent: "#78ffbe", glow: "rgba(120,255,190,0.5)", max: 5,
      desc: (lv) => "毎秒 HP を " + (((lv || 0) + 1) * 1.2).toFixed(1) + " 回復する。" },
    bulwark: { name: "ブルワーク", icon: "⬢", tag: "PASSIVE", accent: "#9fb4ff", glow: "rgba(159,180,255,0.5)", max: 5,
      desc: (lv) => "静止中、被ダメージを追加で " + (((lv || 0) + 1) * 8) + "% 軽減する。" },
    swarm: { name: "スウォームコア", icon: "❈", tag: "PASSIVE", accent: "#ff78d2", glow: "rgba(255,120,210,0.5)", max: 5,
      desc: () => "近くの敵の数に応じてダメージ上昇（最大 +60%）。" },
    adrenaline: { name: "アドレナリン", icon: "⇑", tag: "PASSIVE", accent: "#ff5a5a", glow: "rgba(255,90,90,0.5)", max: 5,
      desc: (lv) => "被弾直後の数秒、ダメージ +" + (((lv || 0) + 1) * 12) + "%・移動速度上昇。" },
    harvest: { name: "ハーヴェスト", icon: "❊", tag: "PASSIVE", accent: "#78ffbe", glow: "rgba(120,255,190,0.5)", max: 5,
      desc: (lv) => "欠片の回収で HP を " + (((lv || 0) + 1) * 0.6).toFixed(1) + " 回復する。" },
    momentum: { name: "モメンタム", icon: "↝", tag: "PASSIVE", accent: "#38f6ff", glow: "rgba(56,246,255,0.5)", max: 5,
      desc: (lv) => "移動中、ダメージ +" + (((lv || 0) + 1) * 8) + "%。" },
    // ---- endless upgrades (never max; keep late-game choices flowing) ----
    e_power: { name: "オーバークロック", icon: "▲", tag: "エンドレス", accent: "#ff9d5a", glow: "rgba(255,157,90,0.5)", max: 999,
      desc: (lv) => "全武器のダメージ +8%。（累積 " + ((lv || 0) + 1) + "）" },
    e_haste: { name: "アクセルコア", icon: "✦", tag: "エンドレス", accent: "#38f6ff", glow: "rgba(56,246,255,0.5)", max: 999,
      desc: (lv) => "攻撃速度 +7%。（累積 " + ((lv || 0) + 1) + "）" },
    e_vit: { name: "ナノリペア", icon: "✚", tag: "エンドレス", accent: "#78ffbe", glow: "rgba(120,255,190,0.5)", max: 999,
      desc: (lv) => "最大HP +15（＆15回復）。（累積 " + ((lv || 0) + 1) + "）" },
    e_swift: { name: "ブースター", icon: "»", tag: "エンドレス", accent: "#7affc8", glow: "rgba(120,255,190,0.5)", max: 999,
      desc: (lv) => "移動速度 +12。（累積 " + ((lv || 0) + 1) + "）" },
    e_crit: { name: "コアチャージ", icon: "★", tag: "エンドレス", accent: "#ffd166", glow: "rgba(255,209,102,0.5)", max: 999,
      desc: (lv) => "クリティカル率 +3%。（累積 " + ((lv || 0) + 1) + "）" },
  };
  const ENDLESS_SKILLS = ["e_power", "e_haste", "e_vit", "e_swift", "e_crit"];

  // ---------------------------------------------------------------------
  //  Costumes  (each defines a ship look + its own skill pool)
  // ---------------------------------------------------------------------
  // Two "universal rare" skills appear in every costume at a tiny weight.
  const UNIVERSAL_SKILLS = ["fullheal", "vitality"];
  const RARE_WEIGHT = 0.06;

  // Vanguard is the "standard" costume and owns the original generic roster.
  // The other four are built mostly from their own signature skills so each
  // one plays clearly differently.
  const COSTUMES = {
    vanguard: {
      name: "ヴァンガード", label: "VANGUARD", swatch: "#38f6ff",
      desc: "王道の万能機。定番の武器と汎用強化を幅広く扱える。",
      ship: { glow: "rgba(56,246,255,0.6)", g0: "#eafcff", g1: "#38f6ff", g2: "#1b6fff", flame: "rgba(120,220,255,0.9)", shape: "interceptor" },
      skills: ["pulse", "spread", "homing", "beam", "missile", "plasmaorb", "power", "haste", "multishot", "velocity", "crit", "bigshot", "swift", "magnet", "revive", "comboedge", "swarm", "momentum"],
    },
    warden: {
      name: "ウォーデン", label: "WARDEN", swatch: "#46f0a0",
      desc: "要塞型。シールドと反撃、重力場で敵を抱え込んで潰す。",
      ship: { glow: "rgba(80,255,170,0.6)", g0: "#eafff4", g1: "#46f0a0", g2: "#12b070", flame: "rgba(120,255,190,0.9)", shape: "fortress" },
      skills: ["gravity", "orbit", "nova", "homing", "cluster", "shield", "counter", "armor", "bigshot", "blast", "power", "haste", "magnet", "revive"],
    },
    tempest: {
      name: "テンペスト", label: "TEMPEST", swatch: "#a56bff",
      desc: "無差別掃射型。落雷と帯電で画面全体の敵を捌く。",
      ship: { glow: "rgba(165,107,255,0.6)", g0: "#f3eaff", g1: "#a56bff", g2: "#6a2bd0", flame: "rgba(200,150,255,0.9)", shape: "bolt" },
      skills: ["chain", "storm", "staticfield", "beam", "boomerang", "swarm", "velocity", "longshot", "haste", "blast", "multishot", "magnet", "comboedge", "lucky"],
    },
    hunter: {
      name: "ハンター", label: "HUNTER", swatch: "#ffd166",
      desc: "一撃必殺型。会心と処刑で硬い敵を一瞬で仕留める。",
      ship: { glow: "rgba(255,190,90,0.6)", g0: "#fff5e0", g1: "#ffb84d", g2: "#d07a1a", flame: "rgba(255,210,120,0.9)", shape: "lance" },
      skills: ["deadeye", "beam", "spread", "execute", "critblast", "coldblood", "weakpoint", "crit", "pierce", "longshot", "velocity", "magnet", "revive", "harvest"],
    },
    phantom: {
      name: "ファントム", label: "PHANTOM", swatch: "#ff5a7a",
      desc: "自壊高火力型。撃破の連鎖爆発と吸血で押し切る紅の機体。",
      ship: { glow: "rgba(255,90,120,0.6)", g0: "#ffe6ea", g1: "#ff5a7a", g2: "#c01530", flame: "rgba(255,140,160,0.9)", shape: "scythe" },
      skills: ["chain", "aura", "voidburst", "bloodhit", "vapor", "whip", "berserk", "glass", "lifesteal", "adrenaline", "power", "swift", "magnet", "comboedge"],
    },
    // ---- unlockable costumes (condition-gated) ----
    razor: {
      name: "レイザー", label: "RAZOR", swatch: "#7fd8ff",
      desc: "高速精密機。連射と長射程で近い敵を素早く切り裂く。",
      ship: { glow: "rgba(120,220,255,0.6)", g0: "#f0fbff", g1: "#7fd8ff", g2: "#2a72d0", flame: "rgba(160,230,255,0.9)", shape: "dart" },
      skills: ["pulse", "beam", "deadeye", "spread", "crit", "sniper", "haste", "velocity", "swift", "pierce", "momentum", "longshot", "comboedge", "bigshot"],
      unlock: { desc: "累計500体を撃破", test: (p) => p.kills >= 500 },
    },
    nocturne: {
      name: "ノクターン", label: "NOCTURNE", swatch: "#8c7bff",
      desc: "闇の暗殺機。会心と処刑、撃破の連鎖爆発で静かに刈る。",
      ship: { glow: "rgba(140,120,255,0.6)", g0: "#efeaff", g1: "#8c7bff", g2: "#3a2a9e", flame: "rgba(170,150,255,0.9)", shape: "wraith" },
      skills: ["deadeye", "chain", "voidburst", "execute", "coldblood", "crit", "sniper", "glass", "vapor", "velocity", "momentum", "harvest", "magnet", "revive"],
      unlock: { desc: "レベル15に到達", test: (p) => p.maxLevel >= 15 },
    },
    colossus: {
      name: "コロッサス", label: "COLOSSUS", swatch: "#ffa64d",
      desc: "超重量の砲塔要塞。重力場と範囲砲、対大型火力で戦線を踏み潰す。",
      ship: { glow: "rgba(255,160,80,0.6)", g0: "#fff0e0", g1: "#ffa64d", g2: "#b25a12", flame: "rgba(255,190,120,0.9)", shape: "titan" },
      skills: ["nova", "gravity", "flak", "spread", "weakpoint", "bulwark", "armor", "power", "bigshot", "blast", "haste", "greed", "revive", "glass"],
      unlock: { desc: "ボスを累計5体撃破", test: (p) => p.bosses >= 5 },
    },
    orbiter: {
      name: "オービター", label: "ORBITER", swatch: "#57f0c8",
      desc: "円盤型の制圧機。周回刃と帯電・連鎖で群れごと薙ぎ払う。",
      ship: { glow: "rgba(90,255,210,0.6)", g0: "#eafff8", g1: "#57f0c8", g2: "#12a888", flame: "rgba(140,255,220,0.9)", shape: "saucer" },
      skills: ["orbit", "staticfield", "chain", "seeker", "swarm", "harvest", "magnet", "blast", "swift", "haste", "velocity", "greed", "lucky", "revive"],
      unlock: { desc: "1回のプレイで3分生存", test: (p) => maxBestTime(p) >= 180 },
    },
    manta: {
      name: "マンタ", label: "MANTA", swatch: "#4fbfff",
      desc: "滑空型。誘導弾とミサイル、往復刃で広く弾幕を張る。",
      ship: { glow: "rgba(90,200,255,0.6)", g0: "#e8f8ff", g1: "#4fbfff", g2: "#1466c0", flame: "rgba(150,220,255,0.9)", shape: "manta" },
      skills: ["homing", "missile", "boomerang", "fork", "aura", "velocity", "longshot", "multishot", "swift", "harvest", "swarm", "magnet", "greed", "revive"],
      unlock: { desc: "スコア30,000を達成", test: (p) => p.bestScore >= 30000 },
    },
    pike: {
      name: "パイク", label: "PIKE", swatch: "#ff4d6d",
      desc: "純粋な狙撃槍。貫通と会心で硬い敵を一直線に貫く。",
      ship: { glow: "rgba(255,80,110,0.6)", g0: "#ffe6ea", g1: "#ff4d6d", g2: "#b01030", flame: "rgba(255,130,150,0.9)", shape: "pike" },
      skills: ["beam", "deadeye", "frost", "sniper", "execute", "pierce", "longshot", "bigshot", "glass", "power", "momentum", "swift", "revive", "velocity"],
      unlock: { desc: "累計2,000体を撃破", test: (p) => p.kills >= 2000 },
    },
    scarab: {
      name: "スカラベ", label: "SCARAB", swatch: "#c8f04d",
      desc: "甲殻の格闘機。吸血と反射、低HP火力で乱戦を制す。",
      ship: { glow: "rgba(200,255,90,0.6)", g0: "#f6ffe0", g1: "#c8f04d", g2: "#7aa815", flame: "rgba(220,255,140,0.9)", shape: "scarab" },
      skills: ["chain", "aura", "whip", "lifesteal", "bloodhit", "thorns", "berserk", "adrenaline", "armor", "power", "bigshot", "harvest", "greed", "revive"],
      unlock: { desc: "ハードで2分生存", test: (p) => p.bestTime.hard >= 120 },
    },
    falcon: {
      name: "ファルコン", label: "FALCON", swatch: "#ffd97a",
      desc: "熟練の万能エース。会心寄りの安定した攻めが持ち味。",
      ship: { glow: "rgba(255,225,150,0.6)", g0: "#fffdf5", g1: "#ffd97a", g2: "#c99a2a", flame: "rgba(255,235,170,0.9)", shape: "falcon" },
      skills: ["fork", "pulse", "spread", "seeker", "crit", "sniper", "haste", "velocity", "longshot", "swift", "magnet", "greed", "comboedge", "harvest"],
      unlock: { desc: "ボスを累計20体撃破", test: (p) => p.bosses >= 20 },
    },
    seraph: {
      name: "セラフ", label: "SERAPH", swatch: "#ffcf5a",
      desc: "光輝の支援機。落雷と光輪、衝撃波で画面を制圧する。",
      ship: { glow: "rgba(255,210,110,0.65)", g0: "#fff7e6", g1: "#ffcf5a", g2: "#c98a1a", flame: "rgba(255,225,140,0.95)", shape: "seraph" },
      skills: ["nova", "aura", "storm", "flak", "cluster", "swarm", "power", "haste", "magnet", "greed", "lucky", "revive", "bigshot", "longshot"],
      unlock: { desc: "レベル30に到達", test: (p) => p.maxLevel >= 30 },
    },
    novastar: {
      name: "ノヴァスター", label: "NOVASTAR", swatch: "#ff5ac8",
      desc: "全兵装の頂点。あらゆる武器を束ねる究極の星艦。",
      ship: { glow: "rgba(255,90,200,0.6)", g0: "#ffe6f5", g1: "#ff5ac8", g2: "#c01590", flame: "rgba(255,140,220,0.9)", shape: "starcruiser" },
      skills: ["pulse", "nova", "chain", "homing", "missile", "plasmaorb", "deadeye", "gravity", "weakpoint", "crit", "power", "haste", "multishot", "comboedge"],
      unlock: { desc: "インフェルノで2分生存", test: (p) => p.bestTime.inferno >= 120 },
    },
    // ---- signature-mechanic costumes (distinct playstyles) ----
    glacia: {
      name: "グレイシア", label: "GLACIA", swatch: "#8cdcff",
      desc: "氷結制圧機。命中で敵を凍らせ鈍足化し、盤面を支配する。",
      ship: { glow: "rgba(140,220,255,0.6)", g0: "#eafaff", g1: "#8cdcff", g2: "#2f7fd0", flame: "rgba(180,235,255,0.9)", shape: "crystal" },
      skills: ["cryo", "frost", "beam", "staticfield", "gravity", "aura", "weakpoint", "regen", "longshot", "crit", "bigshot", "armor", "magnet", "revive"],
      unlock: { desc: "ボスを累計12体撃破", test: (p) => p.bosses >= 12 },
    },
    reflex: {
      name: "リフレクス", label: "REFLEX", swatch: "#78ffbe",
      desc: "跳弾機。弾が敵から敵へ跳ね返り、密集を一掃する。",
      ship: { glow: "rgba(120,255,190,0.6)", g0: "#eafff4", g1: "#78ffbe", g2: "#1aa86e", flame: "rgba(160,255,210,0.9)", shape: "kite" },
      skills: ["ricochet", "pulse", "spread", "fork", "homing", "multishot", "pierce", "velocity", "bigshot", "haste", "swift", "comboedge", "adrenaline", "crit"],
      unlock: { desc: "スコア60,000を達成", test: (p) => p.bestScore >= 60000 },
    },
    ignis: {
      name: "イグニス", label: "IGNIS", swatch: "#ffb84d",
      desc: "過負荷機。撃破を重ねるほど火力が雪だるま式に膨れ上がる。",
      ship: { glow: "rgba(255,150,80,0.6)", g0: "#fff2e0", g1: "#ffb84d", g2: "#c05a12", flame: "rgba(255,190,120,0.95)", shape: "flare" },
      skills: ["overload", "pulse", "spread", "nova", "chain", "adrenaline", "swarm", "power", "haste", "crit", "multishot", "bigshot", "swift", "comboedge"],
      unlock: { desc: "レベル25に到達", test: (p) => p.maxLevel >= 25 },
    },
    guardian: {
      name: "ガーディアン", label: "GUARDIAN", swatch: "#9fd8ff",
      desc: "守勢の要塞。光輪と反射棘、再生と装甲で鉄壁を敷き耐え抜く。",
      ship: { glow: "rgba(120,180,255,0.6)", g0: "#eef4ff", g1: "#9fd8ff", g2: "#3a6ad0", flame: "rgba(170,205,255,0.9)", shape: "aegis" },
      skills: ["orbit", "aura", "gravity", "homing", "flak", "thorns", "bulwark", "regen", "armor", "bigshot", "swift", "magnet", "greed", "revive"],
      unlock: { desc: "ハードで3分生存", test: (p) => p.bestTime.hard >= 180 },
    },
    arbiter: {
      name: "アービター", label: "ARBITER", swatch: "#c9a6ff",
      desc: "処刑執行機。会心と処刑、貫通狙撃で大型を即座に断罪する。",
      ship: { glow: "rgba(190,150,255,0.6)", g0: "#f4ecff", g1: "#c9a6ff", g2: "#7a3ad0", flame: "rgba(210,180,255,0.9)", shape: "reaper" },
      skills: ["deadeye", "beam", "execute", "critblast", "coldblood", "sniper", "crit", "glass", "weakpoint", "bigshot", "momentum", "comboedge", "revive", "longshot"],
      unlock: { desc: "累計3,500体を撃破", test: (p) => p.kills >= 3500 },
    },
  };
  function maxBestTime(p) { return Math.max(p.bestTime.easy, p.bestTime.normal, p.bestTime.hard, p.bestTime.inferno); }
  let costumeKey = "vanguard";
  let costume = COSTUMES.vanguard;
  let ship = COSTUMES.vanguard.ship; // active ship colour theme

  // ---------------------------------------------------------------------
  //  Weapon stat resolvers (level-scaled)
  // ---------------------------------------------------------------------
  function weaponLv(id) { return player.weapons[id] || 0; }

  function pulseStats() {
    const lv = weaponLv("pulse");
    return {
      cooldown: 0.42 / player.fireRateMul,
      damage: (10 + lv * 5) * dmgMul(),
      speed: 620,
      radius: 6 + lv * 0.6,
      count: player.projectiles + Math.floor(lv / 2),
      spread: 0.12,
      range: (560 + lv * 20) * player.rangeMul,
    };
  }
  function missileStats() {
    const lv = weaponLv("missile");
    return {
      cooldown: 1.45 / player.fireRateMul,
      damage: (16 + lv * 7) * dmgMul(),
      speed: 250,
      radius: 6,
      count: 1 + Math.floor(lv / 2),
      turn: 3.0 + lv * 0.2,
      blast: 60 + lv * 9,
      range: (560 + lv * 20) * player.rangeMul,
    };
  }
  function boomerangStats() {
    const lv = weaponLv("boomerang");
    return {
      cooldown: 1.7 / player.fireRateMul,
      damage: (12 + lv * 5) * dmgMul(),
      speed: 430 + lv * 10,
      radius: 8 + lv * 0.5,
      count: 1 + Math.floor(lv / 3),
      out: 0.5 + lv * 0.02,
      range: (500 + lv * 20) * player.rangeMul,
    };
  }
  function flakStats() {
    const lv = weaponLv("flak");
    return {
      cooldown: 1.15 / player.fireRateMul,
      damage: (15 + lv * 7) * dmgMul(),
      speed: 300 + lv * 8,
      radius: 7 + lv * 0.5,
      count: 1 + Math.floor(lv / 3),
      blast: 66 + lv * 11,
      life: 0.78 + lv * 0.03,
      range: (500 + lv * 20) * player.rangeMul,
    };
  }
  function forkStats() {
    const lv = weaponLv("fork");
    return {
      cooldown: 0.52 / player.fireRateMul,
      damage: (9 + lv * 4) * dmgMul(),
      speed: 560 + lv * 12,
      radius: 5.5 + lv * 0.4,
      count: player.projectiles,
      forks: 2 + Math.floor(lv / 2),
      range: (540 + lv * 20) * player.rangeMul,
    };
  }
  function plasmaorbStats() {
    const lv = weaponLv("plasmaorb");
    return {
      cooldown: 1.3 / player.fireRateMul,
      damage: (13 + lv * 6) * dmgMul(),
      speed: 190 + lv * 6,
      radius: 15 + lv * 1.6,
      pierce: 6 + lv * 2,
      range: (540 + lv * 20) * player.rangeMul,
    };
  }
  function frostStats() {
    const lv = weaponLv("frost");
    return {
      cooldown: 0.72 / player.fireRateMul,
      damage: (11 + lv * 5) * dmgMul(),
      speed: 500 + lv * 12,
      radius: 6.5 + lv * 0.5,
      pierce: 2 + Math.floor(lv / 2),
      slowMul: Math.max(0.35, 0.6 - lv * 0.05),
      slowT: 1.1 + lv * 0.1,
      range: (560 + lv * 20) * player.rangeMul,
    };
  }
  function clusterStats() {
    const lv = weaponLv("cluster");
    return {
      cooldown: 1.35 / player.fireRateMul,
      damage: (13 + lv * 6) * dmgMul(),
      speed: 330 + lv * 8,
      radius: 7 + lv * 0.5,
      blast: 58 + lv * 8,
      shards: 5 + lv,
      life: 0.7 + lv * 0.03,
      range: (500 + lv * 20) * player.rangeMul,
    };
  }
  function whipStats() {
    const lv = weaponLv("whip");
    return {
      cooldown: 0.5 / player.fireRateMul,
      damage: (12 + lv * 6) * dmgMul(),
      reach: (110 + lv * 12) * player.rangeMul,
      arc: 1.15 + lv * 0.06,
    };
  }
  function seekerStats() {
    const lv = weaponLv("seeker");
    return {
      cooldown: 0.9 / player.fireRateMul,
      damage: (7 + lv * 3) * dmgMul(),
      speed: 360 + lv * 10,
      radius: 4.5 + lv * 0.3,
      count: 3 + lv,
      turn: 4.2 + lv * 0.3,
      range: (560 + lv * 20) * player.rangeMul,
    };
  }
  function orbitCount() { const lv = weaponLv("orbit"); return lv === 0 ? 0 : 2 + Math.floor(lv * 0.9); }
  function orbitStats() {
    const lv = weaponLv("orbit");
    return {
      count: orbitCount(),
      damage: (8 + lv * 4) * dmgMul(),
      radius: 78 + lv * 8,
      spin: 2.2 + lv * 0.25,
      size: 12 + lv * 1.2,
    };
  }
  function novaStats() {
    const lv = weaponLv("nova");
    return {
      cooldown: 2.6 / player.fireRateMul,
      damage: (16 + lv * 9) * dmgMul(),
      radius: (150 + lv * 34) * player.aoeMul,
    };
  }
  function spreadStats() {
    const lv = weaponLv("spread");
    return {
      cooldown: 0.9 / player.fireRateMul,
      damage: (7 + lv * 4) * dmgMul(),
      speed: 520,
      count: 4 + lv,
      arc: 0.6 + lv * 0.08,
      radius: 5,
      life: 0.5,
      range: 360 * player.rangeMul,
    };
  }
  function beamStats() {
    const lv = weaponLv("beam");
    return {
      cooldown: 1.3 / player.fireRateMul,
      damage: (22 + lv * 12) * dmgMul(),
      pierce: 3 + lv,
      speed: 1100,
      radius: 7 + lv,
      range: 720 * player.rangeMul,
    };
  }
  function chainStats() {
    const lv = weaponLv("chain");
    return {
      cooldown: 1.1 / player.fireRateMul,
      damage: (14 + lv * 8) * dmgMul(),
      jumps: 3 + lv,           // number of enemies hit
      range: 620 * player.rangeMul, // first-target range
      jumpRange: 220,          // arc distance between enemies
    };
  }
  function homingStats() {
    const lv = weaponLv("homing");
    return {
      cooldown: 0.75 / player.fireRateMul,
      damage: (9 + lv * 5) * dmgMul(),
      speed: 300,
      turn: 3.2 + lv * 0.4,    // steering rate (rad/s)
      count: 1 + Math.floor((lv + 1) / 2),
      radius: 6,
      range: 640 * player.rangeMul,
    };
  }
  function auraStats() {
    const lv = weaponLv("aura");
    return {
      tick: 0.35,              // damage interval
      damage: (6 + lv * 4) * dmgMul(),
      radius: (78 + lv * 16) * player.aoeMul,
    };
  }
  function gravityStats() {
    const lv = weaponLv("gravity");
    return {
      tick: 0.4,
      damage: (7 + lv * 5) * dmgMul(),
      radius: (100 + lv * 20) * player.aoeMul,
      slow: 0.55 - lv * 0.04,  // enemy speed multiplier inside (lower = slower)
    };
  }
  function stormStats() {
    const lv = weaponLv("storm");
    return {
      cooldown: 1.0 / player.fireRateMul,
      damage: (18 + lv * 10) * dmgMul(),
      strikes: 2 + lv,          // bolts per volley
      range: 520 * player.rangeMul,
    };
  }
  function deadeyeStats() {
    const lv = weaponLv("deadeye");
    return {
      cooldown: 1.5 / player.fireRateMul,
      damage: (45 + lv * 26) * dmgMul(),
      pierce: 4 + lv,
      speed: 720,
      radius: 9 + lv,
      range: 900 * player.rangeMul,
    };
  }
  function staticStats() {
    const lv = weaponLv("staticfield");
    return {
      tick: 0.3,
      damage: (5 + lv * 3) * dmgMul(),
      radius: (150 + lv * 20) * player.rangeMul,
      targets: 1 + lv,          // enemies zapped per tick
    };
  }

  // weapon timers
  const wt = { pulse: 0, nova: 0, spread: 0, beam: 0, chain: 0, homing: 0, aura: 0, gravity: 0, storm: 0, deadeye: 0, staticfield: 0, missile: 0, boomerang: 0, flak: 0, fork: 0, plasmaorb: 0, frost: 0, cluster: 0, whip: 0, seeker: 0 };

  // ---------------------------------------------------------------------
  //  Enemy types
  // ---------------------------------------------------------------------
  const ENEMY_TYPES = {
    drifter: { r: 15, hp: 18, speed: 70, dmg: 8, xp: 1, color: "rgba(120,200,255,1)", glow: "rgba(90,160,255,0.5)", shape: "diamond" },
    rusher:  { r: 11, hp: 10, speed: 155, dmg: 6, xp: 1, color: "rgba(120,255,190,1)", glow: "rgba(80,255,170,0.5)", shape: "tri" },
    tank:    { r: 26, hp: 80, speed: 46, dmg: 16, xp: 4, color: "rgba(255,120,120,1)", glow: "rgba(255,90,90,0.5)", shape: "hex" },
    orbiter: { r: 13, hp: 26, speed: 92, dmg: 9, xp: 2, color: "rgba(200,140,255,1)", glow: "rgba(165,107,255,0.5)", shape: "star" },
    splitter:{ r: 18, hp: 34, speed: 64, dmg: 10, xp: 2, color: "rgba(255,180,90,1)", glow: "rgba(255,157,90,0.5)", shape: "diamond", splits: true },
    charger: { r: 16, hp: 32, speed: 60, dmg: 14, xp: 2, color: "rgba(255,110,120,1)", glow: "rgba(255,90,110,0.5)", shape: "charger" },
    // Bosses (distinct kinds, each with its own behaviour + look)
    boss_dread:  { r: 46, hp: 900, speed: 42, dmg: 26, xp: 42, color: "rgba(255,80,180,1)", glow: "rgba(255,62,165,0.6)", boss: true, bossKind: "dread" },
    boss_hive:   { r: 44, hp: 780, speed: 36, dmg: 20, xp: 42, color: "rgba(120,255,170,1)", glow: "rgba(80,255,150,0.55)", boss: true, bossKind: "hive" },
    boss_lancer: { r: 38, hp: 760, speed: 58, dmg: 24, xp: 46, color: "rgba(90,220,255,1)", glow: "rgba(56,200,255,0.6)", boss: true, bossKind: "lancer" },
    boss_sentry: { r: 42, hp: 720, speed: 32, dmg: 16, xp: 46, color: "rgba(255,190,90,1)", glow: "rgba(255,170,70,0.6)", boss: true, bossKind: "sentry" },
    boss_vortex: { r: 40, hp: 820, speed: 74, dmg: 20, xp: 48, color: "rgba(150,130,255,1)", glow: "rgba(130,110,255,0.6)", boss: true, bossKind: "vortex" },
    boss_spectre:  { r: 38, hp: 760, speed: 82, dmg: 18, xp: 48, color: "rgba(150,255,230,1)", glow: "rgba(120,255,220,0.55)", boss: true, bossKind: "spectre" },
    boss_monolith: { r: 50, hp: 1050, speed: 30, dmg: 24, xp: 54, color: "rgba(110,150,255,1)", glow: "rgba(90,130,255,0.55)", boss: true, bossKind: "monolith" },
    boss_reaver:   { r: 36, hp: 820, speed: 70, dmg: 24, xp: 48, color: "rgba(255,70,90,1)", glow: "rgba(255,60,80,0.6)", boss: true, bossKind: "reaver" },
    boss_warlock:  { r: 42, hp: 840, speed: 60, dmg: 18, xp: 50, color: "rgba(190,120,255,1)", glow: "rgba(175,110,255,0.6)", boss: true, bossKind: "warlock" },
    boss_prism:    { r: 40, hp: 800, speed: 66, dmg: 20, xp: 48, color: "rgba(255,170,225,1)", glow: "rgba(255,150,215,0.6)", boss: true, bossKind: "prism" },
  };
  const BOSS_KINDS = ["boss_dread", "boss_hive", "boss_lancer", "boss_sentry", "boss_vortex", "boss_spectre", "boss_monolith", "boss_reaver", "boss_warlock", "boss_prism"];
  const BOSS_NAMES = { dread: "ドレッドノート", hive: "ハイヴコア", lancer: "ランサー", sentry: "セントリー", vortex: "ヴォルテクス", spectre: "スペクター", monolith: "モノリス", reaver: "リーヴァー", warlock: "ウォーロック", prism: "プリズム" };

  function spawnEnemy(type, x, y, hpScale) {
    const t = ENEMY_TYPES[type];
    const e = {
      type, x, y,
      r: t.r, maxHp: t.hp * (hpScale || 1), hp: t.hp * (hpScale || 1),
      speed: t.speed, dmg: t.dmg * enemyDmgScale(), xp: t.xp,
      color: t.color, glow: t.glow, shape: t.shape,
      splits: !!t.splits, boss: !!t.boss, bossKind: t.bossKind || null,
      hitFlash: 0, hitStop: 0, frost: 0, phase: Math.random() * TAU, angle: 0,
      knock: { x: 0, y: 0 },
      aTimer: 3, teleT: 0, dashT: 0, dvx: 0, dvy: 0,
      chargeState: "seek", chargeT: 0, chargeCd: rand(0.6, 1.6),
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
  // Enemies scale with elapsed time, the player's power (upgrades taken), and difficulty.
  function powerLevel() { return Math.max(0, player.level - 1); }
  function enemyHpScale() {
    return (1 + game.time / 55 + powerLevel() * 0.06) * diff.enemyHpMul;
  }
  function enemyDmgScale() {
    // late game ramps hard (quadratic term) so a fully-built player can still die
    const t = game.time;
    const late = Math.pow(t / 220, 2) * 0.6;
    return (1 + t / 130 + late + powerLevel() * 0.03) * diff.enemyDmgMul;
  }

  function updateSpawner(dt) {
    game.difficulty = 1 + game.time / 45;
    const hpScale = enemyHpScale();

    // count live non-boss enemies for the concurrency cap
    let liveCount = 0;
    for (let i = 0; i < enemies.length; i++) if (!enemies[i].boss) liveCount++;

    // steady stream, faster over time (difficulty adjusts the interval)
    game.spawnTimer -= dt;
    const interval = clamp(1.15 - game.time * 0.007, 0.22, 1.15) * diff.spawnMul;
    if (game.spawnTimer <= 0 && liveCount < ENEMY_CAP) {
      game.spawnTimer = interval;
      const batch = Math.min(1 + Math.floor(game.time / 40), ENEMY_CAP - liveCount);
      for (let i = 0; i < batch; i++) {
        spawnAtEdge(rollEnemyType(), hpScale);
        liveCount++;
      }
    }

    // timed waves / boss — ボス戦中は次のWAVEを保留する（WAVEの重複防止）
    if (game.time >= game.nextWaveAt) {
      let bossAlive = false;
      for (const e of enemies) { if (e.boss) { bossAlive = true; break; } }
      if (bossAlive) {
        game.nextWaveAt = game.time + 3;
      } else {
        game.waveCount++;
        game.nextWaveAt = game.time + 30;
        if (game.waveCount % 2 === 0) {
          const kind = BOSS_KINDS[game.bossIndex % BOSS_KINDS.length];
          game.bossIndex++;
          spawnAtEdge(kind, hpScale * (1 + game.waveCount * 0.12) * diff.bossHpMul);
          showWave("警告 — " + BOSS_NAMES[ENEMY_TYPES[kind].bossKind] + " 出現");
        } else {
          const n = Math.min(8 + game.waveCount * 2, Math.max(0, ENEMY_CAP - liveCount));
          for (let i = 0; i < n; i++) spawnAtEdge(rollEnemyType(), hpScale);
          showWave("WAVE " + game.waveCount);
        }
        game.shake = Math.max(game.shake, 8);
      }
    }
  }

  function rollEnemyType() {
    const t = game.time;
    const r = Math.random();
    if (t < 20) return r < 0.75 ? "drifter" : "rusher";
    if (t < 60) {
      if (r < 0.42) return "drifter";
      if (r < 0.70) return "rusher";
      if (r < 0.85) return "orbiter";
      if (r < 0.95) return "charger";
      return "tank";
    }
    if (r < 0.28) return "drifter";
    if (r < 0.50) return "rusher";
    if (r < 0.66) return "orbiter";
    if (r < 0.80) return "charger";
    if (r < 0.90) return "splitter";
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
    if (shockwaves.length > 120) shockwaves.shift();
  }
  function whipArc(dir, reach, arc, color) {
    slashes.push({ x: player.x, y: player.y, dir, reach, arc, color, life: 1 });
    if (slashes.length > 24) slashes.shift();
  }
  // Short-lived additive flash: kind = "muzzle" | "impact" | "kill".
  function spark(x, y, angle, color, kind, scale) {
    sparks.push({ x, y, angle: angle || 0, color, kind: kind || "impact", scale: scale || 1, life: 1 });
    if (sparks.length > 180) sparks.shift();
  }
  function updateSparks(dt) {
    for (const s of sparks) {
      const rate = s.kind === "muzzle" ? 10 : s.kind === "boom" ? 3.0 : s.kind === "kill" ? 4.5 : 6.5;
      s.life -= dt * rate;
    }
    sparks = sparks.filter((s) => s.life > 0);
  }
  function drawSparks() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const s of sparks) {
      const a = clamp(s.life, 0, 1), sc = s.scale;
      if (s.kind === "muzzle") {
        ctx.save();
        ctx.translate(s.x, s.y); ctx.rotate(s.angle);
        const len = (24 + 14 * (1 - a)) * sc;
        const g = ctx.createLinearGradient(0, 0, len, 0);
        g.addColorStop(0, "rgba(255,255,255," + (0.9 * a) + ")");
        g.addColorStop(0.4, s.color);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(0, -6 * a * sc); ctx.lineTo(len, 0); ctx.lineTo(0, 6 * a * sc); ctx.closePath(); ctx.fill();
        drawGlow(0, 0, 13 * a * sc, s.color, a);
        ctx.strokeStyle = "rgba(255,255,255," + (0.7 * a) + ")"; ctx.lineWidth = 1.4;
        for (let i = -1; i <= 1; i++) { const ang = i * 0.55; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ang) * len * 0.72, Math.sin(ang) * len * 0.72); ctx.stroke(); }
        ctx.restore();
      } else if (s.kind === "kill") {
        const rr = (1 - a) * 34 * sc + 8;
        drawGlow(s.x, s.y, 20 * a * sc, s.color, a * 0.9);
        ctx.strokeStyle = "rgba(255,255,255," + (0.75 * a) + ")"; ctx.lineWidth = 2.2 * a + 0.6;
        ctx.beginPath(); ctx.arc(s.x, s.y, rr, 0, TAU); ctx.stroke();
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.angle);
        const r = 16 * a * sc + 4;
        ctx.strokeStyle = "rgba(255,255,255," + a + ")"; ctx.lineWidth = 1.6;
        for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r); ctx.stroke(); }
        ctx.restore();
      } else if (s.kind === "boom") {
        // expanding fireball: white-hot core -> colored plasma -> transparent
        const r = (12 + (1 - a) * 46) * sc;
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r);
        g.addColorStop(0, "rgba(255,255,255," + (0.95 * a) + ")");
        g.addColorStop(0.28, "rgba(255,250,235," + (0.7 * a) + ")");
        g.addColorStop(0.6, s.color);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.fill();
      } else { // impact
        const rr = (1 - a) * 16 * sc + 3;
        drawGlow(s.x, s.y, 13 * a * sc, s.color, a);
        ctx.strokeStyle = "rgba(255,255,255," + (0.8 * a) + ")"; ctx.lineWidth = 1.8 * a + 0.4;
        ctx.beginPath(); ctx.arc(s.x, s.y, rr, 0, TAU); ctx.stroke();
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.angle);
        const r = (10 * a + 4) * sc;
        ctx.strokeStyle = "rgba(255,255,255," + a + ")"; ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r * 0.55); ctx.lineTo(0, r * 0.55); ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
  }

  // ---- explosions: fireball + rings + shrapnel + (boss) chain blasts ----
  function debrisBurst(x, y, color, n, scale, boss) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const sp = rand(70, boss ? 360 : 250) * Math.sqrt(scale);
      debris.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        rot: Math.random() * TAU, vr: rand(-9, 9),
        size: rand(2.4, boss ? 7 : 4.6) * scale,
        life: rand(0.45, 0.85) * (boss ? 1.5 : 1), maxLife: 0.85, color,
      });
      if (debris.length > 300) debris.shift();
    }
  }
  function updateDebris(dt) {
    for (const d of debris) {
      d.x += d.vx * dt; d.y += d.vy * dt;
      d.vx *= 0.90; d.vy *= 0.90;
      d.rot += d.vr * dt; d.life -= dt;
    }
    debris = debris.filter((d) => d.life > 0);
  }
  function drawDebris() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const d of debris) {
      const a = clamp(d.life / d.maxLife, 0, 1), s = d.size;
      ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.rot);
      ctx.globalAlpha = a;
      ctx.fillStyle = d.color;
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.72, s * 0.6); ctx.lineTo(-s * 0.72, s * 0.6); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = a * 0.9; ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath(); ctx.arc(0, 0, s * 0.34, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
  }
  // Soft lingering smoke — light haze tinted by the wreck's colour.
  function smokePuff(x, y, color, n, scale) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, sp = rand(8, 55) * scale;
      smoke.push({
        x: x + rand(-6, 6), y: y + rand(-6, 6),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 10,
        r: rand(8, 16) * scale, maxR: rand(34, 60) * scale,
        life: rand(0.9, 1.5) * (scale > 1.4 ? 1.35 : 1), maxLife: 1.5,
        rot: Math.random() * TAU, vr: rand(-1, 1), tint: color,
      });
      if (smoke.length > 220) smoke.shift();
    }
  }
  function updateSmoke(dt) {
    for (const s of smoke) {
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.vx *= 0.93; s.vy *= 0.93;
      s.r += (s.maxR - s.r) * dt * 1.7;
      s.life -= dt; s.rot += s.vr * dt;
    }
    smoke = smoke.filter((s) => s.life > 0);
  }
  function drawSmoke() {
    for (const s of smoke) {
      const a = clamp(s.life / s.maxLife, 0, 1);
      const alpha = a * a * 0.44; // ease-out fade, soft
      const c = rgbaParse(s.tint);
      const mr = ((c.r + 190) / 2) | 0, mg = ((c.g + 198) / 2) | 0, mb = ((c.b + 214) / 2) | 0;
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
      g.addColorStop(0, "rgba(232,236,248," + alpha + ")");
      g.addColorStop(0.5, "rgba(" + mr + "," + mg + "," + mb + "," + (alpha * 0.55) + ")");
      g.addColorStop(1, "rgba(24,28,42,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
    }
  }
  function scheduleBoom(x, y, color, glow, t, scale) { booms.push({ x, y, color, glow, t, scale }); }
  function updateBooms(dt) {
    for (const bm of booms) {
      bm.t -= dt;
      if (bm.t <= 0 && !bm._done) {
        bm._done = true;
        spark(bm.x, bm.y, 0, bm.glow, "boom", bm.scale);
        shockwave(bm.x, bm.y, 46 * bm.scale, bm.glow);
        burst(bm.x, bm.y, bm.color, 10, 230, [1.5, 3.6], 0.5);
        burst(bm.x, bm.y, "rgba(255,255,255,0.9)", 4, 200, [1, 2.2], 0.4);
        debrisBurst(bm.x, bm.y, bm.color, 5, bm.scale, false);
        smokePuff(bm.x, bm.y, bm.color, 3, bm.scale);
        flashScreen(0.12, "255,235,215");
        game.shake = Math.max(game.shake, 5);
      }
    }
    booms = booms.filter((bm) => !bm._done);
  }
  // brief additive full-screen flash from explosion light (capped, decays fast)
  function flashScreen(amt, col) {
    game.expFlash = Math.min(0.62, game.expFlash + amt);
    if (col) game.expFlashCol = col;
  }
  function explodeEnemy(e) {
    const boss = e.boss;
    const sc = boss ? 1 : clamp(e.r / 15, 0.7, 1.9);
    flashScreen(boss ? 0.5 : 0.05 * sc, boss ? "255,232,212" : "255,240,225");
    // fireball + layered rings + white star flash
    spark(e.x, e.y, 0, e.glow, "boom", boss ? 3.4 : 1.25 * sc);
    shockwave(e.x, e.y, (boss ? 175 : 46 * sc), e.glow);
    shockwave(e.x, e.y, (boss ? 100 : 24 * sc), "rgba(255,255,255,0.85)");
    spark(e.x, e.y, Math.random() * TAU, boss ? "#ffffff" : e.color, "kill", boss ? 2.7 : 1.1 * sc);
    // embers (enemy-colored) + white-hot sparks
    burst(e.x, e.y, e.color, boss ? 48 : Math.round(16 * sc), boss ? 340 : 210, [1.5, boss ? 5 : 3.6], boss ? 0.9 : 0.55);
    burst(e.x, e.y, "rgba(255,255,255,0.9)", boss ? 18 : Math.round(5 * sc), boss ? 300 : 190, [1, boss ? 3 : 2.2], boss ? 0.6 : 0.4);
    // spinning shrapnel + lingering smoke
    debrisBurst(e.x, e.y, e.color, boss ? 16 : Math.round(6 * sc), boss ? 1 : sc, boss);
    smokePuff(e.x, e.y, e.color, boss ? 18 : Math.max(3, Math.round(5 * sc)), boss ? 1.9 : sc);
    if (boss) {
      game.shake = Math.max(game.shake, 18);
      game.freeze = Math.max(game.freeze, 0.11); // hit-stop the whole scene for a beat
      // cinematic chain of secondary blasts around the wreck
      for (let i = 0; i < 5; i++) scheduleBoom(e.x + rand(-70, 70), e.y + rand(-70, 70), e.color, e.glow, 0.08 + i * 0.11, rand(0.9, 1.6));
    } else {
      game.shake = Math.max(game.shake, 2 + sc * 1.6);
    }
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
  // nearest live enemy not already hit by this bullet (for ricochet)
  function nearestUnhit(x, y, hits, maxD) {
    let best = null, bd = maxD * maxD;
    for (const e of enemies) {
      if (e.dead || hits.has(e)) continue;
      const d = dist2(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // AoE damage helper (guarded so on-kill explosions can't chain infinitely).
  let inAoe = false;
  function aoeDamage(x, y, radius, amount, color) {
    shockwave(x, y, radius, color || "rgba(255,255,255,0.4)");
    const r2 = radius * radius;
    const prev = inAoe; inAoe = true;
    for (const e of enemies) {
      if (e.dead) continue;
      if (dist2(x, y, e.x, e.y) < r2) {
        const a = Math.atan2(e.y - y, e.x - x);
        damageEnemy(e, amount, Math.cos(a) * 70, Math.sin(a) * 70, false);
      }
    }
    inAoe = prev;
  }

  function damageEnemy(e, amount, kx, ky, isCrit) {
    if (player.bossDmg > 0 && e.boss) amount *= 1 + player.bossDmg; // weakpoint: extra boss damage
    e.hp -= amount;
    e.hitFlash = 1;
    // hit-stop: freeze the struck enemy for a beat so hits land with weight
    // (bosses are exempt so sustained fire can't stall their attack patterns)
    if (!e.boss) e.hitStop = Math.max(e.hitStop || 0, isCrit ? 0.08 : 0.05);
    // cryo: chance to deep-freeze / slow the struck enemy (signature)
    if (player.cryo > 0 && e.hp > 0 && Math.random() < Math.min(0.55, 0.13 + player.cryo * 0.09)) {
      e.slowT = Math.max(e.slowT || 0, 1.3);
      e.slowMul = e.boss ? 0.6 : 0.22;
      e.frost = 0.5;
      spark(e.x, e.y, Math.random() * TAU, "rgba(150,225,255,0.9)", "impact", 1.2);
      burst(e.x, e.y, "rgba(190,235,255,0.9)", 5, 120, [1, 2.4], 0.4);
    }
    if (kx || ky) { e.knock.x += kx; e.knock.y += ky; }
    floater(e.x, e.y - e.r, Math.round(amount), isCrit ? "#ffd166" : "#ffffff", isCrit);
    // heal-on-hit (Phantom: ブラッドドリンカー)
    if (player.bloodhitChance > 0 && player.hp < player.maxHp && Math.random() < player.bloodhitChance) {
      player.hp = Math.min(player.maxHp, player.hp + 2);
    }
    // crit explosion (Hunter: ヘッドショット)
    if (isCrit && player.critblast > 0 && e.hp > 0 && !inAoe) {
      aoeDamage(e.x, e.y, 60 + player.critblast * 12, amount * 0.5, "rgba(255,184,77,0.5)");
    }
    // execute low-HP enemies (Hunter: ハンターズマーク)
    if (e.hp > 0 && !e.boss && player.executePct > 0 && e.hp <= e.maxHp * player.executePct) {
      floater(e.x, e.y - e.r - 12, "処刑", "#ffd166", true);
      killEnemy(e);
      return;
    }
    if (e.hp <= 0) killEnemy(e);
  }

  // Timed power-up drops. Each timed type applies its `deltas` to the player's
  // multiplier fields for `dur` seconds, then reverses them.
  const POWERUPS = {
    overdrive: { label: "オーバードライブ", color: "#ffd166", glow: "rgba(255,209,102,0.7)", dur: 8, deltas: { damageMul: 0.6, fireRateMul: 0.5 } },
    surge:     { label: "サージ", color: "#ff3ea5", glow: "rgba(255,62,165,0.7)", dur: 8, deltas: { projectiles: 2, fireRateMul: 0.35 } },
    magnet:    { label: "マグネット", color: "#a56bff", glow: "rgba(165,107,255,0.7)", dur: 8, deltas: { pickupRange: 280 } },
    aegis:     { label: "イージス", color: "#38f6ff", glow: "rgba(56,246,255,0.75)", dur: 5, invuln: true },
    repair:    { label: "リペア", color: "#46f0a0", glow: "rgba(70,240,160,0.7)", instant: true },
  };
  const POWERUP_ROLL = ["overdrive", "overdrive", "surge", "surge", "magnet", "magnet", "aegis", "repair"];

  function dropPowerup(x, y, type) {
    const key = type || POWERUP_ROLL[(Math.random() * POWERUP_ROLL.length) | 0];
    powerups.push({ type: key, x, y, r: 13, phase: Math.random() * TAU, homing: false, life: 22 });
  }

  function removeBuff(type) {
    for (let i = player.buffs.length - 1; i >= 0; i--) {
      if (player.buffs[i].type === type) {
        const d = player.buffs[i].deltas;
        if (d) for (const k in d) player[k] -= d[k];
        player.buffs.splice(i, 1);
      }
    }
  }

  function applyPowerup(type) {
    const pu = POWERUPS[type];
    if (!pu) return;
    sfx.power();
    shockwave(player.x, player.y, player.r * 3, pu.glow);
    burst(player.x, player.y, pu.color, 18, 260, [1.5, 3], 0.5);
    floater(player.x, player.y - player.r - 10, pu.label, pu.color, true);
    if (pu.instant) { // repair
      player.hp = Math.min(player.maxHp, player.hp + Math.round(player.maxHp * 0.35));
      return;
    }
    removeBuff(type); // refresh instead of stacking
    if (pu.deltas) for (const k in pu.deltas) player[k] += pu.deltas[k];
    player.buffs.push({ type: type, t: pu.dur, deltas: pu.deltas ? Object.assign({}, pu.deltas) : null });
  }

  function updateBuffs(dt) {
    for (const b of player.buffs) {
      b.t -= dt;
      if (POWERUPS[b.type] && POWERUPS[b.type].invuln && b.t > 0) {
        player.invuln = Math.max(player.invuln, 0.12); // keep i-frames topped up
      }
    }
    for (let i = player.buffs.length - 1; i >= 0; i--) {
      if (player.buffs[i].t <= 0) {
        const d = player.buffs[i].deltas;
        if (d) for (const k in d) player[k] -= d[k];
        player.buffs.splice(i, 1);
      }
    }
  }

  function updatePowerups(dt) {
    const range = player.pickupRange;
    const range2 = range * range;
    const grab = (player.r + 12) * (player.r + 12);
    for (const p of powerups) {
      p.phase += dt * 3;
      p.life -= dt;
      const d2 = dist2(p.x, p.y, player.x, player.y);
      if (d2 < range2 || p.homing) {
        p.homing = true;
        const a = Math.atan2(player.y - p.y, player.x - p.x);
        const sp = lerp(160, 520, 1 - clamp(Math.sqrt(d2) / range, 0, 1));
        p.x += Math.cos(a) * sp * dt;
        p.y += Math.sin(a) * sp * dt;
      }
      if (d2 < grab) { applyPowerup(p.type); p.dead = true; }
    }
    powerups = powerups.filter((p) => !p.dead && p.life > 0);
  }

  // Register a kill for the combo/score system.
  function scoreKill(e) {
    player.combo++;
    player.comboTimer = 2.6;
    const mult = comboMult();
    const base = e.boss ? 600 : (e.xp || 1) * 12 + 8;
    player.score += Math.round(base * mult);
  }
  function comboMult() { return Math.min(4, 1 + Math.floor(player.combo / 5) * 0.25); }

  function killEnemy(e) {
    e.dead = true;
    game.kills++;
    if (e.boss) game.bossKills++;
    scoreKill(e);
    // overload: each kill adds a temporary damage stack (snowball) that decays
    if (player.overload > 0) {
      player.overStacks = Math.min(player.overload * 12, player.overStacks + (e.boss ? 8 : 1));
      player.overTimer = 3.0;
    }
    // power-up drops: bosses always, others rarely
    if (e.boss) { dropPowerup(e.x, e.y); dropPowerup(e.x + rand(-30, 30), e.y + rand(-30, 30)); }
    else if (Math.random() < 0.02 * (1 + player.luck * 0.7)) dropPowerup(e.x, e.y);
    if (player.lifestealChance > 0 && player.hp < player.maxHp && Math.random() < player.lifestealChance) {
      player.hp = Math.min(player.maxHp, player.hp + player.lifestealHeal);
      floater(player.x, player.y - player.r, "+" + player.lifestealHeal, "#ff9dc0", false);
    }
    // void burst (Phantom): enemy explodes, damaging others (never chains)
    if (player.voidburst > 0 && !e.boss && !inAoe) {
      aoeDamage(e.x, e.y, 60 + player.voidburst * 14, 12 + player.voidburst * 8, WEAPONS.voidburst ? "rgba(255,90,120,0.55)" : "rgba(255,90,120,0.55)");
      burst(e.x, e.y, "rgba(255,90,120,1)", 12, 220, [1.5, 3.5], 0.5);
    }
    explodeEnemy(e);
    if (e.boss) sfx.nova();
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
        // layered expanding rings + a bright central flash
        shockwave(player.x, player.y, s.radius, WEAPONS.nova.glow);
        shockwave(player.x, player.y, s.radius * 0.7, "rgba(255,255,255,0.7)");
        spark(player.x, player.y, 0, WEAPONS.nova.color, "kill", 2.2);
        game.shake = Math.max(game.shake, 5);
        sfx.nova();
        const r2 = s.radius * s.radius;
        for (const e of enemies) {
          if (dist2(player.x, player.y, e.x, e.y) < r2) {
            const a = Math.atan2(e.y - player.y, e.x - player.x);
            damageEnemy(e, s.damage, Math.cos(a) * 160, Math.sin(a) * 160, false);
          }
        }
        burst(player.x, player.y, WEAPONS.nova.color, 30, 300, [2, 4.5], 0.6);
      }
    }
    // CHAIN LIGHTNING
    if (weaponLv("chain") > 0) {
      wt.chain -= dt;
      if (wt.chain <= 0) {
        const s = chainStats();
        const first = nearestEnemy(player.x, player.y, s.range * s.range);
        if (first) {
          wt.chain = s.cooldown;
          fireChain(first, s);
          sfx.shoot();
        }
      }
    }
    // HOMING DRONES
    if (weaponLv("homing") > 0) {
      wt.homing -= dt;
      if (wt.homing <= 0) {
        const s = homingStats();
        const target = nearestEnemy(player.x, player.y, s.range * s.range);
        if (target) {
          wt.homing = s.cooldown;
          for (let i = 0; i < s.count; i++) {
            const a = player.facing + (i - (s.count - 1) / 2) * 0.5 + rand(-0.15, 0.15);
            const b = fireBullet(a, s.speed, s.damage, s.radius, WEAPONS.homing.color, WEAPONS.homing.glow, 1, false);
            b.homing = true;
            b.turn = s.turn;
            b.life = 2.6;
          }
          sfx.shoot();
        }
      }
    }
    // MISSILE POD (homing, explodes on impact)
    if (weaponLv("missile") > 0) {
      wt.missile -= dt;
      if (wt.missile <= 0) {
        const s = missileStats();
        const target = nearestEnemy(player.x, player.y, s.range * s.range);
        if (target) {
          wt.missile = s.cooldown;
          for (let i = 0; i < s.count; i++) {
            const a = player.facing + (i - (s.count - 1) / 2) * 0.42 + rand(-0.12, 0.12);
            const b = fireBullet(a, s.speed, s.damage, s.radius, WEAPONS.missile.color, WEAPONS.missile.glow, 1, false);
            b.homing = true; b.turn = s.turn; b.life = 3.2; b.long = true;
            b.explodeR = s.blast; b.explodeDmg = s.damage * 0.7;
          }
          sfx.shoot();
        }
      }
    }
    // GLAIVE BOOMERANG (out-and-back piercing blade)
    if (weaponLv("boomerang") > 0) {
      wt.boomerang -= dt;
      if (wt.boomerang <= 0) {
        const s = boomerangStats();
        const target = nearestEnemy(player.x, player.y, s.range * s.range);
        const baseAng = target ? Math.atan2(target.y - player.y, target.x - player.x) : player.facing;
        wt.boomerang = s.cooldown;
        for (let i = 0; i < s.count; i++) {
          const a = baseAng + (i - (s.count - 1) / 2) * 0.4;
          const b = fireBullet(a, s.speed, s.damage, s.radius, WEAPONS.boomerang.color, WEAPONS.boomerang.glow, 999, false);
          b.boomerang = 0; b.boomOut = s.out; b.life = 2.2; b.long = true; b.spin = 0;
        }
        sfx.shoot();
      }
    }
    // FLAK BURST (lobbed shell that detonates in an area)
    if (weaponLv("flak") > 0) {
      wt.flak -= dt;
      if (wt.flak <= 0) {
        const s = flakStats();
        const target = nearestEnemy(player.x, player.y, s.range * s.range);
        if (target) {
          wt.flak = s.cooldown;
          const base = Math.atan2(target.y - player.y, target.x - player.x);
          for (let i = 0; i < s.count; i++) {
            const a = base + (i - (s.count - 1) / 2) * 0.16 + rand(-0.05, 0.05);
            const b = fireBullet(a, s.speed, s.damage, s.radius, WEAPONS.flak.color, WEAPONS.flak.glow, 1, false);
            b.explodeR = s.blast; b.explodeDmg = s.damage; b.life = s.life; b.long = true;
          }
          sfx.shoot();
        }
      }
    }
    // SPLIT SHOT (fast bullets that fork into secondaries on hit)
    if (weaponLv("fork") > 0) {
      wt.fork -= dt;
      if (wt.fork <= 0) {
        const s = forkStats();
        const target = nearestEnemy(player.x, player.y, s.range * s.range);
        if (target) {
          wt.fork = s.cooldown;
          const base = Math.atan2(target.y - player.y, target.x - player.x);
          for (let i = 0; i < s.count; i++) {
            const off = (i - (s.count - 1) / 2) * 0.1;
            const b = fireBullet(base + off, s.speed, s.damage, s.radius, WEAPONS.fork.color, WEAPONS.fork.glow, 1, false);
            b.fork = s.forks; b.life = 1.2;
          }
          sfx.shoot();
        }
      }
    }
    // PLASMA ORB (slow, huge, high-pierce)
    if (weaponLv("plasmaorb") > 0) {
      wt.plasmaorb -= dt;
      if (wt.plasmaorb <= 0) {
        const s = plasmaorbStats();
        const target = nearestEnemy(player.x, player.y, s.range * s.range);
        if (target) {
          wt.plasmaorb = s.cooldown;
          const a = Math.atan2(target.y - player.y, target.x - player.x);
          const b = fireBullet(a, s.speed, s.damage, s.radius, WEAPONS.plasmaorb.color, WEAPONS.plasmaorb.glow, s.pierce, false);
          b.life = 2.4; b.long = true; b.orb = true;
          sfx.shoot();
        }
      }
    }
    // FROST LANCE (piercing shard that chills)
    if (weaponLv("frost") > 0) {
      wt.frost -= dt;
      if (wt.frost <= 0) {
        const s = frostStats();
        const target = nearestEnemy(player.x, player.y, s.range * s.range);
        if (target) {
          wt.frost = s.cooldown;
          const a = Math.atan2(target.y - player.y, target.x - player.x);
          const b = fireBullet(a, s.speed, s.damage, s.radius, WEAPONS.frost.color, WEAPONS.frost.glow, s.pierce, true);
          b.long = true; b.chill = { mul: s.slowMul, t: s.slowT };
          sfx.shoot();
        }
      }
    }
    // CLUSTER BOMB (detonates into radial shards)
    if (weaponLv("cluster") > 0) {
      wt.cluster -= dt;
      if (wt.cluster <= 0) {
        const s = clusterStats();
        const target = nearestEnemy(player.x, player.y, s.range * s.range);
        if (target) {
          wt.cluster = s.cooldown;
          const a = Math.atan2(target.y - player.y, target.x - player.x);
          const b = fireBullet(a, s.speed, s.damage, s.radius, WEAPONS.cluster.color, WEAPONS.cluster.glow, 1, false);
          b.explodeR = s.blast; b.explodeDmg = s.damage; b.life = s.life; b.long = true;
          b.cluster = s.shards; b.clusterDmg = s.damage * 0.55;
          sfx.shoot();
        }
      }
    }
    // ARC WHIP (melee cone sweep)
    if (weaponLv("whip") > 0) {
      wt.whip -= dt;
      if (wt.whip <= 0) {
        const s = whipStats();
        const target = nearestEnemy(player.x, player.y, s.reach * s.reach);
        const dir = target ? Math.atan2(target.y - player.y, target.x - player.x) : player.facing;
        wt.whip = s.cooldown;
        const r2 = s.reach * s.reach;
        let hit = false;
        for (const e of enemies) {
          if (e.dead) continue;
          if (dist2(player.x, player.y, e.x, e.y) > r2) continue;
          let d = Math.atan2(e.y - player.y, e.x - player.x) - dir;
          while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
          if (Math.abs(d) <= s.arc / 2) {
            const ka = Math.atan2(e.y - player.y, e.x - player.x);
            damageEnemy(e, s.damage, Math.cos(ka) * 120, Math.sin(ka) * 120, false);
            hit = true;
          }
        }
        whipArc(dir, s.reach, s.arc, WEAPONS.whip.glow);
        if (hit) sfx.shoot();
      }
    }
    // SEEKER (swarm of micro homing darts)
    if (weaponLv("seeker") > 0) {
      wt.seeker -= dt;
      if (wt.seeker <= 0) {
        const s = seekerStats();
        const target = nearestEnemy(player.x, player.y, s.range * s.range);
        if (target) {
          wt.seeker = s.cooldown;
          for (let i = 0; i < s.count; i++) {
            const a = player.facing + rand(-Math.PI, Math.PI);
            const b = fireBullet(a, s.speed, s.damage, s.radius, WEAPONS.seeker.color, WEAPONS.seeker.glow, 1, false);
            b.homing = true; b.turn = s.turn; b.life = 2.4;
          }
          sfx.shoot();
        }
      }
    }
    // PULSAR AURA (continuous field)
    if (weaponLv("aura") > 0) {
      wt.aura -= dt;
      if (wt.aura <= 0) {
        const s = auraStats();
        wt.aura = s.tick;
        const r2 = s.radius * s.radius;
        for (const e of enemies) {
          if (dist2(player.x, player.y, e.x, e.y) < r2) {
            const a = Math.atan2(e.y - player.y, e.x - player.x);
            damageEnemy(e, s.damage, Math.cos(a) * 40, Math.sin(a) * 40, false);
          }
        }
      }
    }
    // GRAVITY WELL (Warden) — damages + slows enemies inside the field
    if (weaponLv("gravity") > 0) {
      wt.gravity -= dt;
      if (wt.gravity <= 0) {
        const s = gravityStats();
        wt.gravity = s.tick;
        const r2 = s.radius * s.radius;
        for (const e of enemies) {
          if (e.boss) continue;
          if (dist2(player.x, player.y, e.x, e.y) < r2) {
            e.slowT = 0.5; e.slowMul = s.slow;
            damageEnemy(e, s.damage, 0, 0, false);
          }
        }
      }
    }
    // STORM CALL (Tempest) — random lightning strikes on enemies in range
    if (weaponLv("storm") > 0) {
      wt.storm -= dt;
      if (wt.storm <= 0) {
        const s = stormStats();
        wt.storm = s.cooldown;
        const inRange = [];
        const r2 = s.range * s.range;
        for (const e of enemies) if (dist2(player.x, player.y, e.x, e.y) < r2) inRange.push(e);
        let fired = 0;
        for (let k = 0; k < s.strikes && inRange.length; k++) {
          const e = inRange.splice((Math.random() * inRange.length) | 0, 1)[0];
          lightnings.push({ x1: e.x, y1: e.y - 260, x2: e.x, y2: e.y, life: 1, color: WEAPONS.storm.glow });
          damageEnemy(e, s.damage, 0, 0, false);
          burst(e.x, e.y, WEAPONS.storm.color, 6, 150, [1.5, 3], 0.3);
          fired++;
        }
        if (fired) sfx.shoot();
      }
    }
    // DEAD EYE (Hunter) — slow, huge piercing shot at the toughest enemy
    if (weaponLv("deadeye") > 0) {
      wt.deadeye -= dt;
      if (wt.deadeye <= 0) {
        const s = deadeyeStats();
        const target = toughestEnemy(player.x, player.y, s.range * s.range);
        if (target) {
          wt.deadeye = s.cooldown;
          const a = Math.atan2(target.y - player.y, target.x - player.x);
          const b = fireBullet(a, s.speed, s.damage, s.radius, WEAPONS.deadeye.color, WEAPONS.deadeye.glow, s.pierce, true);
          b.long = true;
          b.life = 1.6;
          game.shake = Math.max(game.shake, 4);
          sfx.shoot();
        }
      }
    }
    // STATIC FIELD (Tempest) — constant weak zaps to the nearest few enemies
    if (weaponLv("staticfield") > 0) {
      wt.staticfield -= dt;
      if (wt.staticfield <= 0) {
        const s = staticStats();
        wt.staticfield = s.tick;
        const near = [];
        const r2 = s.radius * s.radius;
        for (const e of enemies) {
          const d = dist2(player.x, player.y, e.x, e.y);
          if (d < r2) near.push({ e, d });
        }
        near.sort((a, b) => a.d - b.d);
        for (let k = 0; k < s.targets && k < near.length; k++) {
          const e = near[k].e;
          lightnings.push({ x1: player.x, y1: player.y, x2: e.x, y2: e.y, life: 0.7, color: WEAPONS.staticfield.glow });
          damageEnemy(e, s.damage, 0, 0, false);
        }
      }
    }
  }

  function toughestEnemy(x, y, maxD2) {
    let best = null, bestHp = -1;
    for (const e of enemies) {
      if (e.dead) continue;
      if (dist2(x, y, e.x, e.y) > maxD2) continue;
      if (e.hp > bestHp) { bestHp = e.hp; best = e; }
    }
    return best;
  }

  // Chain lightning: hop from enemy to enemy, damaging each and drawing arcs.
  function fireChain(first, s) {
    let current = first;
    const hit = new Set();
    let prevX = player.x, prevY = player.y;
    for (let j = 0; j < s.jumps && current; j++) {
      lightnings.push({ x1: prevX, y1: prevY, x2: current.x, y2: current.y, life: 1, color: WEAPONS.chain.glow });
      damageEnemy(current, s.damage, 0, 0, false);
      burst(current.x, current.y, WEAPONS.chain.color, 5, 140, [1, 2.5], 0.3);
      hit.add(current);
      prevX = current.x; prevY = current.y;
      // find nearest un-hit enemy within jumpRange
      let next = null, bd = s.jumpRange * s.jumpRange;
      for (const e of enemies) {
        if (e.dead || hit.has(e)) continue;
        const d = dist2(prevX, prevY, e.x, e.y);
        if (d < bd) { bd = d; next = e; }
      }
      current = next;
    }
  }

  function critChanceNow() {
    let c = player.critChance;
    if (player.coldblood > 0 && player.stillTime > 0.6) c += player.coldblood * 0.1;
    return clamp(c, 0, 0.95);
  }

  function fireBullet(angle, speed, damage, radius, color, glow, pierce, isBeam) {
    const crit = Math.random() < critChanceNow();
    speed *= player.projSpeedMul;
    const b = {
      x: player.x, y: player.y,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      speed: speed,
      damage: crit ? damage * player.critMul : damage, crit,
      r: radius * player.projectileSize, color, glow, pierce: pierce + (player.pierceBonus || 0), hits: new Set(),
      life: isBeam ? 0.9 : 1.6, angle, long: false,
      homing: false, turn: 0,
      bounces: player.ricochet || 0,
      trail: [],
    };
    bullets.push(b);
    if (bullets.length > 260) bullets.shift();
    // muzzle flash at the ship, along the firing direction
    spark(player.x + Math.cos(angle) * player.r * 0.9, player.y + Math.sin(angle) * player.r * 0.9, angle, glow, "muzzle", isBeam ? 1.5 : 1);
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
  // Dash tuning.
  const DASH_DUR = 0.16;    // seconds of burst movement
  const DASH_CD = 1.4;      // seconds before it can be used again
  const DASH_SPEED = 1180;  // px/s during the burst
  const DASH_PLOW = 16;     // extra reach for running enemies over

  // Trigger a dash in the current move/facing direction.
  function doDash() {
    if (game.state !== "playing") return;
    if (player.dashTime > 0 || player.dashCd > 0) return;
    let dx = 0, dy = 0;
    if (keys["w"] || keys["arrowup"]) dy -= 1;
    if (keys["s"] || keys["arrowdown"]) dy += 1;
    if (keys["a"] || keys["arrowleft"]) dx -= 1;
    if (keys["d"] || keys["arrowright"]) dx += 1;
    if (touch.active && (touch.nx || touch.ny)) { dx = touch.nx; dy = touch.ny; }
    if (!dx && !dy) { dx = Math.cos(player.facing); dy = Math.sin(player.facing); }
    const len = Math.hypot(dx, dy) || 1;
    player.dashDX = dx / len; player.dashDY = dy / len;
    player.facing = Math.atan2(player.dashDY, player.dashDX);
    player.dashTime = DASH_DUR;
    player.dashCd = DASH_CD;
    player.dashHit = new Set();
    player.invuln = Math.max(player.invuln, DASH_DUR + 0.1);
    shockwave(player.x, player.y, player.r * 2.8, ship.glow);
    burst(player.x, player.y, ship.g1, 16, 280, [1.5, 3], 0.4);
    game.shake = Math.max(game.shake, 5);
    sfx.dash();
  }

  // While dashing, run over any enemy in the path.
  function dashRunOver() {
    const plow = player.r + DASH_PLOW;
    const bossDmg = Math.round(60 * dmgMul());
    for (const e of enemies) {
      if (e.dead || player.dashHit.has(e)) continue;
      const rr = plow + e.r;
      if (dist2(player.x, player.y, e.x, e.y) < rr * rr) {
        player.dashHit.add(e);
        if (e.boss) {
          const a = Math.atan2(e.y - player.y, e.x - player.x);
          damageEnemy(e, bossDmg, Math.cos(a) * 200, Math.sin(a) * 200, true);
        } else {
          killEnemy(e); // 轢殺
          burst(e.x, e.y, "#ffffff", 8, 200, [1, 2.5], 0.3);
        }
      }
    }
  }

  function updatePlayer(dt) {
    // timed power-up buffs tick down (before any early return)
    updateBuffs(dt);
    // overload snowball bleeds off if you stop killing
    if (player.overStacks > 0) { player.overTimer -= dt; if (player.overTimer <= 0) player.overStacks = 0; }
    // passive HP regeneration (リジェネコア)
    if (player.regen > 0 && player.hp > 0 && player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + player.regen * dt);
    // adrenaline surge decays after a hit
    if (player.adrenTimer > 0) player.adrenTimer = Math.max(0, player.adrenTimer - dt);
    // dash cooldown always ticks down
    if (player.dashCd > 0) player.dashCd = Math.max(0, player.dashCd - dt);

    // active dash: override normal movement with a high-speed burst
    if (player.dashTime > 0) {
      player.dashTime -= dt;
      const step = DASH_SPEED * dt;
      player.x = clamp(player.x + player.dashDX * step, player.r, WORLD.w - player.r);
      player.y = clamp(player.y + player.dashDY * step, player.r, WORLD.h - player.r);
      player.facing = Math.atan2(player.dashDY, player.dashDX);
      player.trail.push({ x: player.x, y: player.y, life: 1.5 });
      if (player.trail.length > 26) player.trail.shift();
      for (const t of player.trail) t.life -= dt * 2.6;
      player.trail = player.trail.filter((t) => t.life > 0);
      dashRunOver();
      player.stillTime = 0;
      updateVaporTrail(dt);
      if (player.invuln > 0) player.invuln -= dt;
      return;
    }

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
    const moving = !!(mx || my);
    if (moving) {
      player.facing = Math.atan2(my, mx);
      // trail
      player.trail.push({ x: player.x, y: player.y, life: 1 });
      if (player.trail.length > 16) player.trail.shift();
    }
    let spd = player.speed;
    if (player.adrenaline > 0 && player.adrenTimer > 0) spd *= 1 + player.adrenaline * 0.10; // adrenaline speed surge
    player.x = clamp(player.x + mx * spd * dt, player.r, WORLD.w - player.r);
    player.y = clamp(player.y + my * spd * dt, player.r, WORLD.h - player.r);

    for (const t of player.trail) t.life -= dt * 2.6;
    player.trail = player.trail.filter((t) => t.life > 0);

    // coldblood: track stationary time (Hunter)
    player.stillTime = moving ? 0 : player.stillTime + dt;

    // swarm core: cache a damage bonus scaled by how many enemies are close
    if (player.swarm > 0) {
      let near = 0; const R2 = 260 * 260;
      for (let i = 0; i < enemies.length; i++) { if (dist2(enemies[i].x, enemies[i].y, player.x, player.y) < R2) near++; }
      player.crowdBonus = Math.min(0.6, near * player.swarm * 0.012);
    } else if (player.crowdBonus) {
      player.crowdBonus = 0;
    }

    // vapor trail: drop damaging afterimages while moving (Phantom)
    if (player.vapor > 0 && moving) {
      player._vaporCd = (player._vaporCd || 0) - dt;
      if (player._vaporCd <= 0) {
        player._vaporCd = 0.08;
        player.vaporTrail.push({ x: player.x, y: player.y, r: 20 + player.vapor * 4, life: 1, hit: new Set() });
        if (player.vaporTrail.length > 40) player.vaporTrail.shift();
      }
    }
    updateVaporTrail(dt);

    // shield regen (Warden): recharges after a few seconds without damage
    if (player.shieldMax > 0) {
      player.shieldTimer += dt;
      if (player.shield < player.shieldMax && player.shieldTimer > 3) {
        player.shield = Math.min(player.shieldMax, player.shield + player.shieldMax * dt * 0.5);
      }
    }

    if (player.invuln > 0) player.invuln -= dt;
  }

  function updateVaporTrail(dt) {
    if (!player.vaporTrail.length) return;
    const dmg = 4 + player.vapor * 3;
    for (const v of player.vaporTrail) {
      v.life -= dt * 1.1;
      for (const e of enemies) {
        if (e.dead || v.hit.has(e)) continue;
        const rr = v.r + e.r;
        if (dist2(v.x, v.y, e.x, e.y) < rr * rr) {
          damageEnemy(e, dmg, 0, 0, false);
          v.hit.add(e);
        }
      }
    }
    player.vaporTrail = player.vaporTrail.filter((v) => v.life > 0);
  }

  function updateEnemies(dt) {
    for (const e of enemies) {
      if (e.dead) continue;
      if (e.hitFlash > 0) e.hitFlash -= dt * 4;
      if (e.frost > 0) e.frost -= dt;
      if (e._orbCd > 0) e._orbCd -= dt;
      e.phase += dt * 3;

      // gravity-well slow (Warden)
      let spd = e.speed;
      if (e.slowT > 0) { e.slowT -= dt; spd *= (e.slowMul || 1); }

      let vx, vy;
      if (e.boss) {
        const bv = updateBoss(e, dt);
        vx = bv.vx; vy = bv.vy;
        e.angle = Math.atan2(player.y - e.y, player.x - e.x);
      } else if (e.type === "charger") {
        const dxp = player.x - e.x, dyp = player.y - e.y;
        const dpl = Math.hypot(dxp, dyp) || 1;
        e.chargeCd -= dt;
        if (e.chargeState === "dash") {
          e.chargeT -= dt;
          vx = e.dvx; vy = e.dvy;
          e.angle = Math.atan2(e.dvy, e.dvx);
          if (e.chargeT <= 0) { e.chargeState = "seek"; e.chargeCd = 1.5; }
        } else if (e.chargeState === "wind") {
          e.chargeT -= dt;
          vx = -dxp / dpl * spd * 0.2; vy = -dyp / dpl * spd * 0.2; // brace back
          e.angle = Math.atan2(dyp, dxp);
          if (e.chargeT <= 0) {
            const ds = spd * 6;
            e.dvx = dxp / dpl * ds; e.dvy = dyp / dpl * ds;
            e.chargeState = "dash"; e.chargeT = 0.42;
          }
        } else { // seek
          vx = dxp / dpl * spd; vy = dyp / dpl * spd;
          e.angle = Math.atan2(dyp, dxp);
          if (dpl < 250 && e.chargeCd <= 0) { e.chargeState = "wind"; e.chargeT = 0.6; }
        }
      } else {
        let ang = Math.atan2(player.y - e.y, player.x - e.x);
        // orbiter type circles the player
        if (e.type === "orbiter") ang += 0.9;
        vx = Math.cos(ang) * spd;
        vy = Math.sin(ang) * spd;
        e.angle = ang;
      }
      // hit-stop: a struck enemy freezes in place for a beat (knockback resumes after)
      if (e.hitStop > 0) {
        e.hitStop -= dt;
      } else {
        vx += e.knock.x; vy += e.knock.y;
        e.knock.x *= 0.86; e.knock.y *= 0.86;
        e.x += vx * dt;
        e.y += vy * dt;
      }
      e.x = clamp(e.x, 20, WORLD.w - 20);
      e.y = clamp(e.y, 20, WORLD.h - 20);

      // contact with player
      if (e._thornCd > 0) e._thornCd -= dt;
      const rr = e.r + player.r;
      if (dist2(e.x, e.y, player.x, player.y) < rr * rr) {
        // thorns reflect (independent of i-frames, on a short cooldown)
        if (player.thorns > 0 && e._thornCd <= 0) {
          const a2 = Math.atan2(e.y - player.y, e.x - player.x);
          damageEnemy(e, player.thorns, Math.cos(a2) * 50, Math.sin(a2) * 50, false);
          e._thornCd = 0.3;
        }
        if (player.invuln <= 0) {
          hurtPlayer(e.dmg);
          const a = Math.atan2(player.y - e.y, player.x - e.x);
          e.knock.x -= Math.cos(a) * 60;
          e.knock.y -= Math.sin(a) * 60;
        }
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

  // Boss AI: returns the velocity to apply this frame; also runs abilities.
  function updateBoss(e, dt) {
    e.aTimer -= dt;
    const dx = player.x - e.x, dy = player.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    let vx = ux * e.speed, vy = uy * e.speed;

    if (e.bossKind === "lancer") {
      // periodic telegraph -> high-speed dash toward the player
      if (e.dashT > 0) {
        e.dashT -= dt;
        vx = e.dvx; vy = e.dvy;
      } else if (e.teleT > 0) {
        e.teleT -= dt;
        vx = ux * e.speed * 0.15; vy = uy * e.speed * 0.15; // wind up almost still
        if (e.teleT <= 0) {
          e.dashT = 0.55;
          e.dvx = ux * 640; e.dvy = uy * 640;
          game.shake = Math.max(game.shake, 6);
          sfx.nova();
        }
      } else if (e.aTimer <= 0) {
        e.teleT = 0.6;
        e.aTimer = 3.2;
      }
    } else if (e.bossKind === "hive") {
      vx *= 0.8; vy *= 0.8; // lumbering
      if (e.aTimer <= 0) {
        e.aTimer = 3.4;
        for (let i = 0; i < 3; i++) {
          const c = spawnEnemy("rusher", e.x + rand(-30, 30), e.y + rand(-30, 30), 0.9);
          c.color = e.color; c.glow = e.glow;
        }
        shockwave(e.x, e.y, 78, e.glow);
        burst(e.x, e.y, e.color, 14, 200, [2, 4], 0.5);
      }
    } else if (e.bossKind === "sentry") {
      // keep mid-range and fire bullet rings
      const want = 320;
      if (d < want - 40) { vx = -ux * e.speed; vy = -uy * e.speed; }
      else if (d > want + 40) { vx = ux * e.speed; vy = uy * e.speed; }
      else { vx = -uy * e.speed * 0.7; vy = ux * e.speed * 0.7; } // strafe
      if (e.aTimer <= 0) {
        e.aTimer = 1.9;
        fireEnemyRing(e);
      }
    } else if (e.bossKind === "vortex") {
      // orbit at mid-range while emitting a continuous rotating bullet spiral
      const want = 300;
      if (d < want - 40) { vx = -ux * e.speed; vy = -uy * e.speed; }
      else if (d > want + 40) { vx = ux * e.speed; vy = uy * e.speed; }
      else { vx = -uy * e.speed; vy = ux * e.speed; } // circle-strafe
      if (e.aTimer <= 0) {
        e.aTimer = 0.11;
        e.spiralAng = (e.spiralAng || 0) + 0.42;
        fireSpiralArm(e, e.spiralAng);
      }
    } else if (e.bossKind === "spectre") {
      // strafe, then phase out and blink beside the player with a homing volley
      if (e.teleT > 0) {
        e.teleT -= dt; vx = 0; vy = 0;
        if (e.teleT <= 0) {
          const ang = Math.random() * TAU, rr = 210 + Math.random() * 90;
          e.x = clamp(player.x + Math.cos(ang) * rr, 40, WORLD.w - 40);
          e.y = clamp(player.y + Math.sin(ang) * rr, 40, WORLD.h - 40);
          burst(e.x, e.y, e.color, 22, 280, [2, 4], 0.5);
          shockwave(e.x, e.y, 90, e.glow);
          const base = Math.atan2(player.y - e.y, player.x - e.x);
          for (let i = 0; i < 5; i++) {
            const a = base + (i - 2) * 0.28;
            enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, r: 8, damage: e.dmg * 0.5, life: 5, color: e.color, glow: e.glow, homing: true, turn: 1.6 });
          }
          sfx.nova();
          e.aTimer = 2.6;
        }
      } else if (e.aTimer <= 0) {
        e.teleT = 0.5;
      } else {
        vx = -uy * e.speed * 0.6; vy = ux * e.speed * 0.6;
      }
    } else if (e.bossKind === "monolith") {
      vx = ux * e.speed * 0.5; vy = uy * e.speed * 0.5; // slow advance
      if (e.aTimer <= 0) { e.aTimer = 3.0; fireRingWall(e); }
    } else if (e.bossKind === "reaver") {
      if (e.dashT > 0) {
        e.dashT -= dt; vx = e.dvx; vy = e.dvy;
        e._imgCd = (e._imgCd || 0) - dt;
        if (e._imgCd <= 0) { e._imgCd = 0.03; burst(e.x, e.y, e.glow, 1, 8, [3, 5], 0.28); }
        if (e.dashT <= 0) {
          e.bCount = (e.bCount || 0) - 1;
          if (e.bCount > 0) e.teleT = 0.12; else e.aTimer = 2.2;
        }
      } else if (e.teleT > 0) {
        e.teleT -= dt; vx = ux * e.speed * 0.2; vy = uy * e.speed * 0.2;
        if (e.teleT <= 0) { e.dashT = 0.3; e.dvx = ux * 720; e.dvy = uy * 720; }
      } else if (e.aTimer <= 0) {
        e.bCount = 3; e.teleT = 0.4;
        game.shake = Math.max(game.shake, 5); sfx.nova();
      }
    } else if (e.bossKind === "warlock") {
      const want = 320;
      if (d < want - 40) { vx = -ux * e.speed; vy = -uy * e.speed; }
      else if (d > want + 40) { vx = ux * e.speed; vy = uy * e.speed; }
      else { vx = -uy * e.speed * 0.7; vy = ux * e.speed * 0.7; }
      if (e.aTimer <= 0) {
        e.bCount = (e.bCount || 0) + 1;
        if (e.bCount % 3 === 0) {
          for (let i = 0; i < 3; i++) { const c = spawnEnemy("charger", e.x + rand(-30, 30), e.y + rand(-30, 30), 0.8); c.color = e.color; c.glow = e.glow; }
          shockwave(e.x, e.y, 74, e.glow); e.aTimer = 3.2;
        } else {
          const base = Math.atan2(player.y - e.y, player.x - e.x);
          for (let i = 0; i < 3; i++) {
            const a = base + (i - 1) * 0.22;
            enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 130, vy: Math.sin(a) * 130, r: 9, damage: e.dmg * 0.5, life: 5, color: e.color, glow: e.glow, homing: true, turn: 1.1 });
          }
          e.aTimer = 1.6; sfx.shoot();
        }
      }
    } else if (e.bossKind === "prism") {
      const want = 300;
      let bvx, bvy;
      if (d < want - 40) { bvx = -ux * e.speed; bvy = -uy * e.speed; }
      else if (d > want + 40) { bvx = ux * e.speed; bvy = uy * e.speed; }
      else { bvx = -uy * e.speed * 0.8; bvy = ux * e.speed * 0.8; }
      if (e.dashT > 0) { e.dashT -= dt; vx = bvx * 0.2; vy = bvy * 0.2; }
      else if (e.teleT > 0) {
        e.teleT -= dt; vx = bvx * 0.3; vy = bvy * 0.3;
        if (e.teleT <= 0) { firePrismVolley(e); e.dashT = 0.4; e.aTimer = 3.0; }
      } else if (e.aTimer <= 0) { e.teleT = 0.7; vx = bvx; vy = bvy; }
      else { vx = bvx; vy = bvy; }
    }
    // dread: plain chase (default vx/vy)
    return { vx, vy };
  }

  function fireRingWall(e) {
    const n = 26, gapStart = Math.floor(Math.random() * n), gapLen = 4;
    for (let i = 0; i < n; i++) {
      if (i >= gapStart && i < gapStart + gapLen) continue;
      const a = (TAU * i) / n;
      enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140, r: 8, damage: e.dmg * 0.5, life: 5, color: e.color, glow: e.glow });
    }
    if (enemyBullets.length > 320) enemyBullets.splice(0, enemyBullets.length - 320);
    shockwave(e.x, e.y, 62, e.glow); sfx.shoot();
  }

  function firePrismVolley(e) {
    const base = Math.atan2(player.y - e.y, player.x - e.x), n = 13, arc = 1.1;
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * (arc / n);
      enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 235, vy: Math.sin(a) * 235, r: 6, damage: e.dmg * 0.5, life: 4, color: e.color, glow: e.glow });
    }
    if (enemyBullets.length > 320) enemyBullets.splice(0, enemyBullets.length - 320);
    game.shake = Math.max(game.shake, 6); sfx.nova();
  }

  function fireSpiralArm(e, ang) {
    for (let k = 0; k < 2; k++) {
      const a = ang + k * Math.PI;
      enemyBullets.push({
        x: e.x, y: e.y,
        vx: Math.cos(a) * 175, vy: Math.sin(a) * 175,
        r: 6.5, damage: e.dmg * 0.5, life: 5,
        color: e.color, glow: e.glow,
      });
    }
    if (enemyBullets.length > 320) enemyBullets.splice(0, enemyBullets.length - 320);
  }

  function fireEnemyRing(e) {
    const n = 12;
    const base = Math.atan2(player.y - e.y, player.x - e.x);
    for (let i = 0; i < n; i++) {
      const a = base + (TAU * i) / n;
      enemyBullets.push({
        x: e.x, y: e.y,
        vx: Math.cos(a) * 190, vy: Math.sin(a) * 190,
        r: 7, damage: e.dmg * 0.6, life: 4.5,
        color: e.color, glow: e.glow,
      });
    }
    if (enemyBullets.length > 260) enemyBullets.splice(0, enemyBullets.length - 260);
    burst(e.x, e.y, e.color, 10, 160, [1.5, 3], 0.4);
    sfx.shoot();
  }

  function updateEnemyBullets(dt) {
    for (const b of enemyBullets) {
      // some boss orbs home in on the player
      if (b.homing) {
        const sp = Math.hypot(b.vx, b.vy) || 1;
        const desired = Math.atan2(player.y - b.y, player.x - b.x);
        let cur = Math.atan2(b.vy, b.vx);
        let diff = desired - cur;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        cur += clamp(diff, -b.turn * dt, b.turn * dt);
        b.vx = Math.cos(cur) * sp; b.vy = Math.sin(cur) * sp;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.x < -40 || b.y < -40 || b.x > WORLD.w + 40 || b.y > WORLD.h + 40) b.life = 0;
      const rr = b.r + player.r;
      if (player.invuln <= 0 && dist2(b.x, b.y, player.x, player.y) < rr * rr) {
        hurtPlayer(b.damage);
        b.life = 0;
        burst(b.x, b.y, b.color, 6, 140, [1.5, 3], 0.35);
      }
    }
    enemyBullets = enemyBullets.filter((b) => b.life > 0);
  }

  function hurtPlayer(amount) {
    if (player.invuln > 0) return;
    let armor = player.armor;
    if (player.bulwark > 0 && player.stillTime > 0.5) armor = clamp(armor + player.bulwark * 0.08, 0, 0.85); // bulwark: hunker down
    let dmg = amount * (1 - armor);
    // shield absorbs first (Warden: バリアジェネレータ)
    if (player.shield > 0) {
      const absorbed = Math.min(player.shield, dmg);
      player.shield -= absorbed;
      dmg -= absorbed;
      player.shieldTimer = 0; // pause regen after taking a hit
      shockwave(player.x, player.y, player.r * 2.4, "rgba(159,180,255,0.6)");
    }
    player.hp -= dmg;
    player.invuln = 0.6;
    if (player.adrenaline > 0) player.adrenTimer = 3.2; // adrenaline: surge on being hit
    game.shake = Math.max(game.shake, 10);
    game.hitFlash = 1;
    game.slow = Math.max(game.slow, 0.26); // brief slow-motion beat on being hit
    burst(player.x, player.y, "rgba(255,90,90,1)", 12, 200, [2, 4], 0.5);
    sfx.hurt();
    // reactive nova (Warden: リアクティブノヴァ)
    if (player.counter > 0 && !inAoe) {
      aoeDamage(player.x, player.y, 120 + player.counter * 20, 14 + player.counter * 10, "rgba(80,255,170,0.55)");
      game.shake = Math.max(game.shake, 6);
    }
    if (player.hp <= 0) {
      if (player.revives > 0) {
        revivePlayer();
        return;
      }
      player.hp = 0;
      die();
    }
  }

  function revivePlayer() {
    player.revives -= 1;
    player.hp = player.maxHp * 0.5;
    player.invuln = 2.0;
    game.shake = Math.max(game.shake, 18);
    sfx.level();
    shockwave(player.x, player.y, 200, "rgba(255,157,90,0.6)");
    burst(player.x, player.y, "rgba(255,157,90,1)", 40, 340, [2, 5], 0.9);
    floater(player.x, player.y - 30, "REVIVE!", "#ff9d5a", true);
    // push back / clear immediate threats only
    const r2 = 170 * 170;
    for (const e of enemies) {
      if (!e.boss && dist2(player.x, player.y, e.x, e.y) < r2) killEnemy(e);
    }
    // also clear hostile projectiles in range so revive isn't wasted instantly
    enemyBullets = enemyBullets.filter((b) => dist2(player.x, player.y, b.x, b.y) > r2);
  }

  function updateBullets(dt) {
    const spawned = []; // fork children, pushed after the main pass to avoid re-iteration
    for (const b of bullets) {
      // boomerang: fly out, decelerate, then curve back to the player
      if (b.boomerang !== undefined) {
        b.boomerang += dt;
        b.spin = (b.spin || 0) + dt * 20;
        if (b.boomerang < b.boomOut) {
          b.vx *= (1 - 1.9 * dt); b.vy *= (1 - 1.9 * dt);
        } else {
          if (!b._returning) { b._returning = true; b.hits = new Set(); } // re-hit on the way back
          const a = Math.atan2(player.y - b.y, player.x - b.x);
          const sp = 540;
          b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
          if (dist2(b.x, b.y, player.x, player.y) < (player.r + b.r) * (player.r + b.r)) b.life = 0;
        }
      }
      // homing: steer velocity toward nearest enemy
      if (b.homing) {
        const target = nearestEnemy(b.x, b.y);
        if (target) {
          const desired = Math.atan2(target.y - b.y, target.x - b.x);
          let cur = Math.atan2(b.vy, b.vx);
          let diff = desired - cur;
          while (diff > Math.PI) diff -= TAU;
          while (diff < -Math.PI) diff += TAU;
          cur += clamp(diff, -b.turn * dt, b.turn * dt);
          b.vx = Math.cos(cur) * b.speed;
          b.vy = Math.sin(cur) * b.speed;
        }
      }
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
          // frost lance: chill/slow struck enemies
          if (b.chill && !e.dead && e.hp > 0) {
            e.slowT = Math.max(e.slowT || 0, b.chill.t);
            e.slowMul = e.boss ? Math.max(0.6, b.chill.mul) : b.chill.mul;
            e.frost = 0.4;
          }
          burst(b.x, b.y, b.color, b.crit ? 8 : 4, b.crit ? 200 : 120, [1, b.crit ? 3 : 2.4], 0.3);
          spark(b.x, b.y, a + Math.PI / 2, b.crit ? "#fff2b0" : b.color, "impact", b.crit ? 1.7 : 1);
          if (b.crit) shockwave(b.x, b.y, 30, "rgba(255,220,120,0.6)");
          b.pierce--;
          if (b.pierce <= 0) {
            // ricochet: bounce to a fresh target instead of dying
            if (b.bounces > 0 && !b.explodeR) {
              const t = nearestUnhit(b.x, b.y, b.hits, 340);
              if (t) {
                b.bounces--;
                const ang = Math.atan2(t.y - b.y, t.x - b.x);
                b.vx = Math.cos(ang) * b.speed; b.vy = Math.sin(ang) * b.speed;
                b.pierce = 1; b.life = Math.max(b.life, 0.9);
                spark(b.x, b.y, ang + Math.PI / 2, b.glow, "impact", 1.1);
                break;
              }
            }
            // split shot: spawn secondary bullets fanned off the travel line
            if (b.fork > 0) {
              const n = b.fork, baseA = Math.atan2(b.vy, b.vx), cs = b.speed * 0.9;
              for (let k = 0; k < n; k++) {
                const ca = baseA + (k - (n - 1) / 2) * 0.55 + (n === 1 ? 0.5 : 0);
                spawned.push({ x: b.x, y: b.y, vx: Math.cos(ca) * cs, vy: Math.sin(ca) * cs, speed: cs,
                  damage: b.damage * 0.6, crit: b.crit, r: b.r * 0.85, color: b.color, glow: b.glow,
                  pierce: 1, hits: new Set([e]), life: 0.7, angle: ca, long: false, homing: false, turn: 0, bounces: 0, fork: 0, trail: [] });
              }
              spark(b.x, b.y, baseA, b.glow, "impact", 1.2);
            }
            b.life = 0; break;
          }
        }
      }
    }
    for (const sb of spawned) { bullets.push(sb); if (bullets.length > 260) bullets.shift(); }
    // missiles / bombs detonate when they die (impact or timeout)
    const shards = [];
    for (const b of bullets) {
      if (b.life <= 0 && b.explodeR && !b._boomed) {
        b._boomed = true;
        aoeDamage(b.x, b.y, b.explodeR, b.explodeDmg, b.glow);
        burst(b.x, b.y, b.color, 14, 240, [1.5, 3.5], 0.5);
        game.shake = Math.max(game.shake, 3);
        // cluster bomb: scatter secondary bullets radially on detonation
        if (b.cluster > 0) {
          const n = b.cluster, cs = 460;
          for (let k = 0; k < n; k++) {
            const ca = (k / n) * TAU + rand(-0.15, 0.15);
            shards.push({ x: b.x, y: b.y, vx: Math.cos(ca) * cs, vy: Math.sin(ca) * cs, speed: cs,
              damage: b.clusterDmg, crit: false, r: b.r * 0.7, color: b.color, glow: b.glow,
              pierce: 1, hits: new Set(), life: 0.55, angle: ca, long: false, homing: false, turn: 0, bounces: 0, fork: 0, trail: [] });
          }
        }
      }
    }
    for (const sb of shards) { bullets.push(sb); if (bullets.length > 260) bullets.shift(); }
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
        if (player.harvest > 0 && player.hp > 0 && player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + player.harvest * 0.6); // harvest heal
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

    for (const ln of lightnings) ln.life -= dt * 4.5;
    lightnings = lightnings.filter((ln) => ln.life > 0);

    for (const sl of slashes) sl.life -= dt * 5;
    slashes = slashes.filter((sl) => sl.life > 0);

    updateSparks(dt);
    updateDebris(dt);
    updateBooms(dt);
    updateSmoke(dt);

    if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 34);
    if (game.hitFlash > 0) game.hitFlash = Math.max(0, game.hitFlash - dt * 2.4);
    if (game.expFlash > 0) game.expFlash = Math.max(0, game.expFlash - dt * 3.4);
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
      player.xpNext = Math.round(3 + player.level * 2.2 + player.level * player.level * 0.42);
      openLevelUp();
    }
  }

  // ---------------------------------------------------------------------
  //  Upgrade selection
  // ---------------------------------------------------------------------
  let pendingChoices = [];

  function skillInfo(id) {
    if (WEAPONS[id]) return { kind: "weapon", def: WEAPONS[id], lv: weaponLv(id), max: WEAPONS[id].max };
    if (PASSIVES[id]) return { kind: "passive", def: PASSIVES[id], lv: player.passives[id] || 0, max: PASSIVES[id].max };
    return null;
  }

  // The choosable pool = the current costume's skills + the two universal
  // heals (which carry a tiny weight so they appear only rarely).
  function buildChoicePool() {
    const pool = [];
    const ids = costume.skills.concat(UNIVERSAL_SKILLS);
    for (const id of ids) {
      const info = skillInfo(id);
      if (!info || info.lv >= info.max) continue;
      const universal = UNIVERSAL_SKILLS.indexOf(id) >= 0;
      let weight = 1;
      if (universal) weight = RARE_WEIGHT;
      else if (info.kind === "weapon" && info.lv === 0) weight = 1.5; // nudge new weapons
      pool.push({ kind: info.kind, id, lv: info.lv, weight });
    }
    // Endless upgrades always available so choices never dry up. They stay rare
    // while real skills remain, then take over once the roster is exhausted.
    const realCount = pool.length;
    for (const id of ENDLESS_SKILLS) {
      const lv = player.passives[id] || 0;
      pool.push({ kind: "passive", id, lv, weight: realCount >= 3 ? 0.3 : 2.2 });
    }
    return pool;
  }

  // Weighted sampling without replacement.
  function weightedSample(pool, n) {
    const items = pool.slice();
    const out = [];
    for (let k = 0; k < n && items.length; k++) {
      let total = 0;
      for (const it of items) total += it.weight;
      let r = Math.random() * total, idx = 0;
      for (let i = 0; i < items.length; i++) { r -= items[i].weight; if (r <= 0) { idx = i; break; } }
      out.push(items[idx]);
      items.splice(idx, 1);
    }
    return out;
  }

  function openLevelUp() {
    // don't stack multiple modals; queue is handled by re-open after choice
    if (game.state === "levelup") return;
    const pool = buildChoicePool();
    pendingChoices = weightedSample(pool, 3);
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
        case "fullheal": player.hp = player.maxHp; break;
        case "magnet": player.pickupRange *= 1.4; break;
        case "crit": player.critChance = clamp(player.critChance + 0.08, 0, 0.9); break;
        case "greed": player.xpMul += 0.2; break;
        case "armor": player.armor = clamp(player.armor + 0.1, 0, 0.75); break;
        case "lifesteal": player.lifestealChance = clamp(player.lifestealChance + 0.1, 0, 0.6); break;
        case "bigshot": player.projectileSize += 0.2; player.damageMul += 0.06; break;
        case "revive": player.revives += 1; break;
        case "multishot": player.projectiles += 1; break;
        case "longshot": player.rangeMul += 0.18; break;
        case "velocity": player.projSpeedMul += 0.18; break;
        case "blast": player.aoeMul += 0.16; break;
        case "sniper": player.critMul += 0.4; break;
        case "glass": player.damageMul += 0.4; player.maxHp = Math.max(20, player.maxHp - 20); player.hp = Math.min(player.hp, player.maxHp); break;
        case "berserk": player.berserk = true; break;
        case "thorns": player.thorns += 12; break;
        // signatures
        case "shield": player.shieldMax += 25; player.shield = player.shieldMax; player.shieldTimer = 0; break;
        case "counter": player.counter += 1; break;
        case "execute": player.executePct = 0.08 + (player.passives.execute - 1) * 0.03; break;
        case "critblast": player.critblast += 1; break;
        case "coldblood": player.coldblood += 1; break;
        case "voidburst": player.voidburst += 1; break;
        case "bloodhit": player.bloodhitChance = clamp(player.bloodhitChance + 0.12, 0, 0.6); break;
        case "vapor": player.vapor += 1; break;
        case "cryo": player.cryo += 1; break;
        case "ricochet": player.ricochet += 1; break;
        case "overload": player.overload += 1; break;
        case "comboedge": player.comboEdge += 1; break;
        case "lucky": player.luck += 1; break;
        // extended roster
        case "pierce": player.pierceBonus += 1; break;
        case "weakpoint": player.bossDmg = clamp(player.bossDmg + 0.2, 0, 1.2); break;
        case "regen": player.regen += 1.2; break;
        case "bulwark": player.bulwark += 1; break;
        case "swarm": player.swarm += 1; break;
        case "adrenaline": player.adrenaline += 1; break;
        case "harvest": player.harvest += 1; break;
        case "momentum": player.momentum += 1; break;
        // endless upgrades
        case "e_power": player.damageMul += 0.08; break;
        case "e_haste": player.fireRateMul += 0.07; break;
        case "e_vit": player.maxHp += 15; player.hp = Math.min(player.maxHp, player.hp + 15); break;
        case "e_swift": player.speed += 12; break;
        case "e_crit": player.critChance = clamp(player.critChance + 0.03, 0, 0.95); break;
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
    drawPowerups();
    drawAura();
    drawGravityField();
    drawVaporTrail();
    drawEnemies();
    drawEnemyBullets();
    drawBullets();
    drawLightnings();
    drawSlashes();
    drawOrbiters();
    drawPlayer();
    drawSmoke();
    drawShockwaves();
    drawParticles();
    drawDebris();
    drawSparks();
    drawFloaters();

    ctx.restore();

    // explosion-light screen flash (screen space, additive)
    if (game.expFlash > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(" + game.expFlashCol + "," + (game.expFlash * 0.5).toFixed(3) + ")";
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.restore();
    }

    drawScoreHud();
    drawJoystick();
  }

  // Screen-space score + combo readout (top centre, clear of the corner HUD).
  function drawScoreHud() {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    // score
    ctx.font = "700 15px 'Chakra Petch', system-ui, sans-serif";
    ctx.fillStyle = "rgba(190,210,255,0.55)";
    ctx.fillText("SCORE", viewW / 2, 14);
    ctx.font = "800 30px 'Chakra Petch', system-ui, sans-serif";
    ctx.fillStyle = "#eef5ff";
    ctx.shadowColor = "rgba(56,246,255,0.5)"; ctx.shadowBlur = 14;
    ctx.fillText(player.score.toLocaleString("en-US"), viewW / 2, 30);
    ctx.shadowBlur = 0;
    // combo
    if (player.combo >= 3 && player.comboTimer > 0) {
      const mult = comboMult();
      const tier = mult >= 3 ? "#ff3ea5" : mult >= 2 ? "#ffd166" : "#38f6ff";
      const pop = 1 + Math.max(0, player.comboTimer - 2.2) * 1.2; // brief pop on refresh
      const decay = clamp(player.comboTimer / 2.6, 0, 1);
      ctx.globalAlpha = 0.55 + decay * 0.45;
      ctx.font = "800 " + Math.round(26 * pop) + "px 'Chakra Petch', system-ui, sans-serif";
      ctx.fillStyle = tier;
      ctx.shadowColor = tier; ctx.shadowBlur = 16;
      ctx.fillText("COMBO x" + player.combo + "  (" + mult.toFixed(2) + "x)", viewW / 2, 70);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    // active power-up timers, stacked down the left edge
    let by = viewH * 0.34;
    for (const b of player.buffs) {
      const pu = POWERUPS[b.type]; if (!pu) continue;
      const cx = 34, cy = by, rr = 16;
      const frac = clamp(b.t / pu.dur, 0, 1);
      ctx.beginPath(); ctx.fillStyle = "rgba(8,12,24,0.72)"; ctx.arc(cx, cy, rr, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(120,150,230,0.25)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
      ctx.strokeStyle = pu.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + frac * TAU); ctx.stroke();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalCompositeOperation = "lighter";
      drawPowerSymbol(b.type, rr * 0.5, pu.color);
      ctx.restore();
      by += rr * 2 + 12;
    }
    ctx.restore();
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
    // trail (costume-tinted)
    ctx.globalCompositeOperation = "lighter";
    for (const t of player.trail) {
      drawGlow(t.x, t.y, player.r * 1.6 * t.life, ship.glow, t.life * 0.5);
    }
    ctx.globalCompositeOperation = "source-over";

    // pickup range ring (subtle)
    ctx.strokeStyle = "rgba(120,200,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.pickupRange, 0, TAU);
    ctx.stroke();

    // shield ring (Warden)
    if (player.shield > 0.5) {
      const sf = clamp(player.shield / player.shieldMax, 0, 1);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "rgba(159,180,255," + (0.35 + sf * 0.4) + ")";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.r * 1.9, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    const blink = player.invuln > 0 && Math.floor(player.invuln * 20) % 2 === 0;
    drawGlow(player.x, player.y, player.r * 2.6, ship.glow, blink ? 0.4 : 0.9);

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.facing + Math.PI / 2);
    // render slightly larger than the hitbox so the detailing reads
    drawShipInto(ctx, player.r * 1.22, ship, blink ? 0.6 : 1, game.time);
    ctx.restore();
  }

  // Layered costume ships. Each is assembled from separate parts (hull, wings,
  // fins) so it reads as a constructed craft, not a flat polygon. Coordinates
  // are multiples of r with the nose pointing up (-y).
  const SHIP_BUILD = {
    // Vanguard — sleek arrowhead interceptor, swept delta wings + canards
    interceptor: {
      hull: [[0,-1.42],[0.2,-0.55],[0.26,0.45],[0.15,1.02],[-0.15,1.02],[-0.26,0.45],[-0.2,-0.55]],
      wings: [[[-0.18,-0.12],[-1.02,0.72],[-0.72,1.0],[-0.22,0.66]],[[0.18,-0.12],[1.02,0.72],[0.72,1.0],[0.22,0.66]]],
      fins: [[[-0.18,-0.5],[-0.52,-0.12],[-0.2,0.02]],[[0.18,-0.5],[0.52,-0.12],[0.2,0.02]]],
      cockpit: [0,-0.62,0.15,0.42],
      engines: [[-0.15,1.0,0.13],[0.15,1.0,0.13]],
      stripes: [[[0,-1.2],[0,0.85]],[[-0.32,0.4],[-0.78,0.82]],[[0.32,0.4],[0.78,0.82]]],
      lights: [[-1.02,0.72],[1.02,0.72]],
    },
    // Warden — heavy armored cruiser, broad side armor blocks + shoulder plates
    fortress: {
      hull: [[0,-1.05],[0.5,-0.62],[0.58,0.5],[0.34,1.04],[-0.34,1.04],[-0.58,0.5],[-0.5,-0.62]],
      wings: [[[-0.5,-0.45],[-1.18,-0.12],[-1.22,0.62],[-0.82,0.92],[-0.56,0.5]],[[0.5,-0.45],[1.18,-0.12],[1.22,0.62],[0.82,0.92],[0.56,0.5]]],
      fins: [[[-0.48,-0.6],[-0.92,-0.5],[-0.72,-0.18],[-0.46,-0.24]],[[0.48,-0.6],[0.92,-0.5],[0.72,-0.18],[0.46,-0.24]]],
      cockpit: [0,-0.34,0.24,0.34],
      engines: [[-0.4,1.02,0.19],[0.4,1.02,0.19]],
      stripes: [[[-0.9,0.5],[-0.56,0.0]],[[0.9,0.5],[0.56,0.0]],[[-0.26,-0.88],[0,-0.52]],[[0.26,-0.88],[0,-0.52]]],
      lights: [[-1.2,0.25],[1.2,0.25]],
    },
    // Tempest — jagged forward-swept lightning frame, split rear prongs
    bolt: {
      hull: [[0,-1.5],[0.19,-0.45],[0.3,0.38],[0.48,1.12],[0,0.66],[-0.48,1.12],[-0.3,0.38],[-0.19,-0.45]],
      wings: [[[-0.19,-0.05],[-1.24,0.02],[-0.52,0.36],[-0.28,0.28]],[[0.19,-0.05],[1.24,0.02],[0.52,0.36],[0.28,0.28]]],
      fins: [[[-0.28,0.3],[-0.62,0.6],[-0.3,0.5]],[[0.28,0.3],[0.62,0.6],[0.3,0.5]]],
      cockpit: [0,-0.66,0.13,0.44],
      engines: [[-0.4,0.98,0.14],[0.4,0.98,0.14]],
      stripes: [[[0,-1.25],[0,0.55]],[[-0.25,0.12],[-1.0,0.03]],[[0.25,0.12],[1.0,0.03]]],
      lights: [[-1.24,0.02],[1.24,0.02]],
    },
    // Hunter — long needle sniper, mid wings, rear stabilisers, single engine
    lance: {
      hull: [[0,-1.85],[0.13,-0.35],[0.19,0.7],[0.13,1.12],[-0.13,1.12],[-0.19,0.7],[-0.13,-0.35]],
      wings: [[[-0.15,0.18],[-0.76,0.52],[-0.6,0.8],[-0.17,0.58]],[[0.15,0.18],[0.76,0.52],[0.6,0.8],[0.17,0.58]]],
      fins: [[[-0.13,0.92],[-0.4,1.2],[-0.13,1.08]],[[0.13,0.92],[0.4,1.2],[0.13,1.08]]],
      cockpit: [0,-0.98,0.1,0.52],
      engines: [[0,1.12,0.2]],
      stripes: [[[0,-1.55],[0,0.9]]],
      lights: [[-0.76,0.52],[0.76,0.52]],
    },
    // Phantom — menacing crescent, forward-hooked scythe blades
    scythe: {
      hull: [[0,-1.3],[0.26,-0.35],[0.32,0.48],[0.18,1.0],[-0.18,1.0],[-0.32,0.48],[-0.26,-0.35]],
      wings: [[[-0.24,-0.05],[-0.95,-0.25],[-1.3,0.05],[-0.98,0.5],[-0.5,0.32],[-0.28,0.32]],[[0.24,-0.05],[0.95,-0.25],[1.3,0.05],[0.98,0.5],[0.5,0.32],[0.28,0.32]]],
      fins: [[[-0.95,-0.25],[-1.22,-0.42],[-0.9,-0.1]],[[0.95,-0.25],[1.22,-0.42],[0.9,-0.1]]],
      cockpit: [0,-0.52,0.17,0.4],
      engines: [[-0.2,0.98,0.15],[0.2,0.98,0.15]],
      stripes: [[[0,-1.05],[0,0.7]],[[-0.28,0.08],[-0.9,-0.06]],[[0.28,0.08],[0.9,-0.06]]],
      lights: [[-1.3,0.05],[1.3,0.05]],
    },
    // ---- unlockable ship silhouettes ----
    dart: { // Razor — compact forward-swept racer
      hull: [[0,-1.4],[0.16,-0.4],[0.22,0.5],[0.12,1.05],[-0.12,1.05],[-0.22,0.5],[-0.16,-0.4]],
      wings: [[[-0.18,0.0],[-0.85,-0.15],[-0.5,0.35],[-0.24,0.4]],[[0.18,0.0],[0.85,-0.15],[0.5,0.35],[0.24,0.4]]],
      fins: [[[-0.16,0.7],[-0.42,1.05],[-0.14,0.95]],[[0.16,0.7],[0.42,1.05],[0.14,0.95]]],
      cockpit: [0,-0.6,0.13,0.44], engines: [[-0.12,1.03,0.13],[0.12,1.03,0.13]],
      stripes: [[[0,-1.2],[0,0.9]],[[-0.2,0.05],[-0.7,-0.1]],[[0.2,0.05],[0.7,-0.1]]], lights: [[-0.85,-0.15],[0.85,-0.15]],
    },
    wraith: { // Nocturne — angular stealth with sharp swept wings
      hull: [[0,-1.5],[0.2,-0.3],[0.16,0.6],[0.1,1.0],[-0.1,1.0],[-0.16,0.6],[-0.2,-0.3]],
      wings: [[[-0.16,-0.2],[-1.15,0.85],[-0.85,0.95],[-0.2,0.5]],[[0.16,-0.2],[1.15,0.85],[0.85,0.95],[0.2,0.5]]],
      fins: [[[-0.16,-0.5],[-0.5,-0.25],[-0.2,-0.05]],[[0.16,-0.5],[0.5,-0.25],[0.2,-0.05]]],
      cockpit: [0,-0.7,0.1,0.5], engines: [[0,1.0,0.16]],
      stripes: [[[0,-1.3],[0,0.7]],[[-0.3,0.55],[-0.75,0.9]],[[0.3,0.55],[0.75,0.9]]], lights: [[-1.15,0.85],[1.15,0.85]],
    },
    titan: { // Colossus — massive blocky battle-cruiser
      hull: [[0,-0.95],[0.55,-0.7],[0.66,0.4],[0.5,1.05],[-0.5,1.05],[-0.66,0.4],[-0.55,-0.7]],
      wings: [[[-0.55,-0.55],[-1.25,-0.3],[-1.3,0.7],[-0.9,1.0],[-0.62,0.6]],[[0.55,-0.55],[1.25,-0.3],[1.3,0.7],[0.9,1.0],[0.62,0.6]]],
      fins: [[[-0.5,-0.7],[-1.0,-0.6],[-0.85,-0.2],[-0.5,-0.28]],[[0.5,-0.7],[1.0,-0.6],[0.85,-0.2],[0.5,-0.28]]],
      cockpit: [0,-0.4,0.26,0.3], engines: [[-0.44,1.03,0.2],[0.44,1.03,0.2]],
      stripes: [[[-0.95,0.55],[-0.6,-0.1]],[[0.95,0.55],[0.6,-0.1]],[[-0.3,-0.85],[0,-0.5]],[[0.3,-0.85],[0,-0.5]]], lights: [[-1.28,0.3],[1.28,0.3]],
    },
    saucer: { // Orbiter — round disc with a central dome
      hull: [[0,-0.7],[0.5,-0.55],[0.85,-0.15],[0.95,0.15],[0.7,0.5],[0.35,0.68],[0,0.72],[-0.35,0.68],[-0.7,0.5],[-0.95,0.15],[-0.85,-0.15],[-0.5,-0.55]],
      wings: [], fins: [[[-0.4,0.55],[-0.72,0.92],[-0.3,0.7]],[[0.4,0.55],[0.72,0.92],[0.3,0.7]]],
      cockpit: [0,-0.05,0.3,0.3], engines: [[-0.3,0.66,0.14],[0.3,0.66,0.14]],
      stripes: [[[-0.85,-0.15],[0.85,-0.15]],[[-0.6,0.4],[0.6,0.4]]], lights: [[-0.95,0.15],[0.95,0.15],[0,-0.7]],
    },
    manta: { // Manta — wide flat ray wings
      hull: [[0,-1.0],[0.18,-0.2],[0.22,0.6],[0.14,1.0],[-0.14,1.0],[-0.22,0.6],[-0.18,-0.2]],
      wings: [[[-0.18,-0.1],[-1.4,0.5],[-0.9,0.8],[-0.2,0.55]],[[0.18,-0.1],[1.4,0.5],[0.9,0.8],[0.2,0.55]]],
      fins: [[[-0.14,0.8],[-0.3,1.25],[-0.14,1.0]],[[0.14,0.8],[0.3,1.25],[0.14,1.0]]],
      cockpit: [0,-0.5,0.14,0.36], engines: [[-0.13,1.0,0.13],[0.13,1.0,0.13]],
      stripes: [[[0,-0.85],[0,0.85]],[[-0.25,0.2],[-1.1,0.45]],[[0.25,0.2],[1.1,0.45]]], lights: [[-1.4,0.5],[1.4,0.5]],
    },
    pike: { // Pike — ultra-long piercing lance
      hull: [[0,-2.0],[0.1,-0.4],[0.15,0.7],[0.1,1.1],[-0.1,1.1],[-0.15,0.7],[-0.1,-0.4]],
      wings: [[[-0.12,0.3],[-0.55,0.5],[-0.5,0.7],[-0.14,0.55]],[[0.12,0.3],[0.55,0.5],[0.5,0.7],[0.14,0.55]]],
      fins: [[[-0.1,0.95],[-0.32,1.2],[-0.1,1.08]],[[0.1,0.95],[0.32,1.2],[0.1,1.08]]],
      cockpit: [0,-1.1,0.08,0.55], engines: [[0,1.1,0.16]],
      stripes: [[[0,-1.7],[0,0.95]]], lights: [[-0.55,0.5],[0.55,0.5]],
    },
    scarab: { // Scarab — beetle body with forward claws
      hull: [[0,-0.9],[0.35,-0.6],[0.42,0.3],[0.3,0.95],[-0.3,0.95],[-0.42,0.3],[-0.35,-0.6]],
      wings: [[[-0.35,-0.3],[-0.95,-0.55],[-1.1,-0.1],[-0.7,0.15],[-0.4,0.1]],[[0.35,-0.3],[0.95,-0.55],[1.1,-0.1],[0.7,0.15],[0.4,0.1]]],
      fins: [[[-0.3,0.6],[-0.6,1.0],[-0.28,0.8]],[[0.3,0.6],[0.6,1.0],[0.28,0.8]]],
      cockpit: [0,-0.35,0.22,0.3], engines: [[-0.22,0.92,0.15],[0.22,0.92,0.15]],
      stripes: [[[0,-0.7],[0,0.8]],[[-0.2,0.0],[-0.5,-0.2]],[[0.2,0.0],[0.5,-0.2]]], lights: [[-1.1,-0.1],[1.1,-0.1]],
    },
    falcon: { // Falcon — sharp clean chevron
      hull: [[0,-1.5],[0.14,-0.5],[0.2,0.4],[0.12,0.95],[-0.12,0.95],[-0.2,0.4],[-0.14,-0.5]],
      wings: [[[-0.16,-0.1],[-1.05,0.7],[-0.78,0.95],[-0.2,0.55]],[[0.16,-0.1],[1.05,0.7],[0.78,0.95],[0.2,0.55]]],
      fins: [[[-0.16,-0.45],[-0.48,-0.1],[-0.18,0.05]],[[0.16,-0.45],[0.48,-0.1],[0.18,0.05]]],
      cockpit: [0,-0.65,0.12,0.46], engines: [[-0.12,0.93,0.13],[0.12,0.93,0.13]],
      stripes: [[[0,-1.3],[0,0.8]],[[-0.28,0.45],[-0.72,0.82]],[[0.28,0.45],[0.72,0.82]]], lights: [[-1.05,0.7],[1.05,0.7]],
    },
    seraph: { // Seraph — radiant craft with upper and lower wing pairs
      hull: [[0,-1.3],[0.22,-0.4],[0.26,0.45],[0.15,1.0],[-0.15,1.0],[-0.26,0.45],[-0.22,-0.4]],
      wings: [[[-0.2,-0.15],[-1.1,-0.35],[-0.95,0.15],[-0.5,0.25],[-0.24,0.3]],[[0.2,-0.15],[1.1,-0.35],[0.95,0.15],[0.5,0.25],[0.24,0.3]]],
      fins: [[[-0.24,0.4],[-0.8,0.85],[-0.26,0.7]],[[0.24,0.4],[0.8,0.85],[0.26,0.7]]],
      cockpit: [0,-0.55,0.16,0.4], engines: [[-0.18,0.98,0.15],[0.18,0.98,0.15]],
      stripes: [[[0,-1.1],[0,0.8]],[[-0.3,0.1],[-0.9,-0.15]],[[0.3,0.1],[0.9,-0.15]]], lights: [[-1.1,-0.35],[1.1,-0.35],[-0.8,0.85],[0.8,0.85]],
    },
    starcruiser: { // Novastar — multi-point star cruiser
      hull: [[0,-1.35],[0.3,-0.3],[0.9,-0.05],[0.35,0.2],[0.16,1.1],[-0.16,1.1],[-0.35,0.2],[-0.9,-0.05],[-0.3,-0.3]],
      wings: [], fins: [[[-0.9,-0.05],[-1.15,-0.2],[-0.75,-0.1]],[[0.9,-0.05],[1.15,-0.2],[0.75,-0.1]]],
      cockpit: [0,-0.4,0.16,0.38], engines: [[-0.13,1.1,0.13],[0.13,1.1,0.13]],
      stripes: [[[0,-1.15],[0,0.9]],[[-0.3,-0.1],[-0.8,-0.05]],[[0.3,-0.1],[0.8,-0.05]]], lights: [[-0.9,-0.05],[0.9,-0.05]],
    },
    crystal: { // Glacia — faceted ice shard
      hull: [[0,-1.45],[0.24,-0.5],[0.3,0.4],[0.16,1.05],[-0.16,1.05],[-0.3,0.4],[-0.24,-0.5]],
      wings: [[[-0.2,-0.2],[-0.95,0.1],[-1.05,0.6],[-0.55,0.55],[-0.26,0.4]],[[0.2,-0.2],[0.95,0.1],[1.05,0.6],[0.55,0.55],[0.26,0.4]]],
      fins: [[[-0.2,-0.55],[-0.55,-0.35],[-0.24,-0.1]],[[0.2,-0.55],[0.55,-0.35],[0.24,-0.1]]],
      cockpit: [0,-0.6,0.14,0.44], engines: [[-0.14,1.03,0.13],[0.14,1.03,0.13]],
      stripes: [[[0,-1.25],[0,0.9]],[[-0.28,0.1],[-0.85,0.35]],[[0.28,0.1],[0.85,0.35]]], lights: [[-1.05,0.6],[1.05,0.6]],
    },
    kite: { // Reflex — diamond kite with swept tips
      hull: [[0,-1.35],[0.32,-0.1],[0.2,0.55],[0.12,1.05],[-0.12,1.05],[-0.2,0.55],[-0.32,-0.1]],
      wings: [[[-0.28,-0.05],[-1.1,0.4],[-0.7,0.7],[-0.22,0.5]],[[0.28,-0.05],[1.1,0.4],[0.7,0.7],[0.22,0.5]]],
      fins: [[[-0.12,0.75],[-0.4,1.1],[-0.12,0.95]],[[0.12,0.75],[0.4,1.1],[0.12,0.95]]],
      cockpit: [0,-0.5,0.15,0.4], engines: [[-0.12,1.03,0.13],[0.12,1.03,0.13]],
      stripes: [[[0,-1.15],[0,0.9]],[[-0.25,0.2],[-0.85,0.42]],[[0.25,0.2],[0.85,0.42]]], lights: [[-1.1,0.4],[1.1,0.4]],
    },
    flare: { // Ignis — upswept flame wings
      hull: [[0,-1.4],[0.2,-0.45],[0.28,0.45],[0.16,1.05],[-0.16,1.05],[-0.28,0.45],[-0.2,-0.45]],
      wings: [[[-0.22,-0.1],[-1.15,-0.5],[-0.85,0.05],[-0.5,0.2],[-0.26,0.35]],[[0.22,-0.1],[1.15,-0.5],[0.85,0.05],[0.5,0.2],[0.26,0.35]]],
      fins: [[[-0.26,0.45],[-0.75,0.95],[-0.28,0.7]],[[0.26,0.45],[0.75,0.95],[0.28,0.7]]],
      cockpit: [0,-0.55,0.15,0.4], engines: [[-0.18,1.03,0.15],[0.18,1.03,0.15]],
      stripes: [[[0,-1.15],[0,0.9]],[[-0.3,0.05],[-0.9,-0.2]],[[0.3,0.05],[0.9,-0.2]]], lights: [[-1.15,-0.5],[1.15,-0.5],[-0.75,0.95],[0.75,0.95]],
    },
    aegis: { // Guardian — round shield fortress
      hull: [[0,-1.05],[0.6,-0.55],[0.7,0.35],[0.45,1.0],[-0.45,1.0],[-0.7,0.35],[-0.6,-0.55]],
      wings: [[[-0.6,-0.4],[-1.2,-0.05],[-1.2,0.55],[-0.8,0.85],[-0.62,0.5]],[[0.6,-0.4],[1.2,-0.05],[1.2,0.55],[0.8,0.85],[0.62,0.5]]],
      fins: [[[-0.55,-0.55],[-0.95,-0.4],[-0.78,-0.12],[-0.5,-0.2]],[[0.55,-0.55],[0.95,-0.4],[0.78,-0.12],[0.5,-0.2]]],
      cockpit: [0,-0.35,0.25,0.3], engines: [[-0.4,0.98,0.18],[0.4,0.98,0.18]],
      stripes: [[[-0.5,-0.3],[0,-0.7]],[[0.5,-0.3],[0,-0.7]],[[-0.9,0.4],[-0.55,-0.05]],[[0.9,0.4],[0.55,-0.05]]], lights: [[-1.2,0.25],[1.2,0.25]],
    },
    reaper: { // Arbiter — long executioner dagger
      hull: [[0,-1.7],[0.16,-0.35],[0.22,0.6],[0.13,1.1],[-0.13,1.1],[-0.22,0.6],[-0.16,-0.35]],
      wings: [[[-0.18,0.0],[-1.0,0.55],[-0.7,0.85],[-0.2,0.55]],[[0.18,0.0],[1.0,0.55],[0.7,0.85],[0.2,0.55]]],
      fins: [[[-0.16,-0.4],[-0.5,-0.15],[-0.2,0.02]],[[0.16,-0.4],[0.5,-0.15],[0.2,0.02]]],
      cockpit: [0,-0.85,0.11,0.5], engines: [[0,1.1,0.17]],
      stripes: [[[0,-1.4],[0,0.9]],[[-0.28,0.25],[-0.75,0.6]],[[0.28,0.25],[0.75,0.6]]], lights: [[-1.0,0.55],[1.0,0.55]],
    },
  };

  // Tint a #rrggbb toward black (f<1) or white (f>1); returns an rgba() string.
  const _tintCache = new Map();
  function tint(hex, f, a) {
    const key = hex + "|" + f + "|" + a;
    let v = _tintCache.get(key);
    if (v) return v;
    let h = hex.replace("#", "");
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    let r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
    if (f <= 1) { r*=f; g*=f; b*=f; }
    else { const t = f-1; r+=(255-r)*t; g+=(255-g)*t; b+=(255-b)*t; }
    v = "rgba(" + (r|0) + "," + (g|0) + "," + (b|0) + "," + (a==null?1:a) + ")";
    _tintCache.set(key, v);
    return v;
  }

  function shipPoly(g, pts, r) {
    g.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = pts[i][0]*r, y = pts[i][1]*r;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.closePath();
  }

  // A shaded part: top-lit vertical gradient + clipped diagonal sheen.
  function shipPart(g, pts, r, top, bot, sheen) {
    shipPoly(g, pts, r);
    const grd = g.createLinearGradient(0, -r*1.4, 0, r*1.15);
    grd.addColorStop(0, top);
    grd.addColorStop(1, bot);
    g.fillStyle = grd;
    g.fill();
    if (sheen) {
      g.save();
      shipPoly(g, pts, r); g.clip();
      const s = g.createLinearGradient(-r*1.1, -r*1.3, r*0.6, r);
      s.addColorStop(0, "rgba(255,255,255," + sheen + ")");
      s.addColorStop(0.4, "rgba(255,255,255,0.03)");
      s.addColorStop(1, "rgba(0,0,0,0.22)");
      g.fillStyle = s;
      g.fillRect(-r*2, -r*2, r*4, r*4);
      g.restore();
    }
  }

  function shipRim(g, pts, r, neon) {
    shipPoly(g, pts, r);
    g.lineWidth = Math.max(1, r*0.05);
    g.strokeStyle = "rgba(255,255,255,0.82)";
    g.stroke();
    g.save();
    g.globalCompositeOperation = "lighter";
    shipPoly(g, pts, r);
    g.lineWidth = Math.max(1, r*0.05);
    g.strokeStyle = neon;
    g.stroke();
    g.restore();
  }

  function drawEngine(g, x, y, w, len, flame) {
    g.save();
    g.globalCompositeOperation = "lighter";
    const gg = g.createRadialGradient(x, y, 0, x, y, w*3);
    gg.addColorStop(0, flame);
    gg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gg;
    g.beginPath(); g.arc(x, y, w*3, 0, TAU); g.fill();
    const grd = g.createLinearGradient(x, y - w*0.5, x, y + len);
    grd.addColorStop(0, "rgba(255,255,255,0.98)");
    grd.addColorStop(0.3, flame);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(x - w, y - w*0.3);
    g.quadraticCurveTo(x, y + len*1.3, x + w, y - w*0.3);
    g.closePath();
    g.fill();
    g.restore();
  }

  function drawNozzle(g, x, y, w) {
    g.beginPath();
    g.moveTo(x - w*1.15, y - w*0.7);
    g.lineTo(x + w*1.15, y - w*0.7);
    g.lineTo(x + w*0.82, y + w*0.5);
    g.lineTo(x - w*0.82, y + w*0.5);
    g.closePath();
    const ng = g.createLinearGradient(x, y - w, x, y + w);
    ng.addColorStop(0, "rgba(52,58,78,1)");
    ng.addColorStop(1, "rgba(9,11,20,1)");
    g.fillStyle = ng;
    g.fill();
    g.save();
    g.globalCompositeOperation = "lighter";
    g.fillStyle = "rgba(255,255,255,0.45)";
    g.beginPath(); g.ellipse(x, y - w*0.15, w*0.6, w*0.28, 0, 0, TAU); g.fill();
    g.restore();
  }

  function drawCockpit(g, c, r, sh) {
    const cx = c[0]*r, cy = c[1]*r, rx = c[2]*r, ry = c[3]*r;
    // dark socket
    g.fillStyle = "rgba(6,8,16,0.92)";
    g.beginPath(); g.ellipse(cx, cy, rx*1.28, ry*1.18, 0, 0, TAU); g.fill();
    // glow bloom
    g.save();
    g.globalCompositeOperation = "lighter";
    const cg = g.createRadialGradient(cx, cy, 0, cx, cy, ry*2.1);
    cg.addColorStop(0, sh.glow);
    cg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = cg;
    g.beginPath(); g.arc(cx, cy, ry*2.1, 0, TAU); g.fill();
    g.restore();
    // glass dome
    const dg = g.createLinearGradient(cx, cy - ry, cx, cy + ry);
    dg.addColorStop(0, tint(sh.g1, 1.65));
    dg.addColorStop(0.5, sh.g1);
    dg.addColorStop(1, tint(sh.g2, 0.55));
    g.fillStyle = dg;
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.fill();
    // specular highlight
    g.fillStyle = "rgba(255,255,255,0.92)";
    g.beginPath(); g.ellipse(cx - rx*0.32, cy - ry*0.42, rx*0.34, ry*0.26, 0, 0, TAU); g.fill();
    // rim
    g.lineWidth = Math.max(0.8, r*0.03);
    g.strokeStyle = "rgba(255,255,255,0.55)";
    g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.stroke();
  }

  // Draws a fully assembled costume ship centred at (0,0) pointing up.
  function drawShipInto(g, r, sh, alpha, flameT) {
    const b = SHIP_BUILD[sh.shape] || SHIP_BUILD.interceptor;
    const flick = flameT != null ? (0.85 + Math.sin(flameT*26)*0.18 + Math.sin(flameT*61)*0.06) : 0.92;
    g.globalAlpha = alpha == null ? 1 : alpha;

    // 1) engine plumes (behind everything)
    for (const e of b.engines) drawEngine(g, e[0]*r, e[1]*r, e[2]*r, r*1.15*flick, sh.flame);

    // 2) drop shadow (hull + wings) for depth
    g.save();
    g.translate(r*0.05, r*0.09);
    g.fillStyle = "rgba(0,0,0,0.4)";
    for (const w of b.wings) { shipPoly(g, w, r); g.fill(); }
    shipPoly(g, b.hull, r); g.fill();
    g.restore();

    // 3) wings (darker, behind hull) + their own rim
    for (const w of b.wings) {
      shipPart(g, w, r, tint(sh.g1, 0.92), tint(sh.g2, 0.5), 0.32);
      shipRim(g, w, r, sh.g1);
    }

    // 4) nozzle housings sitting at the tail
    for (const e of b.engines) drawNozzle(g, e[0]*r, e[1]*r, e[2]*r);

    // 5) main hull — top-lit metallic body with 3-stop gradient + sheen
    shipPoly(g, b.hull, r);
    const hg = g.createLinearGradient(0, -r*1.5, 0, r*1.1);
    hg.addColorStop(0, sh.g0);
    hg.addColorStop(0.42, tint(sh.g1, 1.2));
    hg.addColorStop(0.72, sh.g1);
    hg.addColorStop(1, tint(sh.g2, 0.85));
    g.fillStyle = hg;
    g.fill();
    // diagonal sheen clipped to hull
    g.save();
    shipPoly(g, b.hull, r); g.clip();
    const sh2 = g.createLinearGradient(-r*1.1, -r*1.4, r*0.6, r);
    sh2.addColorStop(0, "rgba(255,255,255,0.55)");
    sh2.addColorStop(0.4, "rgba(255,255,255,0.04)");
    sh2.addColorStop(1, "rgba(0,0,0,0.24)");
    g.fillStyle = sh2;
    g.fillRect(-r*2, -r*2, r*4, r*4);
    // panel lines
    g.strokeStyle = "rgba(0,0,0,0.22)";
    g.lineWidth = Math.max(0.7, r*0.03);
    g.beginPath(); g.moveTo(-r, -r*0.08); g.lineTo(r, -r*0.08); g.stroke();
    g.beginPath(); g.moveTo(-r, r*0.42); g.lineTo(r, r*0.42); g.stroke();
    g.restore();

    // 6) fins / accent plates on top of the hull
    if (b.fins) {
      for (const f of b.fins) {
        shipPart(g, f, r, tint(sh.g1, 1.3), tint(sh.g2, 0.7), 0.3);
        shipRim(g, f, r, sh.g1);
      }
    }

    // 7) neon accent stripes
    g.save();
    g.globalCompositeOperation = "lighter";
    g.strokeStyle = sh.g1;
    g.lineWidth = Math.max(1, r*0.06);
    g.lineCap = "round";
    for (const seg of b.stripes) {
      g.beginPath();
      g.moveTo(seg[0][0]*r, seg[0][1]*r);
      g.lineTo(seg[1][0]*r, seg[1][1]*r);
      g.stroke();
    }
    g.restore();

    // 8) cockpit canopy
    drawCockpit(g, b.cockpit, r, sh);

    // 9) wingtip navigation lights
    if (b.lights) {
      g.save();
      g.globalCompositeOperation = "lighter";
      for (const l of b.lights) {
        const x = l[0]*r, y = l[1]*r;
        const lg = g.createRadialGradient(x, y, 0, x, y, r*0.22);
        lg.addColorStop(0, "rgba(255,255,255,0.95)");
        lg.addColorStop(0.4, sh.g1);
        lg.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = lg;
        g.beginPath(); g.arc(x, y, r*0.22, 0, TAU); g.fill();
      }
      g.restore();
    }

    // 10) crisp hull rim + neon edge on top
    shipRim(g, b.hull, r, sh.g1);

    g.globalAlpha = 1;
  }

  // --- enemy rendering helpers ------------------------------------------
  const _rgbaCache = new Map();
  function rgbaParse(str) {
    if (_rgbaCache.has(str)) return _rgbaCache.get(str);
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(str);
    const o = m ? { r: +m[1], g: +m[2], b: +m[3] } : { r: 255, g: 255, b: 255 };
    _rgbaCache.set(str, o);
    return o;
  }
  function rgba(r, g, b, a) { return "rgba(" + (r | 0) + "," + (g | 0) + "," + (b | 0) + "," + a + ")"; }
  function eColors(e) {
    const c = rgbaParse(e.color);
    return {
      base: e.color,
      light: rgba(Math.min(255, c.r + 95), Math.min(255, c.g + 95), Math.min(255, c.b + 95), 1),
      dark: rgba(c.r * 0.4, c.g * 0.4, c.b * 0.4, 1),
    };
  }
  function bodyGrad(r, light, base) {
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.12, 0, 0, r * 1.1);
    g.addColorStop(0, light);
    g.addColorStop(0.62, base);
    g.addColorStop(1, base);
    return g;
  }
  function diamondPath(r) {
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0); ctx.closePath();
  }
  function hexPath(r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (TAU * i) / 6 + Math.PI / 6;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  function starPath(ro, ri, points) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const a = (TAU * i) / (points * 2) - Math.PI / 2;
      const rr = i % 2 === 0 ? ro : ri;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function drawEnemies() {
    // outer aura glow pass (behind bodies)
    for (const e of enemies) drawGlow(e.x, e.y, e.r * 2.1, e.glow, e.boss ? 0.95 : 0.7);

    for (const e of enemies) {
      const flash = e.hitFlash > 0;
      ctx.save();
      ctx.translate(e.x, e.y);
      // squash-and-stretch pop while frozen in hit-stop
      if (e.hitStop > 0 && !e.boss) {
        const pop = 1 + Math.min(0.18, e.hitStop * 2.6);
        ctx.scale(pop, 1 / pop * 1.02);
      }
      if (e.boss) {
        drawBoss(e, flash);
      } else {
        switch (e.type) {
          case "rusher": drawRusher(e, flash); break;
          case "tank": drawTank(e, flash); break;
          case "orbiter": drawOrbiterEnemy(e, flash); break;
          case "splitter": drawSplitter(e, flash); break;
          case "charger": drawCharger(e, flash); break;
          default: drawDrifter(e, flash); break;
        }
      }
      ctx.restore();

      // frost overlay on cryo-frozen enemies
      if (e.frost > 0 || (e.slowT > 0 && e.slowMul && e.slowMul <= 0.3)) {
        const fa = clamp((e.frost || 0) * 1.4 + (e.slowT > 0 ? 0.35 : 0), 0, 0.7);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        drawGlow(e.x, e.y, e.r * 1.6, "rgba(150,220,255,0.5)", fa * 0.7);
        ctx.strokeStyle = "rgba(200,240,255," + (fa * 0.8).toFixed(2) + ")";
        ctx.lineWidth = 1.6;
        // little crystalline spikes
        for (let i = 0; i < 6; i++) {
          const a = e.phase * 0.2 + (TAU * i) / 6;
          const x0 = e.x + Math.cos(a) * e.r * 0.9, y0 = e.y + Math.sin(a) * e.r * 0.9;
          const x1 = e.x + Math.cos(a) * e.r * 1.35, y1 = e.y + Math.sin(a) * e.r * 1.35;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        }
        ctx.restore();
      }

      if (e.boss) {
        const w = e.r * 2.4, h = 7;
        const p = clamp(e.hp / e.maxHp, 0, 1);
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(e.x - w / 2, e.y - e.r - 20, w, h);
        ctx.fillStyle = "#ff3ea5";
        ctx.fillRect(e.x - w / 2, e.y - e.r - 20, w * p, h);
        ctx.strokeStyle = "rgba(255,120,210,0.7)";
        ctx.lineWidth = 1;
        ctx.strokeRect(e.x - w / 2, e.y - e.r - 20, w, h);
      }
    }
  }

  function drawDrifter(e, flash) {
    const c = eColors(e), r = e.r;
    ctx.rotate(e.phase * 0.25);
    diamondPath(r);
    ctx.fillStyle = flash ? "#ffffff" : bodyGrad(r, c.light, c.base);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // facet lines
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1;
    ctx.stroke();
    drawGlow(0, 0, r * 0.7, c.base, 0.7);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0, TAU); ctx.fill();
  }

  function drawRusher(e, flash) {
    const c = eColors(e), r = e.r;
    ctx.rotate(e.angle + Math.PI / 2); // point toward travel
    drawGlow(0, r * 1.05, r * 0.95, c.base, 0.75); // engine wake
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.55);
    ctx.lineTo(r * 0.95, r * 0.9);
    ctx.lineTo(0, r * 0.4);
    ctx.lineTo(-r * 0.95, r * 0.9);
    ctx.closePath();
    ctx.fillStyle = flash ? "#ffffff" : bodyGrad(r, c.light, c.base);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    drawGlow(0, -r * 1.15, r * 0.5, "rgba(255,255,255,0.9)", 0.8); // hot tip
  }

  function drawCharger(e, flash) {
    const c = eColors(e), r = e.r;
    // windup telegraph: a dashed warning beam toward the player
    if (e.chargeState === "wind") {
      const a = Math.atan2(player.y - e.y, player.x - e.x);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.rotate(a);
      const warn = 0.4 + 0.6 * Math.abs(Math.sin(game.time * 18));
      ctx.strokeStyle = "rgba(255,110,120," + (0.55 * warn).toFixed(2) + ")";
      ctx.lineWidth = 3; ctx.setLineDash([11, 8]);
      ctx.beginPath(); ctx.moveTo(r * 1.2, 0); ctx.lineTo(r * 1.2 + 230, 0); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    ctx.rotate(e.angle + Math.PI / 2);
    if (e.chargeState === "dash") drawGlow(0, r * 1.4, r * 1.15, c.base, 0.9); // streak wake
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.55);
    ctx.lineTo(r * 0.5, -r * 0.2);
    ctx.lineTo(r * 1.15, r * 0.22);
    ctx.lineTo(r * 0.46, r * 0.36);
    ctx.lineTo(r * 0.72, r * 1.0);
    ctx.lineTo(0, r * 0.55);
    ctx.lineTo(-r * 0.72, r * 1.0);
    ctx.lineTo(-r * 0.46, r * 0.36);
    ctx.lineTo(-r * 1.15, r * 0.22);
    ctx.lineTo(-r * 0.5, -r * 0.2);
    ctx.closePath();
    ctx.fillStyle = flash ? "#ffffff" : bodyGrad(r, c.light, c.base);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1.4; ctx.stroke();
    // charged core pulses brighter during windup
    const coreA = e.chargeState === "wind" ? 0.6 + 0.4 * Math.abs(Math.sin(game.time * 18)) : 0.8;
    drawGlow(0, -r * 0.9, r * 0.5, "rgba(255,255,255," + coreA.toFixed(2) + ")", 0.9);
  }

  function drawTank(e, flash) {
    const c = eColors(e), r = e.r;
    ctx.rotate(e.phase * 0.12);
    hexPath(r);
    ctx.fillStyle = flash ? "#ffffff" : bodyGrad(r, c.light, c.dark);
    ctx.fill();
    ctx.strokeStyle = c.light;
    ctx.lineWidth = 3;
    ctx.stroke();
    hexPath(r * 0.6);
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 2;
    ctx.stroke();
    // rivets on outer vertices
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (let i = 0; i < 6; i++) {
      const a = (TAU * i) / 6 + Math.PI / 6;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78, 2.2, 0, TAU);
      ctx.fill();
    }
    drawGlow(0, 0, r * 0.55, c.base, 0.7);
    ctx.fillStyle = "rgba(255,235,235,0.9)";
    ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0, TAU); ctx.fill();
  }

  function drawOrbiterEnemy(e, flash) {
    const c = eColors(e), r = e.r;
    ctx.save();
    ctx.rotate(e.phase * 0.9);
    starPath(r, r * 0.44, 5);
    ctx.fillStyle = flash ? "#ffffff" : bodyGrad(r, c.light, c.base);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.restore();
    const pr = r * (0.28 + 0.1 * Math.sin(game.time * 8 + e.phase));
    drawGlow(0, 0, r * 0.7, c.base, 0.8);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath(); ctx.arc(0, 0, pr, 0, TAU); ctx.fill();
    // orbiting satellites
    for (let i = 0; i < 3; i++) {
      const a = -e.phase * 1.4 + (TAU * i) / 3;
      const sxp = Math.cos(a) * r * 1.15, syp = Math.sin(a) * r * 1.15;
      drawGlow(sxp, syp, 4.5, c.light, 0.9);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(sxp, syp, 1.8, 0, TAU); ctx.fill();
    }
  }

  function drawSplitter(e, flash) {
    const c = eColors(e);
    const r = e.r * (1 + 0.06 * Math.sin(game.time * 7 + e.phase));
    ctx.rotate(e.phase * 0.2);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = flash ? "#ffffff" : bodyGrad(r, c.light, c.base);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // dividing seam (looks ready to split)
    ctx.strokeStyle = "rgba(15,15,25,0.55)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(r * 0.3, 0, 0, r);
    ctx.stroke();
    // two nuclei
    drawGlow(-r * 0.36, 0, r * 0.42, c.base, 0.85);
    drawGlow(r * 0.36, 0, r * 0.42, c.base, 0.85);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath(); ctx.arc(-r * 0.36, 0, r * 0.16, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.36, 0, r * 0.16, 0, TAU); ctx.fill();
  }

  function drawBoss(e, flash) {
    switch (e.bossKind) {
      case "hive": drawBossHive(e, flash); break;
      case "lancer": drawBossLancer(e, flash); break;
      case "sentry": drawBossSentry(e, flash); break;
      case "vortex": drawBossVortex(e, flash); break;
      case "spectre": drawBossSpectre(e, flash); break;
      case "monolith": drawBossMonolith(e, flash); break;
      case "reaver": drawBossReaver(e, flash); break;
      case "warlock": drawBossWarlock(e, flash); break;
      case "prism": drawBossPrism(e, flash); break;
      default: drawBossDread(e, flash); break;
    }
  }

  // SPECTRE — phasing wraith; fades while charging a blink
  function drawBossSpectre(e, flash) {
    const c = eColors(e), r = e.r;
    const phasing = e.teleT > 0;
    ctx.save();
    ctx.globalAlpha = phasing ? 0.35 + 0.3 * Math.sin(game.time * 20) : 1;
    // wavy cloak
    ctx.rotate(Math.sin(game.time * 1.5) * 0.15);
    ctx.beginPath();
    for (let i = 0; i <= 20; i++) {
      const a = (TAU * i) / 20;
      const wob = 1 + 0.14 * Math.sin(a * 4 + game.time * 4);
      const rr = (i > 12 ? r * 1.25 : r) * wob;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr * (i > 12 ? 1.25 : 1);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = flash ? "#ffffff" : bodyGrad(r, c.light, c.base);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 2; ctx.stroke();
    // hollow eyes
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(4,10,10,0.9)";
    for (const sx of [-0.32, 0.32]) { ctx.beginPath(); ctx.ellipse(sx * r, -r * 0.15, r * 0.14, r * 0.22, 0, 0, TAU); ctx.fill(); }
    ctx.globalCompositeOperation = "lighter";
    for (const sx of [-0.32, 0.32]) drawGlow(sx * r, -r * 0.15, r * 0.16, c.base, 0.9);
    ctx.restore();
    bossCore(c, r);
  }

  // MONOLITH — slow armored slab that emits ring walls
  function drawBossMonolith(e, flash) {
    const c = eColors(e), r = e.r;
    ctx.save();
    ctx.rotate(e.phase * 0.06);
    // charge-up glow before a ring wall
    const chg = clamp(1 - e.aTimer / 3.0, 0, 1);
    for (let ring = 0; ring < 2; ring++) {
      const rr = r * (0.7 + ring * 0.32);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = (TAU * i) / 6 + ring * 0.5; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.closePath();
      ctx.fillStyle = flash ? "#ffffff" : (ring === 0 ? bodyGrad(r, c.light, c.dark) : "rgba(20,30,60,0.5)");
      if (ring === 0) ctx.fill();
      ctx.strokeStyle = c.light; ctx.lineWidth = ring === 0 ? 3 : 2; ctx.stroke();
    }
    ctx.restore();
    // pulsing charge ring
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = c.base; ctx.lineWidth = 2 + chg * 3;
    ctx.globalAlpha = 0.3 + chg * 0.6;
    ctx.beginPath(); ctx.arc(0, 0, r * (1.2 + chg * 0.3), 0, TAU); ctx.stroke();
    ctx.restore();
    bossCore(c, r);
  }

  // REAVER — twin-bladed berserker, leaves afterimages while dashing
  function drawBossReaver(e, flash) {
    const c = eColors(e), r = e.r;
    ctx.rotate(e.angle + Math.PI / 2);
    const winding = e.teleT > 0;
    if (winding) { const w = 0.5 + 0.5 * Math.abs(Math.sin(game.time * 20)); drawGlow(0, 0, r * 1.6, c.base, 0.5 * w); }
    // central body
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.3); ctx.lineTo(r * 0.5, 0); ctx.lineTo(0, r * 1.1); ctx.lineTo(-r * 0.5, 0); ctx.closePath();
    ctx.fillStyle = flash ? "#ffffff" : bodyGrad(r, c.light, c.base);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2; ctx.stroke();
    // twin curved blades
    ctx.strokeStyle = c.light; ctx.lineWidth = 3; ctx.lineCap = "round";
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.4, -r * 0.2);
      ctx.quadraticCurveTo(s * r * 1.5, -r * 0.4, s * r * 1.3, r * 0.9);
      ctx.stroke();
    }
    bossCore(c, r);
  }

  // WARLOCK — hovering caster ringed by orbiting runes
  function drawBossWarlock(e, flash) {
    const c = eColors(e), r = e.r;
    // orbiting runes
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 5; i++) {
      const a = game.time * 1.2 + (TAU * i) / 5;
      const x = Math.cos(a) * r * 1.35, y = Math.sin(a) * r * 1.35;
      drawGlow(x, y, r * 0.24, c.base, 0.9);
      ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(x, y, r * 0.09, 0, TAU); ctx.fill();
    }
    ctx.restore();
    // body: pointed mantle
    ctx.save();
    ctx.rotate(Math.sin(game.time) * 0.1);
    starPath(r, r * 0.55, 6);
    ctx.fillStyle = flash ? "#ffffff" : bodyGrad(r, c.light, c.base);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
    bossCore(c, r);
  }

  // PRISM — faceted crystal that charges wide volleys
  function drawBossPrism(e, flash) {
    const c = eColors(e), r = e.r;
    const charging = e.teleT > 0;
    if (charging) {
      // telegraph aim toward the player
      const a = Math.atan2(player.y - e.y, player.x - e.x);
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.rotate(a);
      const w = 0.4 + 0.6 * Math.abs(Math.sin(game.time * 16));
      ctx.strokeStyle = "rgba(255,170,225," + (0.5 * w).toFixed(2) + ")"; ctx.lineWidth = 4; ctx.setLineDash([12, 9]);
      ctx.beginPath(); ctx.moveTo(r * 1.2, 0); ctx.lineTo(r * 1.2 + 280, 0); ctx.stroke();
      ctx.setLineDash([]); ctx.restore();
    }
    ctx.save();
    ctx.rotate(e.phase * 0.2);
    // crystal facets
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.5, c.base); g.addColorStop(1, c.dark);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = (TAU * i) / 8; const rr = i % 2 === 0 ? r * 1.2 : r * 0.8; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath();
    ctx.fillStyle = flash ? "#ffffff" : g;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.75)"; ctx.lineWidth = 2; ctx.stroke();
    // inner facet lines
    ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) { const a = (TAU * i) / 4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1); ctx.stroke(); }
    ctx.restore();
    bossCore(c, r);
  }

  // VORTEX — spinning spiral emitter, indigo
  function drawBossVortex(e, flash) {
    const c = eColors(e), r = e.r;
    const spin = game.time * 1.6;
    // outer rotating spiral arms
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.rotate(spin);
    ctx.strokeStyle = c.base; ctx.lineWidth = 3; ctx.lineCap = "round";
    for (let arm = 0; arm < 3; arm++) {
      ctx.rotate(TAU / 3);
      ctx.beginPath();
      for (let i = 0; i < 18; i++) {
        const t = i / 17;
        const rad = r * 0.5 + t * r * 0.95;
        const a = t * 2.4;
        const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
    // body disc
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, r * 0.62);
    g.addColorStop(0, "#efecff"); g.addColorStop(0.55, c.base); g.addColorStop(1, "rgba(38,28,86,1)");
    ctx.fillStyle = flash ? "#ffffff" : g;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2; ctx.stroke();
    // counter-rotating inner spokes
    ctx.save();
    ctx.rotate(-spin * 1.8);
    ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) { ctx.rotate(TAU / 6); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r * 0.55); ctx.stroke(); }
    ctx.restore();
    bossCore(c, r);
  }

  function bossCore(c, r) {
    const pr = r * (0.32 + 0.08 * Math.sin(game.time * 6));
    drawGlow(0, 0, r * 0.9, c.base, 0.9);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath(); ctx.arc(0, 0, pr, 0, TAU); ctx.fill();
  }

  // DREADNOUGHT — layered spiked hull, plain heavy chaser
  function drawBossDread(e, flash) {
    const c = eColors(e), r = e.r;
    ctx.save();
    ctx.rotate(e.phase * 0.3);
    const spikes = 12;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = (TAU * i) / (spikes * 2);
      const rr = i % 2 === 0 ? r * 1.3 : r * 0.98;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = flash ? "#ffffff" : c.dark;
    ctx.fill();
    ctx.strokeStyle = c.light; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.rotate(-e.phase * 0.5);
    hexPath(r * 0.82);
    ctx.fillStyle = flash ? "#ffffff" : bodyGrad(r, c.light, c.base);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = c.light; ctx.lineWidth = 2;
    ctx.setLineDash([9, 9]); ctx.lineDashOffset = -game.time * 34;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.05, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    bossCore(c, r);
  }

  // HIVE CORE — rounded shell with orbiting spawn-nodes
  function drawBossHive(e, flash) {
    const c = eColors(e), r = e.r;
    ctx.save();
    ctx.rotate(e.phase * 0.25);
    hexPath(r * 0.9);
    ctx.fillStyle = flash ? "#ffffff" : bodyGrad(r, c.light, c.base);
    ctx.fill();
    ctx.strokeStyle = c.light; ctx.lineWidth = 2.5; ctx.stroke();
    hexPath(r * 0.55);
    ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
    // orbiting nodes (the minions it births)
    const near = e.aTimer < 0.7; // glow brighter just before spawning
    for (let i = 0; i < 6; i++) {
      const a = e.phase * 0.8 + (TAU * i) / 6;
      const nx = Math.cos(a) * r * 1.18, ny = Math.sin(a) * r * 1.18;
      drawGlow(nx, ny, near ? 9 : 6, c.light, 0.9);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(nx, ny, near ? 3.2 : 2.4, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = c.glow; ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 8]); ctx.lineDashOffset = game.time * 24;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.18, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    bossCore(c, r);
  }

  // LANCER — bladed dart that points at the player; flares white while winding up
  function drawBossLancer(e, flash) {
    const c = eColors(e), r = e.r;
    const charging = e.teleT > 0;
    const dashing = e.dashT > 0;
    ctx.save();
    ctx.rotate(e.angle + Math.PI / 2);
    drawGlow(0, r * 1.2, r * (dashing ? 1.4 : 0.95), c.base, 0.8); // engine wake
    // main blade
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.75);
    ctx.lineTo(r * 0.8, r * 0.85);
    ctx.lineTo(0, r * 0.3);
    ctx.lineTo(-r * 0.8, r * 0.85);
    ctx.closePath();
    ctx.fillStyle = (flash || charging) ? "#ffffff" : bodyGrad(r, c.light, c.base);
    ctx.fill();
    ctx.strokeStyle = c.light; ctx.lineWidth = 2.5; ctx.stroke();
    // side wings
    ctx.fillStyle = c.dark;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * r * 0.5, r * 0.1);
      ctx.lineTo(s * r * 1.25, r * 0.7);
      ctx.lineTo(s * r * 0.45, r * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = c.light; ctx.lineWidth = 1.5; ctx.stroke();
    }
    drawGlow(0, -r * 1.35, r * (charging ? 0.9 : 0.5), "rgba(255,255,255,0.95)", 0.9); // hot tip
    ctx.restore();
    bossCore(c, r);
  }

  // SENTRY — a great eye that keeps its distance and fires bullet rings
  function drawBossSentry(e, flash) {
    const c = eColors(e), r = e.r;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = flash ? "#ffffff" : bodyGrad(r, c.light, c.dark);
    ctx.fill();
    ctx.strokeStyle = c.light; ctx.lineWidth = 2.5; ctx.stroke();
    // rotating dashed shell
    ctx.strokeStyle = c.glow; ctx.lineWidth = 2;
    ctx.setLineDash([10, 9]); ctx.lineDashOffset = -game.time * 40;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.96, 0, TAU); ctx.stroke();
    ctx.setLineDash([]);
    // iris + pupil that tracks the player
    const px = Math.cos(e.angle) * r * 0.32, py = Math.sin(e.angle) * r * 0.32;
    ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.58, 0, TAU); ctx.stroke();
    const charging = e.aTimer < 0.5;
    drawGlow(px, py, r * (charging ? 0.75 : 0.5), c.base, 0.95);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath(); ctx.arc(px, py, r * 0.22, 0, TAU); ctx.fill();
  }

  function drawEnemyBullets() {
    if (!enemyBullets.length) return;
    ctx.globalCompositeOperation = "lighter";
    for (const b of enemyBullets) {
      drawGlow(b.x, b.y, b.r * 2.6, b.glow, 0.9);
      ctx.fillStyle = "#fff2f2";
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.6, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function drawBullets() {
    ctx.globalCompositeOperation = "lighter";
    for (const b of bullets) {
      // trail: soft colored glow with a hot white core
      if (b.trail.length > 1) {
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(b.trail[0].x, b.trail[0].y);
        for (let i = 1; i < b.trail.length; i++) ctx.lineTo(b.trail[i].x, b.trail[i].y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = b.glow;
        ctx.lineWidth = b.r * (b.long ? 2.4 : 1.7);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = b.r * (b.long ? 0.9 : 0.6);
        ctx.stroke();
      }
      drawGlow(b.x, b.y, b.r * 3, b.glow, 0.9);
      if (b.boomerang !== undefined) {
        // spinning three-blade glaive
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.spin || 0);
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2.4; ctx.lineCap = "round";
        for (let k = 0; k < 3; k++) {
          ctx.rotate(TAU / 3);
          ctx.beginPath(); ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(b.r * 0.7, -b.r * 0.4, b.r * 1.5, 0);
          ctx.stroke();
        }
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(0, 0, b.r * 0.4, 0, TAU); ctx.fill();
        ctx.restore();
      } else if (b.explodeR) {
        // missile dart pointing along travel
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(Math.atan2(b.vy, b.vx) + Math.PI / 2);
        ctx.fillStyle = b.crit ? "#fff7d6" : "#fff2e6";
        ctx.beginPath();
        ctx.moveTo(0, -b.r * 1.5); ctx.lineTo(b.r * 0.7, b.r * 0.9);
        ctx.lineTo(0, b.r * 0.4); ctx.lineTo(-b.r * 0.7, b.r * 0.9);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = b.crit ? "#fff7d6" : "#ffffff";
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * 0.7, 0, TAU);
        ctx.fill();
      }
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

  function drawAura() {
    if (weaponLv("aura") === 0) return;
    const s = auraStats();
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 6);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // soft filled field
    const grd = ctx.createRadialGradient(player.x, player.y, s.radius * 0.2, player.x, player.y, s.radius);
    grd.addColorStop(0, "rgba(255,120,210,0)");
    grd.addColorStop(0.75, "rgba(255,120,210,0.06)");
    grd.addColorStop(1, "rgba(255,120,210," + (0.16 + pulse * 0.12) + ")");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(player.x, player.y, s.radius, 0, TAU);
    ctx.fill();
    // rotating edge ring with dashes
    ctx.strokeStyle = "rgba(255,120,210," + (0.4 + pulse * 0.3) + ")";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = -game.time * 40;
    ctx.beginPath();
    ctx.arc(player.x, player.y, s.radius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawGravityField() {
    if (weaponLv("gravity") === 0) return;
    const s = gravityStats();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const grd = ctx.createRadialGradient(player.x, player.y, s.radius * 0.15, player.x, player.y, s.radius);
    grd.addColorStop(0, "rgba(80,255,170,0.14)");
    grd.addColorStop(0.7, "rgba(80,255,170,0.05)");
    grd.addColorStop(1, "rgba(80,255,170,0)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(player.x, player.y, s.radius, 0, TAU);
    ctx.fill();
    // inward-spiralling rings
    for (let i = 0; i < 3; i++) {
      const t = ((game.time * 0.4 + i / 3) % 1);
      const rr = s.radius * (1 - t);
      ctx.strokeStyle = "rgba(120,255,200," + (0.35 * t) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, rr, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawVaporTrail() {
    if (!player.vaporTrail.length) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const v of player.vaporTrail) {
      const a = clamp(v.life, 0, 1);
      drawGlow(v.x, v.y, v.r * a, "rgba(255,120,180,0.5)", a * 0.6);
    }
    ctx.restore();
  }

  function drawLightnings() {
    if (!lightnings.length) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const ln of lightnings) {
      const a = clamp(ln.life, 0, 1);
      // jagged path between the two points
      const dx = ln.x2 - ln.x1, dy = ln.y2 - ln.y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      const segs = Math.max(3, Math.floor(len / 26));
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const jitter = i === 0 || i === segs ? 0 : (Math.random() - 0.5) * 16 * a;
        pts.push([ln.x1 + dx * t + nx * jitter, ln.y1 + dy * t + ny * jitter]);
      }
      // outer glow stroke
      ctx.strokeStyle = ln.color;
      ctx.lineWidth = 6 * a;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
      // bright core
      ctx.strokeStyle = "rgba(240,252,255," + a + ")";
      ctx.lineWidth = 2 * a + 0.6;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSlashes() {
    if (!slashes.length) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const s of slashes) {
      const a = clamp(s.life, 0, 1);
      const r = s.reach * (1.05 - a * 0.15); // sweep outward slightly as it fades
      const a0 = s.dir - s.arc / 2, a1 = s.dir + s.arc / 2;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 7 * a;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, a0, a1); ctx.stroke();
      ctx.strokeStyle = "rgba(255,245,252," + (a * 0.9) + ")";
      ctx.lineWidth = 2.4 * a + 0.5;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, a0, a1); ctx.stroke();
    }
    ctx.restore();
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

  // A distinct vector mark per power-up (no emoji), drawn centred at (0,0).
  function drawPowerSymbol(type, s, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (type === "overdrive") {
      for (const oy of [-s * 0.15, s * 0.4]) {
        ctx.beginPath(); ctx.moveTo(-s * 0.6, oy + s * 0.25); ctx.lineTo(0, oy - s * 0.3); ctx.lineTo(s * 0.6, oy + s * 0.25); ctx.stroke();
      }
    } else if (type === "surge") {
      for (const bx of [-s * 0.5, 0, s * 0.5]) { ctx.beginPath(); ctx.moveTo(bx, -s * 0.55); ctx.lineTo(bx, s * 0.55); ctx.stroke(); }
    } else if (type === "magnet") {
      ctx.beginPath();
      ctx.moveTo(-s * 0.45, -s * 0.5); ctx.lineTo(-s * 0.45, s * 0.05);
      ctx.quadraticCurveTo(-s * 0.45, s * 0.58, 0, s * 0.58);
      ctx.quadraticCurveTo(s * 0.45, s * 0.58, s * 0.45, s * 0.05);
      ctx.lineTo(s * 0.45, -s * 0.5); ctx.stroke();
    } else if (type === "aegis") {
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.62); ctx.lineTo(s * 0.55, -s * 0.28); ctx.lineTo(s * 0.55, s * 0.16);
      ctx.quadraticCurveTo(s * 0.4, s * 0.6, 0, s * 0.72);
      ctx.quadraticCurveTo(-s * 0.4, s * 0.6, -s * 0.55, s * 0.16);
      ctx.lineTo(-s * 0.55, -s * 0.28); ctx.closePath(); ctx.stroke();
    } else if (type === "repair") {
      ctx.beginPath(); ctx.moveTo(0, -s * 0.6); ctx.lineTo(0, s * 0.6); ctx.moveTo(-s * 0.6, 0); ctx.lineTo(s * 0.6, 0); ctx.stroke();
    }
  }

  function drawPowerups() {
    for (const p of powerups) {
      const pu = POWERUPS[p.type]; if (!pu) continue;
      const pulse = 0.78 + 0.22 * Math.sin(p.phase * 1.6);
      const blink = p.life < 4 ? (0.45 + 0.55 * Math.abs(Math.sin(p.life * 6))) : 1;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      drawGlow(p.x, p.y, p.r * 2.3 * pulse, pu.glow, 0.85 * blink);
      ctx.restore();
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = blink;
      // rotating hex ring
      ctx.rotate(p.phase * 0.5);
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = pu.color; ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; const rr = p.r * 1.15 * pulse; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.closePath(); ctx.stroke();
      ctx.rotate(-p.phase * 0.5);
      // dark inner disc
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(6,10,20,0.82)";
      ctx.beginPath(); ctx.arc(0, 0, p.r * 0.8, 0, TAU); ctx.fill();
      // symbol
      ctx.globalCompositeOperation = "lighter";
      drawPowerSymbol(p.type, p.r * 0.55, pu.color);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
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
    // dash cooldown indicator
    if (dashBtn) {
      const cd = player.dashCd > 0 ? player.dashCd / DASH_CD : 0;
      if (dashCdEl) dashCdEl.style.transform = "scaleY(" + cd + ")";
      dashBtn.classList.toggle("cooling", cd > 0);
      dashBtn.classList.toggle("ready", cd === 0);
    }
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
    el("costume-screen").classList.toggle("hidden", s !== "costume");
    hud.classList.toggle("hidden", s === "menu" || s === "costume");
  }

  function resetRun() {
    enemies = []; bullets = []; gems = []; particles = []; powerups = []; sparks = []; debris = []; booms = []; smoke = [];
    floaters = []; shockwaves = []; orbiters = []; lightnings = []; slashes = []; enemyBullets = [];
    game.time = 0; game.kills = 0; game.bossKills = 0; game._committed = false; game.freeze = 0; game.slow = 0; game.expFlash = 0; game.shake = 0; game.hitFlash = 0;
    game.spawnTimer = 0; game.nextWaveAt = 30; game.waveCount = 0; game.bossIndex = 0;
    wt.pulse = 0; wt.nova = 0; wt.spread = 0; wt.beam = 0;
    wt.chain = 0; wt.homing = 0; wt.aura = 0;
    wt.gravity = 0; wt.storm = 0; wt.deadeye = 0; wt.staticfield = 0;
    wt.missile = 0; wt.boomerang = 0;
    orbitAngle = 0;

    player.x = WORLD.w / 2; player.y = WORLD.h / 2;
    player.speed = 240; player.maxHp = diff.startHp; player.hp = diff.startHp;
    player.level = 1; player.xp = 0; player.xpNext = 4;
    player.pickupRange = 120; player.invuln = 0; player.facing = -Math.PI / 2;
    player.dashTime = 0; player.dashCd = 0; player.dashDX = 0; player.dashDY = -1; player.dashHit = null;
    player.buffs = []; player.score = 0; player.combo = 0; player.comboTimer = 0;
    player.comboEdge = 0; player.luck = 0;
    player.damageMul = 1; player.fireRateMul = 1; player.projectiles = 1;
    player.critChance = 0.05; player.critMul = 2; player.xpMul = diff.xpMul;
    player.rangeMul = 1; player.projSpeedMul = 1; player.aoeMul = 1;
    player.armor = 0; player.lifestealChance = 0; player.lifestealHeal = 6;
    player.projectileSize = 1; player.revives = 0;
    player.berserk = false; player.thorns = 0;
    player.shieldMax = 0; player.shield = 0; player.shieldTimer = 0;
    player.counter = 0; player.executePct = 0; player.critblast = 0; player.coldblood = 0;
    player.stillTime = 0; player.voidburst = 0; player.bloodhitChance = 0; player.vapor = 0;
    player.cryo = 0; player.ricochet = 0; player.overload = 0; player.overStacks = 0; player.overTimer = 0;
    player.pierceBonus = 0; player.bossDmg = 0; player.regen = 0; player.bulwark = 0;
    player.swarm = 0; player.crowdBonus = 0; player.adrenaline = 0; player.adrenTimer = 0;
    player.harvest = 0; player.momentum = 0;
    player.vaporTrail = [];
    // open with a reliable rapid ranged weapon so the early game is viable;
    // fall back to any ranged, then any weapon.
    const PREFERRED = ["pulse", "spread", "beam", "chain", "homing", "fork", "frost", "seeker"];
    const RANGED = PREFERRED.concat(["storm", "staticfield", "deadeye", "flak", "plasmaorb", "cluster"]);
    const startWeapon = costume.skills.find((id) => PREFERRED.indexOf(id) >= 0)
      || costume.skills.find((id) => RANGED.indexOf(id) >= 0)
      || costume.skills.find((id) => WEAPONS[id]) || "pulse";
    player.weapons = {}; player.weapons[startWeapon] = 1;
    player.passives = {};
    player.trail = [];
    buildStars();
  }

  function startRun() {
    audio();
    diff = DIFFICULTIES[difficulty];
    costume = COSTUMES[costumeKey] || COSTUMES.vanguard;
    ship = costume.ship;
    game.best = game.bests[difficulty] || 0;
    modeEl.textContent = diff.hud;
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
    if (isBest) {
      game.best = game.time;
      game.bests[difficulty] = game.time;
      saveBest();
    }
    const prevBestScore = progress.bestScore || 0;
    const isScoreBest = player.score > prevBestScore;
    el("final-time").textContent = fmtTime(game.time);
    el("final-level").textContent = player.level;
    el("final-kills").textContent = game.kills;
    el("final-best").textContent = fmtTime(game.best);
    el("final-score").textContent = player.score.toLocaleString("en-US");
    el("final-bestscore").textContent = Math.max(prevBestScore, player.score).toLocaleString("en-US");
    el("newbest-badge").classList.toggle("hidden", !isBest);
    const sl = document.querySelector(".score-line");
    if (sl) sl.classList.toggle("newscore", isScoreBest);
    commitProgress();
    updateScoreLabel();
  }

  // Reflect the saved lifetime best score onto the start screen.
  function updateScoreLabel() {
    try {
      const e = el("start-bestscore");
      if (e) e.textContent = (progress.bestScore || 0).toLocaleString("en-US");
    } catch (_) {}
  }

  function loadBest() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        game.bests.easy = +o.easy || 0;
        game.bests.normal = +o.normal || 0;
        game.bests.hard = +o.hard || 0;
        game.bests.inferno = +o.inferno || 0;
      }
    } catch (e) { /* keep zeros */ }
    game.best = game.bests[difficulty] || 0;
    updateBestLabels();
  }
  function saveBest() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(game.bests)); } catch (e) {}
    updateBestLabels();
  }
  function updateBestLabels() {
    el("start-best").textContent = fmtTime(game.bests[difficulty] || 0);
    bestEl.textContent = fmtTime(game.best);
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
      // freeze frames: hold the whole scene still for a beat (boss-kill hit-stop)
      if (game.freeze > 0) {
        game.freeze -= dt;
      } else {
        // slow-motion on player hit: ease the world time scale back up to 1
        let ts = 1;
        if (game.slow > 0) {
          game.slow = Math.max(0, game.slow - dt);
          ts = 1 - clamp(game.slow / 0.26, 0, 1) * 0.66; // ~0.34x at peak
        }
        const wdt = dt * ts;
        game.time += wdt;
        updatePlayer(wdt);
        fireWeapons(wdt);
        updateOrbiters(wdt);
        updateBullets(wdt);
        updateEnemies(wdt);
        updateEnemyBullets(wdt);
        updateGems(wdt);
        updatePowerups(wdt);
        updateSpawner(wdt);
        // combo decays if you stop killing
        if (player.comboTimer > 0) { player.comboTimer -= wdt; if (player.comboTimer <= 0) player.combo = 0; }
        updateEffects(wdt);
        updateHud();
      }
    } else {
      // keep effects alive on game over / menu for ambiance
      updateEffects(dt);
      if (game.state === "menu") game.time += 0; // frozen
    }

    // Always render the world (so menus show a live background if desired)
    if (game.state === "menu" || game.state === "costume") {
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
  el("home-btn").addEventListener("click", () => setState("menu"));
  el("resume-btn").addEventListener("click", () => setState("playing"));
  el("quit-btn").addEventListener("click", () => { commitProgress(); setState("menu"); });
  el("pause-btn").addEventListener("click", togglePause);

  // ---------------------------------------------------------------------
  //  Difficulty selection
  // ---------------------------------------------------------------------
  function setDifficulty(key) {
    if (!DIFFICULTIES[key]) key = "normal";
    difficulty = key;
    diff = DIFFICULTIES[key];
    game.best = game.bests[key] || 0;
    const btns = document.querySelectorAll(".diff-btn");
    btns.forEach((b) => b.classList.toggle("active", b.dataset.diff === key));
    el("diff-desc").textContent = diff.desc;
    updateBestLabels();
    try { localStorage.setItem(DIFF_KEY, key); } catch (e) {}
  }
  document.querySelectorAll(".diff-btn").forEach((b) => {
    b.addEventListener("click", () => setDifficulty(b.dataset.diff));
  });
  function loadDifficulty() {
    let saved = "normal";
    try { saved = localStorage.getItem(DIFF_KEY) || "normal"; } catch (e) {}
    setDifficulty(saved);
  }

  // ---------------------------------------------------------------------
  //  Costume selection (dedicated page with previews + skill lists)
  // ---------------------------------------------------------------------
  const COSTUME_KEY = "starfall-arena-costume";

  // ---- persistent progress + costume unlocks ----
  const PROGRESS_KEY = "starfall-arena-progress";
  const progress = { kills: 0, bosses: 0, maxLevel: 1, bestScore: 0, bestTime: { easy: 0, normal: 0, hard: 0, inferno: 0 } };
  let unlockedSet = {};
  const LOCK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

  function loadProgress() {
    try {
      const o = JSON.parse(localStorage.getItem(PROGRESS_KEY));
      if (o) {
        progress.kills = +o.kills || 0;
        progress.bosses = +o.bosses || 0;
        progress.maxLevel = +o.maxLevel || 1;
        progress.bestScore = +o.bestScore || 0;
        if (o.bestTime) for (const k in progress.bestTime) progress.bestTime[k] = +o.bestTime[k] || 0;
      }
    } catch (e) {}
    refreshUnlocks();
  }
  function saveProgress() { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch (e) {} }
  function isUnlocked(key) { const c = COSTUMES[key]; return !c || !c.unlock || c.unlock.test(progress); }
  function refreshUnlocks() { for (const k in COSTUMES) unlockedSet[k] = isUnlocked(k); }

  // Fold a finished run into lifetime progress, then re-check unlocks.
  function commitProgress() {
    if (game._committed) return;
    game._committed = true;
    progress.kills += game.kills;
    progress.bosses += game.bossKills;
    progress.maxLevel = Math.max(progress.maxLevel, player.level);
    progress.bestScore = Math.max(progress.bestScore, player.score);
    progress.bestTime[difficulty] = Math.max(progress.bestTime[difficulty] || 0, game.time);
    saveProgress();
    const before = Object.assign({}, unlockedSet);
    refreshUnlocks();
    const newly = [];
    for (const k in unlockedSet) if (unlockedSet[k] && !before[k]) newly.push(COSTUMES[k].name);
    buildCostumeScreen();
    updateScoreLabel();
    if (newly.length) showUnlockToast(newly);
  }

  function showUnlockToast(names) {
    const t = document.createElement("div");
    t.className = "unlock-toast";
    t.innerHTML = '<span class="ut-label">新機体を解放</span>' + names.map((n) => '<b>' + n + '</b>').join("<span class='ut-sep'>/</span>");
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 500); }, 4600);
  }

  function renderCostumePreview(canvas, cos) {
    const S = 2;
    canvas.width = 96 * S; canvas.height = 96 * S;
    const g = canvas.getContext("2d");
    g.setTransform(S, 0, 0, S, 0, 0);
    g.clearRect(0, 0, 96, 96);
    g.save();
    g.translate(48, 50);
    // soft glow halo
    g.globalCompositeOperation = "lighter";
    const gg = g.createRadialGradient(0, 0, 0, 0, 0, 44);
    gg.addColorStop(0, cos.ship.glow);
    gg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gg;
    g.beginPath(); g.arc(0, 0, 44, 0, TAU); g.fill();
    g.globalCompositeOperation = "source-over";
    drawShipInto(g, 26, cos.ship, 1, null);
    g.restore();
  }

  function skillChip(id) {
    const info = skillInfo(id);
    if (!info) return "";
    const def = info.def;
    const rare = UNIVERSAL_SKILLS.indexOf(id) >= 0;
    const cls = "cos-skill " + (rare ? "rare" : (info.kind === "weapon" ? "wpn" : ""));
    return '<span class="' + cls + '" style="--sc:' + def.accent + '"><i>' + def.icon + '</i>' + def.name + '</span>';
  }

  function buildCostumeScreen() {
    const list = el("costume-list");
    list.innerHTML = "";
    for (const key in COSTUMES) {
      const c = COSTUMES[key];
      const locked = !unlockedSet[key];
      const card = document.createElement("div");
      card.className = "cos-card" + (locked ? " locked" : "");
      card.dataset.costume = key;
      card.style.setProperty("--cos-color", c.swatch);
      const canvas = document.createElement("canvas");
      const info = document.createElement("div");
      info.className = "cos-info";
      const chips = c.skills.map(skillChip).join("") + UNIVERSAL_SKILLS.map(skillChip).join("");
      const lockHtml = locked
        ? '<div class="cos-lock">' + LOCK_SVG + '<span>解放条件 — ' + c.unlock.desc + '</span></div>'
        : '';
      info.innerHTML =
        '<div class="cos-title"><span class="cos-name">' + c.name + '</span>' +
        '<span class="cos-role">' + c.label + '</span></div>' +
        '<div class="cos-desc">' + c.desc + '</div>' +
        lockHtml +
        '<div class="cos-skills">' + chips + '</div>';
      card.appendChild(canvas);
      card.appendChild(info);
      card.addEventListener("click", () => { if (unlockedSet[key]) setCostume(key); });
      list.appendChild(card);
      renderCostumePreview(canvas, c);
    }
  }

  function setCostume(key) {
    if (!COSTUMES[key] || !unlockedSet[key]) key = "vanguard";
    costumeKey = key;
    costume = COSTUMES[key];
    ship = costume.ship;
    const cur = el("current-costume");
    if (cur) cur.textContent = costume.name;
    document.querySelectorAll(".cos-card").forEach((c) => c.classList.toggle("active", c.dataset.costume === key));
    try { localStorage.setItem(COSTUME_KEY, key); } catch (e) {}
  }

  function loadCostume() {
    buildCostumeScreen();
    let saved = "vanguard";
    try { saved = localStorage.getItem(COSTUME_KEY) || "vanguard"; } catch (e) {}
    setCostume(saved);
  }

  el("open-costume").addEventListener("click", () => {
    setState("costume");
    // ensure the active card is scrolled into view
    const active = document.querySelector(".cos-card.active");
    if (active) active.scrollIntoView({ block: "nearest" });
  });
  el("costume-confirm").addEventListener("click", () => setState("menu"));

  // ---------------------------------------------------------------------
  //  Boot
  // ---------------------------------------------------------------------
  resize();
  loadBest();
  loadDifficulty();
  loadProgress();
  updateScoreLabel();
  loadCostume();
  setState("menu");
  requestAnimationFrame(frame);
})();
