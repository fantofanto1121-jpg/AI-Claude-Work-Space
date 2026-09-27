(() => {
  'use strict';

  // ---------- setup ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const el = {
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    combo: document.getElementById('combo'),
    shield: document.getElementById('shield-fill'),
    hint: document.getElementById('hint'),
    start: document.getElementById('start-screen'),
    gameover: document.getElementById('gameover-screen'),
    startBtn: document.getElementById('start-btn'),
    retryBtn: document.getElementById('retry-btn'),
    finalScore: document.getElementById('final-score'),
    finalBest: document.getElementById('final-best'),
    newRecord: document.getElementById('new-record'),
  };

  const COLORS = {
    cyan: '#38f5ff',
    pink: '#ff3ca6',
    purple: '#9b6bff',
    yellow: '#ffe14d',
    green: '#5dff9b',
  };

  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildStars();
    buildNebula();
  }

  // ---------- helpers ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const TAU = Math.PI * 2;

  // ---------- persistent state ----------
  let best = 0;
  try { best = parseInt(localStorage.getItem('neon_voyager_best') || '0', 10) || 0; } catch (e) {}
  el.best.textContent = best;

  // ---------- background: nebula + stars ----------
  let stars = [];
  let nebula = [];

  function buildStars() {
    stars = [];
    const count = Math.round((W * H) / 5200);
    for (let i = 0; i < count; i++) {
      const layer = Math.random();
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: 0.3 + layer * 1.4,          // depth -> speed & size
        r: 0.4 + layer * 1.6,
        tw: Math.random() * TAU,       // twinkle phase
        hue: Math.random() < 0.18 ? (Math.random() < 0.5 ? COLORS.cyan : COLORS.pink) : '#ffffff',
      });
    }
  }

  function buildNebula() {
    nebula = [];
    const palette = [COLORS.purple, COLORS.cyan, COLORS.pink];
    for (let i = 0; i < 4; i++) {
      nebula.push({
        x: rand(0, W),
        y: rand(0, H),
        r: rand(W * 0.35, W * 0.75),
        color: palette[i % palette.length],
        drift: rand(4, 12),
        phase: rand(0, TAU),
      });
    }
  }

  function drawBackground(dt, t) {
    // deep gradient base
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#070a1c');
    g.addColorStop(0.5, '#0a0f27');
    g.addColorStop(1, '#0c0820');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // drifting nebula blobs
    ctx.globalCompositeOperation = 'lighter';
    for (const n of nebula) {
      const nx = n.x + Math.cos(t / 6000 + n.phase) * n.drift;
      const ny = n.y + Math.sin(t / 7000 + n.phase) * n.drift;
      const rg = ctx.createRadialGradient(nx, ny, 0, nx, ny, n.r);
      rg.addColorStop(0, hexA(n.color, 0.16));
      rg.addColorStop(0.5, hexA(n.color, 0.05));
      rg.addColorStop(1, hexA(n.color, 0));
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(nx, ny, n.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // parallax starfield
    for (const s of stars) {
      s.y += s.z * (state.playing ? 42 : 14) * dt;
      s.tw += dt * (1.5 + s.z);
      if (s.y > H + 4) { s.y = -4; s.x = Math.random() * W; }
      const flick = 0.55 + 0.45 * Math.sin(s.tw);
      ctx.globalAlpha = flick;
      if (s.hue !== '#ffffff') {
        ctx.shadowColor = s.hue;
        ctx.shadowBlur = 6;
      }
      ctx.fillStyle = s.hue;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  // hex + alpha -> rgba
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r},${g},${b},${a})`;
  }

  // ---------- game state ----------
  const state = {
    playing: false,
    score: 0,
    shield: 100,
    combo: 0,
    comboTimer: 0,
    time: 0,
    spawnTimer: 0,
    fireTimer: 0,
    shake: 0,
    flash: 0,
  };

  const player = {
    x: 0, y: 0, tx: 0, ty: 0,
    r: 16, angle: 0, invuln: 0, alive: false, trail: 0,
  };

  let bullets = [];
  let enemies = [];
  let shards = [];
  let particles = [];
  let popups = [];

  // ---------- input ----------
  const pointer = { active: false, x: 0, y: 0 };
  const keys = {};

  function pointerPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', (e) => {
    pointer.active = true;
    const p = pointerPos(e);
    pointer.x = p.x; pointer.y = p.y;
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointerPos(e);
    pointer.x = p.x; pointer.y = p.y;
    // for mouse without button held, still steer if playing
    if (e.pointerType === 'mouse') pointer.active = true;
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('pointerup', () => { /* keep last target */ }, { passive: true });

  window.addEventListener('keydown', (e) => {
    keys[e.key] = true;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[e.key] = false; });

  // ---------- lifecycle ----------
  function startGame() {
    state.playing = true;
    state.score = 0;
    state.shield = 100;
    state.combo = 0;
    state.comboTimer = 0;
    state.time = 0;
    state.spawnTimer = 0;
    state.fireTimer = 0;
    state.shake = 0;
    state.flash = 0;

    bullets = []; enemies = []; shards = []; particles = []; popups = [];

    player.x = W / 2; player.y = H * 0.78;
    player.tx = player.x; player.ty = player.y;
    pointer.x = player.x; pointer.y = player.y;
    player.invuln = 1.2; player.alive = true;

    el.start.classList.add('hidden');
    el.gameover.classList.add('hidden');
    el.hint.classList.remove('hidden');
    el.combo.classList.add('hidden');
    updateScore(0);
    updateShield();
  }

  function endGame() {
    state.playing = false;
    player.alive = false;
    burst(player.x, player.y, COLORS.cyan, 46, 4.5);
    state.shake = 22;
    state.flash = 0.8;

    if (state.score > best) {
      best = state.score;
      try { localStorage.setItem('neon_voyager_best', String(best)); } catch (e) {}
      el.newRecord.classList.remove('hidden');
    } else {
      el.newRecord.classList.add('hidden');
    }
    el.best.textContent = best;
    el.finalScore.textContent = state.score;
    el.finalBest.textContent = best;

    setTimeout(() => {
      el.gameover.classList.remove('hidden');
      el.hint.classList.add('hidden');
    }, 650);
  }

  function updateScore(add) {
    state.score += add;
    el.score.textContent = state.score;
    el.score.classList.remove('bump');
    void el.score.offsetWidth;
    el.score.classList.add('bump');
  }

  function updateShield() {
    const pct = clamp(state.shield, 0, 100);
    el.shield.style.width = pct + '%';
    el.shield.classList.toggle('low', pct <= 34);
  }

  function addCombo() {
    state.combo++;
    state.comboTimer = 2.2;
    if (state.combo >= 2) {
      el.combo.classList.remove('hidden');
      el.combo.textContent = 'x' + state.combo;
      el.combo.classList.remove('pop');
      void el.combo.offsetWidth;
      el.combo.classList.add('pop');
    }
  }

  // ---------- spawning ----------
  const ENEMY_TYPES = [
    { kind: 'drone',  color: COLORS.pink,   r: 15, hp: 1, sides: 3, score: 10, speed: 78 },
    { kind: 'orb',    color: COLORS.purple, r: 17, hp: 2, sides: 0, score: 18, speed: 62 },
    { kind: 'shard',  color: COLORS.cyan,   r: 14, hp: 1, sides: 4, score: 12, speed: 96 },
    { kind: 'hunter', color: COLORS.green,  r: 19, hp: 3, sides: 6, score: 30, speed: 54 },
  ];

  function spawnEnemy() {
    const diff = Math.min(state.time / 60, 1); // ramps over first minute
    const roll = Math.random();
    let pool = ENEMY_TYPES.slice(0, diff > 0.3 ? 3 : 2);
    if (diff > 0.55 && roll > 0.7) pool = ENEMY_TYPES;
    const base = pool[Math.floor(Math.random() * pool.length)];
    const e = {
      ...base,
      x: rand(30, W - 30),
      y: -30,
      vx: rand(-20, 20),
      vy: base.speed * (0.85 + diff * 0.6),
      angle: 0, spin: rand(-2, 2),
      wob: rand(0, TAU),
      maxHp: base.hp, hit: 0,
    };
    enemies.push(e);
  }

  function spawnShard(x, y) {
    shards.push({ x, y, vx: rand(-30, 30), vy: rand(20, 55), r: 7, spin: rand(-4, 4), angle: 0, life: 8 });
  }

  // ---------- particles ----------
  function burst(x, y, color, n, spd) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = rand(spd * 0.3, spd) * 60;
      particles.push({
        x, y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.4, 0.9), max: 0.9,
        r: rand(1.5, 3.5), color,
      });
    }
  }

  function addPopup(x, y, text, color) {
    popups.push({ x, y, text, color, life: 0.9 });
  }

  // ---------- update ----------
  function update(dt) {
    state.time += dt;

    // steer target from pointer / keys
    let tx = pointer.x, ty = pointer.y;
    const kspd = 520 * dt;
    if (keys['ArrowLeft'] || keys['a']) { tx = player.x - kspd * 4; pointer.x = tx; }
    if (keys['ArrowRight'] || keys['d']) { tx = player.x + kspd * 4; pointer.x = tx; }
    if (keys['ArrowUp'] || keys['w']) { ty = player.y - kspd * 4; pointer.y = ty; }
    if (keys['ArrowDown'] || keys['s']) { ty = player.y + kspd * 4; pointer.y = ty; }

    player.tx = clamp(tx, player.r, W - player.r);
    player.ty = clamp(ty, player.r + 40, H - player.r - 20);

    // smooth follow
    const prevX = player.x;
    player.x += (player.tx - player.x) * Math.min(1, 12 * dt);
    player.y += (player.ty - player.y) * Math.min(1, 12 * dt);
    player.angle = clamp((player.x - prevX) * 0.06, -0.5, 0.5);
    player.invuln = Math.max(0, player.invuln - dt);

    // engine trail
    player.trail += dt;
    if (player.trail > 0.02) {
      player.trail = 0;
      particles.push({
        x: player.x + rand(-4, 4), y: player.y + player.r,
        vx: rand(-20, 20), vy: rand(120, 200),
        life: rand(0.25, 0.5), max: 0.5, r: rand(2, 4),
        color: Math.random() < 0.5 ? COLORS.cyan : COLORS.purple,
      });
    }

    // auto fire
    state.fireTimer -= dt;
    if (state.fireTimer <= 0) {
      state.fireTimer = 0.14;
      fire();
    }

    // spawn
    state.spawnTimer -= dt;
    const spawnEvery = clamp(0.95 - state.time / 90, 0.34, 0.95);
    if (state.spawnTimer <= 0) {
      state.spawnTimer = spawnEvery;
      spawnEnemy();
    }

    // combo decay
    if (state.combo > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) { state.combo = 0; el.combo.classList.add('hidden'); }
    }

    updateBullets(dt);
    updateEnemies(dt);
    updateShards(dt);

    // shake/flash decay
    state.shake *= Math.pow(0.001, dt);
    if (state.shake < 0.2) state.shake = 0;
    state.flash = Math.max(0, state.flash - dt * 1.6);
  }

  function fire() {
    bullets.push({ x: player.x, y: player.y - player.r, vy: -640, r: 4 });
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.y += b.vy * dt;
      if (b.y < -20) { bullets.splice(i, 1); continue; }
      // hit test
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        const dx = e.x - b.x, dy = e.y - b.y;
        if (dx * dx + dy * dy < (e.r + b.r) * (e.r + b.r)) {
          bullets.splice(i, 1);
          e.hp -= 1; e.hit = 0.12;
          burst(b.x, b.y, e.color, 5, 2);
          if (e.hp <= 0) destroyEnemy(j);
          break;
        }
      }
    }
  }

  function destroyEnemy(j) {
    const e = enemies[j];
    enemies.splice(j, 1);
    burst(e.x, e.y, e.color, 26, 3.6);
    addCombo();
    const mult = Math.max(1, state.combo);
    const gain = e.score * mult;
    updateScore(gain);
    addPopup(e.x, e.y, '+' + gain, e.color);
    state.shake = Math.min(state.shake + 4, 14);
    if (Math.random() < 0.45) spawnShard(e.x, e.y);
  }

  function updateEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.wob += dt * 2;
      if (e.kind === 'hunter') {
        // gently home toward player
        e.vx += clamp(player.x - e.x, -1, 1) * 30 * dt;
        e.vx = clamp(e.vx, -80, 80);
      }
      e.x += (e.vx + Math.sin(e.wob) * 12) * dt;
      e.y += e.vy * dt;
      e.angle += e.spin * dt;
      e.hit = Math.max(0, e.hit - dt);
      if (e.x < e.r) { e.x = e.r; e.vx = Math.abs(e.vx); }
      if (e.x > W - e.r) { e.x = W - e.r; e.vx = -Math.abs(e.vx); }

      if (e.y > H + 40) { enemies.splice(i, 1); continue; }

      // collide with player
      if (player.invuln <= 0 && player.alive) {
        const dx = e.x - player.x, dy = e.y - player.y;
        if (dx * dx + dy * dy < (e.r + player.r * 0.8) * (e.r + player.r * 0.8)) {
          enemies.splice(i, 1);
          burst(e.x, e.y, e.color, 24, 3.4);
          damage(24);
        }
      }
    }
  }

  function damage(amount) {
    state.shield -= amount;
    updateShield();
    player.invuln = 1.0;
    state.combo = 0; el.combo.classList.add('hidden');
    state.shake = 20; state.flash = 0.6;
    if (state.shield <= 0) { state.shield = 0; endGame(); }
  }

  function updateShards(dt) {
    for (let i = shards.length - 1; i >= 0; i--) {
      const s = shards[i];
      s.life -= dt;
      s.angle += s.spin * dt;
      // attract toward player when close
      const dx = player.x - s.x, dy = player.y - s.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 140) {
        s.vx += (dx / dist) * 620 * dt;
        s.vy += (dy / dist) * 620 * dt;
      } else {
        s.vy += 60 * dt;
      }
      s.x += s.vx * dt; s.y += s.vy * dt;
      s.vx *= 0.98; s.vy *= 0.98;

      if (dist < player.r + s.r) {
        shards.splice(i, 1);
        state.shield = Math.min(100, state.shield + 4);
        updateShield();
        updateScore(5);
        burst(s.x, s.y, COLORS.yellow, 10, 2);
        continue;
      }
      if (s.life <= 0 || s.y > H + 30) shards.splice(i, 1);
    }
  }

  // ---------- render ----------
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      const q = popups[i];
      q.life -= dt; q.y -= 40 * dt;
      if (q.life <= 0) popups.splice(i, 1);
    }
  }

  function drawParticles() {
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);
    const glow = e.hit > 0 ? '#ffffff' : e.color;
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = glow;
    ctx.fillStyle = hexA(e.color, 0.18);

    if (e.sides === 0) {
      // orb with inner ring
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.arc(0, 0, e.r * 0.55, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.beginPath();
      for (let k = 0; k < e.sides; k++) {
        const a = (k / e.sides) * TAU - Math.PI / 2;
        const px = Math.cos(a) * e.r, py = Math.sin(a) * e.r;
        k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    // core dot
    ctx.shadowBlur = 8;
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  function drawShard(s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.shadowColor = COLORS.yellow;
    ctx.shadowBlur = 16;
    ctx.fillStyle = COLORS.yellow;
    ctx.beginPath();
    ctx.moveTo(0, -s.r);
    ctx.lineTo(s.r * 0.6, 0);
    ctx.lineTo(0, s.r);
    ctx.lineTo(-s.r * 0.6, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  function drawBullet(b) {
    ctx.shadowColor = COLORS.cyan;
    ctx.shadowBlur = 14;
    const g = ctx.createLinearGradient(0, b.y - 14, 0, b.y + 6);
    g.addColorStop(0, hexA(COLORS.cyan, 0));
    g.addColorStop(1, COLORS.cyan);
    ctx.fillStyle = g;
    ctx.fillRect(b.x - 1.6, b.y - 14, 3.2, 20);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawPlayer() {
    if (!player.alive) return;
    const blink = player.invuln > 0 && Math.floor(state.time * 20) % 2 === 0;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);
    ctx.globalAlpha = blink ? 0.4 : 1;

    // engine glow
    ctx.shadowColor = COLORS.cyan;
    ctx.shadowBlur = 22;

    // hull
    ctx.beginPath();
    ctx.moveTo(0, -player.r - 4);
    ctx.lineTo(player.r, player.r);
    ctx.lineTo(0, player.r * 0.4);
    ctx.lineTo(-player.r, player.r);
    ctx.closePath();
    const hull = ctx.createLinearGradient(0, -player.r, 0, player.r);
    hull.addColorStop(0, '#ffffff');
    hull.addColorStop(0.5, COLORS.cyan);
    hull.addColorStop(1, COLORS.purple);
    ctx.fillStyle = hull;
    ctx.fill();

    // cockpit
    ctx.shadowBlur = 0;
    ctx.fillStyle = hexA(COLORS.pink, 0.9);
    ctx.beginPath();
    ctx.ellipse(0, -2, 3.5, 6, 0, 0, TAU);
    ctx.fill();

    // outline
    ctx.strokeStyle = hexA('#ffffff', 0.7);
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.restore();

    // shield ring when invulnerable
    if (player.invuln > 0) {
      ctx.globalAlpha = clamp(player.invuln, 0, 1) * 0.6;
      ctx.strokeStyle = COLORS.cyan;
      ctx.shadowColor = COLORS.cyan;
      ctx.shadowBlur = 16;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.r + 8, 0, TAU);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  function drawPopups() {
    ctx.textAlign = 'center';
    ctx.font = '700 18px system-ui, sans-serif';
    for (const q of popups) {
      ctx.globalAlpha = clamp(q.life / 0.9, 0, 1);
      ctx.fillStyle = q.color;
      ctx.shadowColor = q.color;
      ctx.shadowBlur = 10;
      ctx.fillText(q.text, q.x, q.y);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }

  // ---------- main loop ----------
  let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // clamp big frame gaps

    // camera shake offset
    const sx = state.shake ? rand(-state.shake, state.shake) : 0;
    const sy = state.shake ? rand(-state.shake, state.shake) : 0;

    ctx.setTransform(DPR, 0, 0, DPR, sx * DPR, sy * DPR);

    drawBackground(dt, now);

    if (state.playing) update(dt);
    updateParticles(dt);

    // draw world
    for (const s of shards) drawShard(s);
    for (const b of bullets) drawBullet(b);
    for (const e of enemies) drawEnemy(e);
    drawParticles();
    drawPlayer();
    drawPopups();

    // hit flash overlay
    if (state.flash > 0) {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.fillStyle = hexA('#ff3ca6', state.flash * 0.35);
      ctx.fillRect(0, 0, W, H);
    }

    requestAnimationFrame(loop);
  }

  // ---------- wire up ----------
  el.startBtn.addEventListener('click', () => { startGame(); });
  el.retryBtn.addEventListener('click', () => { startGame(); });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 150));

  resize();
  player.x = W / 2; player.y = H * 0.78;
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(loop); });
})();
