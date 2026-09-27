(() => {
  'use strict';

  // ===================================================================
  // BLOCK QUEST - a retro, stage-based brick breaker
  // Low-res virtual canvas upscaled with nearest-neighbour for crisp
  // pixel-art. Works with touch (drag) and mouse / keyboard.
  // ===================================================================

  const VW = 180, VH = 320;                 // virtual resolution (portrait)
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  canvas.width = VW;
  canvas.height = VH;
  ctx.imageSmoothingEnabled = false;

  let scale = 1;
  function resize() {
    const pad = 20; // bezel padding room
    const maxW = window.innerWidth - pad;
    const maxH = window.innerHeight - pad;
    scale = Math.max(1, Math.min(maxW / VW, maxH / VH));
    canvas.style.width = Math.round(VW * scale) + 'px';
    canvas.style.height = Math.round(VH * scale) + 'px';
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 150));
  resize();

  // ---------- 5x7 pixel bitmap font ----------
  const G = {
    'A':['.###.','#...#','#...#','#####','#...#','#...#','#...#'],
    'B':['####.','#...#','#...#','####.','#...#','#...#','####.'],
    'C':['.####','#....','#....','#....','#....','#....','.####'],
    'D':['####.','#...#','#...#','#...#','#...#','#...#','####.'],
    'E':['#####','#....','#....','####.','#....','#....','#####'],
    'F':['#####','#....','#....','####.','#....','#....','#....'],
    'G':['.####','#....','#....','#.###','#...#','#...#','.###.'],
    'H':['#...#','#...#','#...#','#####','#...#','#...#','#...#'],
    'I':['#####','..#..','..#..','..#..','..#..','..#..','#####'],
    'J':['..###','...#.','...#.','...#.','#..#.','#..#.','.##..'],
    'K':['#...#','#..#.','#.#..','##...','#.#..','#..#.','#...#'],
    'L':['#....','#....','#....','#....','#....','#....','#####'],
    'M':['#...#','##.##','#.#.#','#.#.#','#...#','#...#','#...#'],
    'N':['#...#','#...#','##..#','#.#.#','#..##','#...#','#...#'],
    'O':['.###.','#...#','#...#','#...#','#...#','#...#','.###.'],
    'P':['####.','#...#','#...#','####.','#....','#....','#....'],
    'Q':['.###.','#...#','#...#','#...#','#.#.#','#..#.','.##.#'],
    'R':['####.','#...#','#...#','####.','#.#..','#..#.','#...#'],
    'S':['.####','#....','#....','.###.','....#','....#','####.'],
    'T':['#####','..#..','..#..','..#..','..#..','..#..','..#..'],
    'U':['#...#','#...#','#...#','#...#','#...#','#...#','.###.'],
    'V':['#...#','#...#','#...#','#...#','#...#','.#.#.','..#..'],
    'W':['#...#','#...#','#...#','#.#.#','#.#.#','##.##','#...#'],
    'X':['#...#','#...#','.#.#.','..#..','.#.#.','#...#','#...#'],
    'Y':['#...#','#...#','.#.#.','..#..','..#..','..#..','..#..'],
    'Z':['#####','....#','...#.','..#..','.#...','#....','#####'],
    '0':['.###.','#...#','#..##','#.#.#','##..#','#...#','.###.'],
    '1':['..#..','.##..','..#..','..#..','..#..','..#..','.###.'],
    '2':['.###.','#...#','....#','...#.','..#..','.#...','#####'],
    '3':['#####','...#.','..#..','...#.','....#','#...#','.###.'],
    '4':['...#.','..##.','.#.#.','#..#.','#####','...#.','...#.'],
    '5':['#####','#....','####.','....#','....#','#...#','.###.'],
    '6':['..##.','.#...','#....','####.','#...#','#...#','.###.'],
    '7':['#####','....#','...#.','..#..','.#...','.#...','.#...'],
    '8':['.###.','#...#','#...#','.###.','#...#','#...#','.###.'],
    '9':['.###.','#...#','#...#','.####','....#','...#.','.##..'],
    '!':['..#..','..#..','..#..','..#..','..#..','.....','..#..'],
    ':':['.....','..#..','..#..','.....','..#..','..#..','.....'],
    '-':['.....','.....','.....','#####','.....','.....','.....'],
    '.':['.....','.....','.....','.....','.....','.##..','.##..'],
    ' ':['.....','.....','.....','.....','.....','.....','.....'],
  };
  const GW = 5, GH = 7;

  function textWidth(str, s) { return str.length * (GW + 1) * s - s; }

  function drawText(str, x, y, s, color) {
    str = String(str).toUpperCase();
    ctx.fillStyle = color;
    for (let i = 0; i < str.length; i++) {
      const g = G[str[i]] || G[' '];
      const gx = x + i * (GW + 1) * s;
      for (let r = 0; r < GH; r++) {
        const row = g[r];
        for (let c = 0; c < GW; c++) {
          if (row[c] === '#') ctx.fillRect(gx + c * s, y + r * s, s, s);
        }
      }
    }
  }
  function drawTextCenter(str, y, s, color) {
    drawText(str, Math.round((VW - textWidth(str, s)) / 2), y, s, color);
  }

  // ---------- palette ----------
  const PAL = {
    R: '#e8402e', O: '#e8892e', Y: '#f2d43f', G: '#49b04a',
    C: '#3fc0d6', B: '#4a6ff0', P: '#a558e0', S: '#c2c6d6', X: '#d9a441',
  };
  const HP = { S: 2, X: -1 }; // default 1; S needs 2 hits; X indestructible

  // ---------- stage layouts (8 columns) ----------
  const STAGES = [
    [ 'RRRRRRRR', 'OOOOOOOO', 'YYYYYYYY', 'GGGGGGGG' ],
    [ '...RR...', '..OOOO..', '.YYYYYY.', 'GGGGGGGG', 'CCCCCCCC' ],
    [ 'SSSSSSSS', 'R.R.R.R.', '.C.C.C.C', 'BBBBBBBB', 'S......S' ],
    [ 'X......X', 'RRRRRRRR', 'OOSSSSOO', 'X.YYYY.X', 'GGGGGGGG' ],
    [ 'SXSXSXSX', 'PPPPPPPP', 'C.CC.C.C', 'YYYYYYYY', 'R.RRRR.R' ],
    [ 'BXBXBXBX', 'SSSSSSSS', 'P.P..P.P', 'OOOOOOOO', 'G.GGGG.G', 'XSXSXSXS' ],
  ];

  // ---------- geometry ----------
  const WALL_L = 6, WALL_R = VW - 6, CEIL = 13;
  const BX0 = 10, BROWY0 = 20, BW = 20, BH = 8, COLS = 8;
  const PADY = VH - 18, PAD_W0 = 30, PAD_H = 5;
  const BALL_R = 2;
  const BOOST_MULT = 1.22;   // speed gain per tap
  const BALL_SPEED_MAX = 300; // cap so the ball stays catchable

  // ---------- state ----------
  const S = {
    mode: 'title',   // title | stagestart | ready | play | clear | over
    score: 0, hi: 0, stage: 0, lives: 3,
    t: 0, timer: 0, flash: 0, shake: 0, blink: 0, boost: 0,
  };
  try { S.hi = parseInt(localStorage.getItem('block_quest_hi') || '0', 10) || 0; } catch (e) {}

  let bricks = [];
  let balls = [];
  let caps = [];       // falling power-up capsules
  let parts = [];      // particles
  const paddle = { x: (VW - PAD_W0) / 2, w: PAD_W0, expire: 0 };

  // ---------- input ----------
  const keys = {};
  let pointerX = null;

  function toVirtX(clientX) {
    const rect = canvas.getBoundingClientRect();
    return (clientX - rect.left) / (rect.width / VW);
  }
  function press() {
    if (S.mode === 'title') startStage(1);
    else if (S.mode === 'ready') launch();
    else if (S.mode === 'play') accelerate();
    else if (S.mode === 'over') { S.mode = 'title'; S.blink = 0; }
    // 'clear' and 'stagestart' advance on their own timers
  }
  canvas.addEventListener('pointerdown', (e) => {
    pointerX = toVirtX(e.clientX);
    movePaddleTo(pointerX);
    press();
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('pointermove', (e) => {
    pointerX = toVirtX(e.clientX);
    movePaddleTo(pointerX);
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    keys[e.key] = true;
    if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Enter'].includes(e.key)) {
      e.preventDefault();
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'Enter') press();
    }
  });
  window.addEventListener('keyup', (e) => { keys[e.key] = false; });

  function movePaddleTo(vx) {
    paddle.x = clamp(vx - paddle.w / 2, WALL_L, WALL_R - paddle.w);
  }

  // ---------- helpers ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------- game flow ----------
  function buildStage(n) {
    bricks = [];
    const layout = STAGES[(n - 1) % STAGES.length];
    for (let r = 0; r < layout.length; r++) {
      for (let c = 0; c < COLS; c++) {
        const ch = layout[r][c];
        if (!ch || ch === '.') continue;
        bricks.push({
          x: BX0 + c * BW, y: BROWY0 + r * BH, w: BW, h: BH,
          ch, color: PAL[ch] || '#fff',
          hp: HP[ch] === undefined ? 1 : HP[ch],
          solid: HP[ch] === -1,
        });
      }
    }
  }

  function startStage(n) {
    S.stage = n;
    buildStage(n);
    paddle.w = PAD_W0; paddle.expire = 0;
    caps = []; parts = [];
    S.mode = 'stagestart';
    S.timer = 1.4;
  }

  function resetBallOnPaddle() {
    balls = [{
      x: paddle.x + paddle.w / 2, y: PADY - BALL_R - 1,
      vx: 0, vy: 0, stuck: true, trail: [],
    }];
    S.mode = 'ready';
  }

  function ballSpeed() { return 96 + (S.stage - 1) * 9; }

  function launch() {
    const b = balls[0];
    if (!b || !b.stuck) return;
    b.stuck = false;
    const sp = ballSpeed();
    const a = rand(-0.35, 0.35); // slight random angle
    b.vx = Math.sin(a) * sp;
    b.vy = -Math.cos(a) * sp;
    S.mode = 'play';
  }

  function accelerate() {
    let boosted = false;
    for (const b of balls) {
      if (b.stuck) continue;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp <= 0) continue;
      const nsp = Math.min(sp * BOOST_MULT, BALL_SPEED_MAX);
      if (nsp > sp + 0.01) {
        b.vx = (b.vx / sp) * nsp;
        b.vy = (b.vy / sp) * nsp;
        burst(b.x, b.y, '#bfeaff', 5);
        boosted = true;
      }
    }
    if (boosted) { S.boost = 0.5; S.shake = Math.max(S.shake, 3); }
  }

  function loseLife() {
    S.lives--;
    S.flash = 0.5; S.shake = 6;
    if (S.lives <= 0) {
      if (S.score > S.hi) { S.hi = S.score; try { localStorage.setItem('block_quest_hi', String(S.hi)); } catch (e) {} }
      S.mode = 'over'; S.blink = 0;
    } else {
      caps = [];
      paddle.w = PAD_W0; paddle.expire = 0;
      resetBallOnPaddle();
    }
  }

  function bricksLeft() {
    for (const b of bricks) if (!b.solid) return true;
    return false;
  }

  // ---------- particles / capsules ----------
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(20, 70);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, life: rand(0.3, 0.6), color });
    }
  }
  function maybeDropCapsule(x, y) {
    if (Math.random() > 0.12) return;
    const roll = Math.random();
    const type = roll < 0.5 ? 'E' : roll < 0.85 ? 'M' : '1';
    caps.push({ x: x - 4, y, w: 8, h: 5, type });
  }

  // ---------- update ----------
  function update(dt) {
    S.t += dt;
    S.blink += dt;
    S.flash = Math.max(0, S.flash - dt * 1.5);
    S.shake = Math.max(0, S.shake - dt * 18);
    S.boost = Math.max(0, S.boost - dt);

    // keyboard paddle control
    const kv = 150 * dt;
    if (keys['ArrowLeft'] || keys['a']) { paddle.x = clamp(paddle.x - kv, WALL_L, WALL_R - paddle.w); pointerX = null; }
    if (keys['ArrowRight'] || keys['d']) { paddle.x = clamp(paddle.x + kv, WALL_L, WALL_R - paddle.w); pointerX = null; }

    // paddle expand timer
    if (paddle.expire > 0) {
      paddle.expire -= dt;
      if (paddle.expire <= 0) {
        const cx = paddle.x + paddle.w / 2;
        paddle.w = PAD_W0;
        paddle.x = clamp(cx - paddle.w / 2, WALL_L, WALL_R - paddle.w);
      }
    }

    if (S.mode === 'stagestart') {
      S.timer -= dt;
      if (S.timer <= 0) resetBallOnPaddle();
      updateParticles(dt);
      return;
    }
    if (S.mode === 'clear') {
      S.timer -= dt;
      updateParticles(dt);
      if (S.timer <= 0) startStage(S.stage + 1);
      return;
    }
    if (S.mode === 'title' || S.mode === 'over') { updateParticles(dt); return; }

    // ready: keep ball glued to paddle
    if (S.mode === 'ready') {
      const b = balls[0];
      if (b) { b.x = paddle.x + paddle.w / 2; b.y = PADY - BALL_R - 1; }
      updateParticles(dt);
      return;
    }

    // ---- play ----
    for (const b of balls) stepBall(b, dt);
    balls = balls.filter((b) => b.alive !== false);
    if (balls.length === 0) { loseLife(); return; }

    updateCapsules(dt);
    updateParticles(dt);

    if (!bricksLeft()) {
      S.score += 100; // stage bonus
      S.mode = 'clear'; S.timer = 1.8;
      burst(VW / 2, VH / 2, '#f2d43f', 20);
    }
  }

  function stepBall(b, dt) {
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 6) b.trail.shift();

    const px = b.x, py = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    // walls
    if (b.x - BALL_R < WALL_L) { b.x = WALL_L + BALL_R; b.vx = Math.abs(b.vx); }
    if (b.x + BALL_R > WALL_R) { b.x = WALL_R - BALL_R; b.vx = -Math.abs(b.vx); }
    if (b.y - BALL_R < CEIL) { b.y = CEIL + BALL_R; b.vy = Math.abs(b.vy); }

    // paddle
    if (b.vy > 0 && b.y + BALL_R >= PADY && b.y - BALL_R <= PADY + PAD_H &&
        b.x >= paddle.x - BALL_R && b.x <= paddle.x + paddle.w + BALL_R) {
      const sp = Math.hypot(b.vx, b.vy);
      const hit = clamp((b.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2), -1, 1);
      const ang = hit * 1.05; // up to ~60 degrees
      b.vx = Math.sin(ang) * sp;
      b.vy = -Math.abs(Math.cos(ang) * sp);
      b.y = PADY - BALL_R - 1;
    }

    // bricks
    for (let i = bricks.length - 1; i >= 0; i--) {
      const k = bricks[i];
      if (b.x + BALL_R <= k.x || b.x - BALL_R >= k.x + k.w ||
          b.y + BALL_R <= k.y || b.y - BALL_R >= k.y + k.h) continue;

      // resolve reflection from previous position
      if (px + BALL_R <= k.x) { b.vx = -Math.abs(b.vx); b.x = k.x - BALL_R; }
      else if (px - BALL_R >= k.x + k.w) { b.vx = Math.abs(b.vx); b.x = k.x + k.w + BALL_R; }
      else if (py + BALL_R <= k.y) { b.vy = -Math.abs(b.vy); b.y = k.y - BALL_R; }
      else if (py - BALL_R >= k.y + k.h) { b.vy = Math.abs(b.vy); b.y = k.y + k.h + BALL_R; }
      else b.vy = -b.vy;

      if (k.solid) { burst(b.x, b.y, k.color, 3); break; }

      k.hp--;
      if (k.hp <= 0) {
        bricks.splice(i, 1);
        S.score += (k.ch === 'S' ? 20 : 10);
        burst(k.x + k.w / 2, k.y + k.h / 2, k.color, 7);
        maybeDropCapsule(k.x + k.w / 2, k.y + k.h / 2);
      } else {
        S.score += 5;
        burst(b.x, b.y, k.color, 3);
      }
      break; // one brick per frame keeps physics stable
    }

    if (b.y - BALL_R > VH) b.alive = false;
  }

  function updateCapsules(dt) {
    for (let i = caps.length - 1; i >= 0; i--) {
      const c = caps[i];
      c.y += 55 * dt;
      // catch
      if (c.y + c.h >= PADY && c.y <= PADY + PAD_H &&
          c.x + c.w >= paddle.x && c.x <= paddle.x + paddle.w) {
        applyPowerup(c.type);
        burst(c.x + c.w / 2, PADY, '#fff', 8);
        caps.splice(i, 1);
        continue;
      }
      if (c.y > VH) caps.splice(i, 1);
    }
  }

  function applyPowerup(type) {
    if (type === 'E') {
      paddle.w = 46; paddle.expire = 12;
      paddle.x = clamp(paddle.x - 8, WALL_L, WALL_R - paddle.w);
      S.score += 30;
    } else if (type === 'M') {
      const src = balls[0];
      if (src) {
        const sp = ballSpeed();
        for (const a of [-0.5, 0.5]) {
          balls.push({ x: src.x, y: src.y, vx: Math.sin(a) * sp, vy: -Math.abs(Math.cos(a) * sp), stuck: false, trail: [] });
        }
      }
      S.score += 30;
    } else if (type === '1') {
      S.lives++;
      S.score += 50;
    }
  }

  function updateParticles(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      p.vy += 120 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.life <= 0) parts.splice(i, 1);
    }
  }

  // ---------- render ----------
  function draw() {
    // background
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, VW, VH);

    // faint dotted grid for texture
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let y = CEIL + 4; y < VH; y += 8) {
      for (let x = WALL_L; x < WALL_R; x += 8) ctx.fillRect(x, y, 1, 1);
    }

    // side / top walls (arcade frame)
    ctx.fillStyle = '#1c2440';
    ctx.fillRect(0, CEIL - 2, VW, 2);
    ctx.fillRect(WALL_L - 2, CEIL, 2, VH - CEIL);
    ctx.fillRect(WALL_R, CEIL, 2, VH - CEIL);
    ctx.fillStyle = '#2e3a63';
    ctx.fillRect(0, CEIL - 2, VW, 1);

    drawBricks();
    drawCapsules();
    drawParticles();
    drawPaddle();
    drawBalls();
    drawHUD();
    drawOverlays();

    // life-loss flash
    if (S.flash > 0) {
      ctx.fillStyle = 'rgba(255,80,80,' + (S.flash * 0.4) + ')';
      ctx.fillRect(0, 0, VW, VH);
    }
  }

  function drawBrick(k) {
    ctx.fillStyle = k.color;
    ctx.fillRect(k.x, k.y, k.w, k.h);
    // bevel: light top/left, dark bottom/right
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(k.x, k.y, k.w, 1);
    ctx.fillRect(k.x, k.y, 1, k.h);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(k.x, k.y + k.h - 1, k.w, 1);
    ctx.fillRect(k.x + k.w - 1, k.y, 1, k.h);
    // silver crack when damaged
    if (k.ch === 'S' && k.hp === 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(k.x + k.w / 2 - 1, k.y + 2, 1, k.h - 4);
      ctx.fillRect(k.x + k.w / 2 + 2, k.y + 1, 1, k.h - 2);
    }
    // gold studs
    if (k.solid) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(k.x + 2, k.y + 2, 1, 1);
      ctx.fillRect(k.x + k.w - 3, k.y + 2, 1, 1);
    }
  }
  function drawBricks() { for (const k of bricks) drawBrick(k); }

  function drawPaddle() {
    const x = Math.round(paddle.x), w = paddle.w;
    ctx.fillStyle = '#d0d6e6';
    ctx.fillRect(x, PADY, w, PAD_H);
    ctx.fillStyle = '#3fc0d6';
    ctx.fillRect(x + 1, PADY + 1, w - 2, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(x, PADY, w, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x, PADY + PAD_H - 1, w, 1);
  }

  function drawBalls() {
    for (const b of balls) {
      for (let i = 0; i < b.trail.length; i++) {
        const a = (i + 1) / b.trail.length * 0.5;
        ctx.fillStyle = 'rgba(120,220,255,' + a + ')';
        ctx.fillRect(Math.round(b.trail[i].x) - BALL_R, Math.round(b.trail[i].y) - BALL_R, BALL_R * 2, BALL_R * 2);
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(b.x) - BALL_R, Math.round(b.y) - BALL_R, BALL_R * 2, BALL_R * 2);
      ctx.fillStyle = '#bfeaff';
      ctx.fillRect(Math.round(b.x) - BALL_R, Math.round(b.y) - BALL_R, BALL_R, BALL_R);
    }
  }

  function drawCapsules() {
    for (const c of caps) {
      const col = c.type === 'E' ? '#49b04a' : c.type === 'M' ? '#a558e0' : '#e8402e';
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(c.x), Math.round(c.y), c.w, c.h);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(Math.round(c.x), Math.round(c.y), c.w, 1);
      drawText(c.type, Math.round(c.x) + 2, Math.round(c.y) - 1, 1, '#fff');
    }
  }

  function drawParticles() {
    for (const p of parts) {
      ctx.globalAlpha = clamp(p.life * 2, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  function pad6(n) { n = Math.min(999999, n | 0); return ('000000' + n).slice(-6); }

  function drawHUD() {
    drawText(pad6(S.score), 6, 3, 1, '#3fc0d6');
    const hi = 'HI' + pad6(S.hi);
    drawText(hi, VW - textWidth(hi, 1) - 6, 3, 1, '#f2d43f');
    // stage label centered
    drawTextCenter('STAGE ' + S.stage, 3, 1, '#c2c6d6');
    // lives as little paddle icons bottom-left of HUD band
    for (let i = 0; i < Math.min(S.lives - 1, 6); i++) {
      const lx = 6 + i * 10;
      ctx.fillStyle = '#d0d6e6';
      ctx.fillRect(lx, 11, 7, 2);
      ctx.fillStyle = '#3fc0d6';
      ctx.fillRect(lx + 1, 11, 5, 1);
    }
  }

  function drawOverlays() {
    const blinkOn = Math.floor(S.blink * 2) % 2 === 0;
    if (S.mode === 'title') {
      panel(90, 120);
      drawTextCenter('BLOCK', 96, 4, '#f2d43f');
      drawTextCenter('QUEST', 132, 4, '#e8402e');
      if (blinkOn) drawTextCenter('TAP TO START', 180, 1, '#ffffff');
      drawTextCenter('DRAG OR ARROWS TO MOVE', 200, 1, '#7c86a8');
    } else if (S.mode === 'stagestart') {
      drawTextCenter('STAGE ' + S.stage, 150, 3, '#ffffff');
      drawTextCenter('READY', 180, 2, '#f2d43f');
    } else if (S.mode === 'ready') {
      if (blinkOn) drawTextCenter('TAP TO LAUNCH', 244, 1, '#ffffff');
      drawTextCenter('THEN TAP TO SPEED UP', 258, 1, '#7c86a8');
    } else if (S.mode === 'play') {
      if (S.boost > 0) {
        ctx.globalAlpha = clamp(S.boost * 2, 0, 1);
        drawTextCenter('SPEED UP!', 236, 1, '#bfeaff');
        ctx.globalAlpha = 1;
      }
    } else if (S.mode === 'clear') {
      drawTextCenter('STAGE', 140, 3, '#3fc0d6');
      drawTextCenter('CLEAR!', 172, 3, '#f2d43f');
    } else if (S.mode === 'over') {
      panel(120, 90);
      drawTextCenter('GAME', 130, 3, '#e8402e');
      drawTextCenter('OVER', 158, 3, '#e8402e');
      drawTextCenter('SCORE ' + pad6(S.score), 190, 1, '#ffffff');
      if (S.score >= S.hi && S.score > 0) drawTextCenter('NEW RECORD!', 204, 1, '#f2d43f');
      if (blinkOn) drawTextCenter('TAP TO RETRY', 224, 1, '#7c86a8');
    }
  }

  function panel(y, h) {
    ctx.fillStyle = 'rgba(5,8,20,0.82)';
    ctx.fillRect(14, y, VW - 28, h);
    ctx.fillStyle = '#2e3a63';
    ctx.fillRect(14, y, VW - 28, 1);
    ctx.fillRect(14, y + h - 1, VW - 28, 1);
    ctx.fillRect(14, y, 1, h);
    ctx.fillRect(VW - 15, y, 1, h);
  }

  // ---------- main loop ----------
  let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;

    update(dt);

    // screen shake
    const sx = S.shake ? Math.round(rand(-S.shake, S.shake)) : 0;
    const sy = S.shake ? Math.round(rand(-S.shake, S.shake)) : 0;
    ctx.save();
    ctx.translate(sx, sy);
    draw();
    ctx.restore();

    requestAnimationFrame(loop);
  }
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(loop); });
})();
