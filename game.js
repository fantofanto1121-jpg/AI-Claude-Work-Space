(function () {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const finalScoreEl = document.getElementById("final-score");
  const finalBestEl = document.getElementById("final-best");
  const startScreen = document.getElementById("start-screen");
  const gameOverScreen = document.getElementById("gameover-screen");
  const startBtn = document.getElementById("start-btn");
  const retryBtn = document.getElementById("retry-btn");
  const tapHint = document.getElementById("tap-hint");

  const STORAGE_KEY = "stack-tower-best";

  let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  let viewW = 0;
  let viewH = 0;
  let baseX = 0;
  let baseY = 0;

  const BLOCK_HEIGHT = 34;
  const BASE_WIDTH_RATIO = 0.62;
  const MOVING_ANCHOR_RATIO = 0.22;
  const PERFECT_THRESHOLD = 4;

  const state = {
    running: false,
    score: 0,
    best: 0,
    combo: 0,
    stack: [],
    moving: null,
    speed: 2.4,
    direction: 1,
    cameraY: 0,
    cameraTargetY: 0,
    shake: 0,
    particles: [],
    sparkles: [],
    flashes: [],
    hueBase: 200,
  };

  let scoreBumpTimer = null;
  function setScore(v) {
    scoreEl.textContent = v;
    scoreEl.classList.remove("bump");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("bump");
    if (scoreBumpTimer) clearTimeout(scoreBumpTimer);
    scoreBumpTimer = setTimeout(() => scoreEl.classList.remove("bump"), 300);
  }

  const comboEl = document.createElement("div");
  comboEl.id = "combo";
  comboEl.className = "combo hidden";
  document.getElementById("app").appendChild(comboEl);
  let comboHideTimer = null;

  function showCombo(n) {
    if (n < 2) return;
    comboEl.textContent = "×" + n + " COMBO!";
    comboEl.classList.remove("hidden");
    comboEl.classList.remove("pop");
    void comboEl.offsetWidth;
    comboEl.classList.add("pop");
    if (comboHideTimer) clearTimeout(comboHideTimer);
    comboHideTimer = setTimeout(() => comboEl.classList.add("hidden"), 900);
  }
  function hideCombo() {
    comboEl.classList.add("hidden");
    if (comboHideTimer) {
      clearTimeout(comboHideTimer);
      comboHideTimer = null;
    }
  }

  let audioCtx = null;
  let audioEnabled = true;
  function ensureAudio() {
    if (audioCtx) return audioCtx;
    if (!audioEnabled) return null;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    } catch (e) {
      audioEnabled = false;
      return null;
    }
    return audioCtx;
  }
  function playTone(freq, duration, type, gain) {
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain || 0.15, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }
  function playDrop() {
    playTone(180 + Math.min(600, state.stack.length * 25), 0.12, "sine", 0.14);
  }
  function playPerfect(streak) {
    const base = 660;
    const step = Math.min(6, streak - 1);
    playTone(base + step * 80, 0.09, "triangle", 0.16);
    setTimeout(() => playTone(base * 1.5 + step * 100, 0.14, "triangle", 0.13), 55);
  }
  function playMiss() {
    playTone(120, 0.22, "sawtooth", 0.16);
    playTone(70, 0.32, "sine", 0.1);
  }

  function vibrate(pattern) {
    if (!("vibrate" in navigator)) return;
    try { navigator.vibrate(pattern); } catch (e) {}
  }
  function triggerShake(amount) {
    state.shake = Math.max(state.shake, amount);
  }

  function loadBest() {
    try {
      const v = parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
      state.best = isFinite(v) ? v : 0;
    } catch (e) {
      state.best = 0;
    }
    bestEl.textContent = state.best;
  }

  function saveBest() {
    try {
      localStorage.setItem(STORAGE_KEY, String(state.best));
    } catch (e) {}
  }

  function resize() {
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width = Math.floor(viewW * dpr);
    canvas.height = Math.floor(viewH * dpr);
    canvas.style.width = viewW + "px";
    canvas.style.height = viewH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    baseX = viewW / 2;
    baseY = viewH - Math.max(80, viewH * 0.12);
  }

  function colorForLevel(level) {
    const hue = (state.hueBase + level * 12) % 360;
    return `hsl(${hue}, 70%, 62%)`;
  }

  function shadowColorForLevel(level) {
    const hue = (state.hueBase + level * 12) % 360;
    return `hsl(${hue}, 70%, 40%)`;
  }

  function createBlock(x, width, level) {
    return {
      x: x,
      width: width,
      level: level,
      color: colorForLevel(level),
      shadow: shadowColorForLevel(level),
    };
  }

  function resetState() {
    state.score = 0;
    state.combo = 0;
    state.stack = [];
    state.particles = [];
    state.sparkles = [];
    state.flashes = [];
    state.cameraY = 0;
    state.cameraTargetY = 0;
    state.shake = 0;
    state.speed = 2.4;
    state.direction = 1;
    state.hueBase = 190 + Math.random() * 60;
    scoreEl.textContent = "0";
    scoreEl.classList.remove("bump");
    hideCombo();

    const baseWidth = Math.min(viewW * BASE_WIDTH_RATIO, 320);
    const base = createBlock(baseX, baseWidth, 0);
    state.stack.push(base);
    updateCameraTarget();
    state.cameraY = state.cameraTargetY;

    spawnMoving();
  }

  function updateCameraTarget() {
    const nextMovingLevel = state.stack.length;
    const naturalMovingY = baseY - nextMovingLevel * BLOCK_HEIGHT + BLOCK_HEIGHT;
    const desiredY = viewH * MOVING_ANCHOR_RATIO;
    state.cameraTargetY = Math.max(0, desiredY - naturalMovingY);
  }

  function spawnMoving() {
    const top = state.stack[state.stack.length - 1];
    const startFromLeft = Math.random() < 0.5;
    const startX = startFromLeft ? -top.width / 2 : viewW + top.width / 2;
    const dir = startFromLeft ? 1 : -1;
    state.direction = dir;
    state.moving = {
      x: startX,
      width: top.width,
      level: top.level + 1,
      color: colorForLevel(top.level + 1),
      shadow: shadowColorForLevel(top.level + 1),
    };
    state.speed = Math.min(6.8, 2.4 + top.level * 0.14);
  }

  function drop() {
    if (!state.running || !state.moving) return;
    const top = state.stack[state.stack.length - 1];
    const moving = state.moving;

    const movingLeft = moving.x - moving.width / 2;
    const movingRight = moving.x + moving.width / 2;
    const topLeft = top.x - top.width / 2;
    const topRight = top.x + top.width / 2;

    const overlapLeft = Math.max(movingLeft, topLeft);
    const overlapRight = Math.min(movingRight, topRight);
    const overlap = overlapRight - overlapLeft;

    if (overlap <= 0) {
      const fallen = {
        x: moving.x,
        width: moving.width,
        level: moving.level,
        color: moving.color,
        shadow: moving.shadow,
        vy: 0,
        vx: moving.x < top.x ? -1.5 : 1.5,
        rot: 0,
        vrot: (Math.random() - 0.5) * 0.05,
        yOffset: 0,
      };
      state.particles.push(fallen);
      state.moving = null;
      state.combo = 0;
      hideCombo();
      playMiss();
      vibrate([30, 40, 60]);
      triggerShake(14);
      gameOver();
      return;
    }

    const diff = Math.abs(moving.x - top.x);
    const perfect = diff < PERFECT_THRESHOLD;

    let newBlock;
    if (perfect) {
      newBlock = createBlock(top.x, top.width, moving.level);
      const bonusY = baseY - moving.level * BLOCK_HEIGHT;
      state.flashes.push({
        x: top.x,
        y: bonusY,
        r: 0,
        max: Math.max(top.width, 120),
        alpha: 1,
      });
      state.combo += 1;
      spawnSparkles(top.x, bonusY, state.combo);
      const bonus = 2 + Math.min(8, state.combo);
      state.score += bonus;
      playPerfect(state.combo);
      vibrate(state.combo >= 3 ? [10, 30, 20] : 12);
      if (state.combo >= 2) showCombo(state.combo);
    } else {
      const newX = (overlapLeft + overlapRight) / 2;
      newBlock = createBlock(newX, overlap, moving.level);

      const cutSide = moving.x < top.x ? -1 : 1;
      const cutWidth = moving.width - overlap;
      const cutX = cutSide === -1
        ? movingLeft + cutWidth / 2
        : movingRight - cutWidth / 2;
      state.particles.push({
        x: cutX,
        width: cutWidth,
        level: moving.level,
        color: moving.color,
        shadow: moving.shadow,
        vy: 0,
        vx: cutSide * 0.8,
        rot: 0,
        vrot: cutSide * 0.03,
        yOffset: 0,
      });
      state.score += 1;
      if (state.combo > 0) {
        state.combo = 0;
        hideCombo();
      }
      playDrop();
      vibrate(8);
    }

    state.stack.push(newBlock);
    setScore(state.score);
    updateCameraTarget();

    if (newBlock.width < 6) {
      state.moving = null;
      state.combo = 0;
      hideCombo();
      playMiss();
      vibrate([20, 30, 50]);
      triggerShake(12);
      gameOver();
      return;
    }

    spawnMoving();
  }

  function spawnSparkles(x, y, combo) {
    const count = 8 + Math.min(12, combo * 2);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
      const speed = 1.5 + Math.random() * 2 + Math.min(1.5, combo * 0.15);
      state.sparkles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.5,
        life: 1,
        decay: 0.02 + Math.random() * 0.02,
        size: 2 + Math.random() * 2,
        hue: (state.hueBase + 40 + Math.random() * 60) % 360,
      });
    }
  }

  function gameOver() {
    state.running = false;
    if (state.score > state.best) {
      state.best = state.score;
      bestEl.textContent = state.best;
      saveBest();
    }
    finalScoreEl.textContent = state.score;
    finalBestEl.textContent = state.best;
    setTimeout(() => {
      gameOverScreen.classList.remove("hidden");
    }, 500);
  }

  function update(dt) {
    state.cameraY += (state.cameraTargetY - state.cameraY) * Math.min(1, dt * 0.014);

    if (state.moving) {
      state.moving.x += state.speed * state.direction * dt * 0.06;
      const halfW = state.moving.width / 2;
      const leftBound = halfW + 10;
      const rightBound = viewW - halfW - 10;
      if (state.moving.x < leftBound && state.direction < 0) {
        state.moving.x = leftBound;
        state.direction = 1;
      } else if (state.moving.x > rightBound && state.direction > 0) {
        state.moving.x = rightBound;
        state.direction = -1;
      }
    }

    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.vy += 0.6 * dt * 0.06;
      p.yOffset += p.vy * dt * 0.06;
      p.x += p.vx * dt * 0.6;
      p.rot += p.vrot * dt * 0.06;
      const worldY = baseY - p.level * BLOCK_HEIGHT + p.yOffset + state.cameraY;
      if (worldY > viewH + 200) {
        state.particles.splice(i, 1);
      }
    }

    for (let i = state.flashes.length - 1; i >= 0; i--) {
      const f = state.flashes[i];
      f.r += 4 * dt * 0.06;
      f.alpha -= 0.03 * dt * 0.06;
      if (f.alpha <= 0) state.flashes.splice(i, 1);
    }

    for (let i = state.sparkles.length - 1; i >= 0; i--) {
      const s = state.sparkles[i];
      s.vy += 0.25 * dt * 0.06;
      s.x += s.vx * dt * 0.6;
      s.y += s.vy * dt * 0.6;
      s.life -= s.decay * dt * 0.06;
      if (s.life <= 0) state.sparkles.splice(i, 1);
    }

    if (state.shake > 0.05) {
      state.shake *= Math.pow(0.86, dt * 0.06);
    } else {
      state.shake = 0;
    }
  }

  function drawBlock(x, y, w, h, color, shadow, alpha) {
    if (alpha !== undefined) ctx.globalAlpha = alpha;
    const left = x - w / 2;
    const top = y - h;

    ctx.fillStyle = shadow;
    ctx.beginPath();
    roundRect(ctx, left, top + 4, w, h, 6);
    ctx.fill();

    const grad = ctx.createLinearGradient(0, top, 0, top + h);
    grad.addColorStop(0, lighten(color, 0.14));
    grad.addColorStop(1, color);
    ctx.fillStyle = grad;
    ctx.beginPath();
    roundRect(ctx, left, top, w, h, 6);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left + 4, top + 1.5);
    ctx.lineTo(left + w - 4, top + 1.5);
    ctx.stroke();

    ctx.globalAlpha = 1;
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
  }

  function lighten(hslColor, amount) {
    const m = /hsl\((\d+),\s*(\d+)%?,\s*(\d+)%?\)/.exec(hslColor);
    if (!m) return hslColor;
    const h = m[1];
    const s = m[2];
    const l = Math.min(90, parseInt(m[3], 10) + Math.round(amount * 100));
    return `hsl(${h}, ${s}%, ${l}%)`;
  }

  function render() {
    ctx.clearRect(0, 0, viewW, viewH);

    let sx = 0, sy = 0;
    if (state.shake > 0.05) {
      sx = (Math.random() - 0.5) * state.shake;
      sy = (Math.random() - 0.5) * state.shake;
      ctx.save();
      ctx.translate(sx, sy);
    }

    drawGround();

    for (let i = 0; i < state.stack.length; i++) {
      const b = state.stack[i];
      const y = baseY - i * BLOCK_HEIGHT + state.cameraY + BLOCK_HEIGHT;
      if (y < -BLOCK_HEIGHT || y > viewH + BLOCK_HEIGHT * 2) continue;
      drawBlock(b.x, y, b.width, BLOCK_HEIGHT, b.color, b.shadow);
    }

    for (const p of state.particles) {
      const y = baseY - p.level * BLOCK_HEIGHT + p.yOffset + state.cameraY + BLOCK_HEIGHT;
      ctx.save();
      ctx.translate(p.x, y - BLOCK_HEIGHT / 2);
      ctx.rotate(p.rot);
      ctx.translate(-p.x, -(y - BLOCK_HEIGHT / 2));
      drawBlock(p.x, y, p.width, BLOCK_HEIGHT, p.color, p.shadow);
      ctx.restore();
    }

    if (state.moving) {
      const y = baseY - state.moving.level * BLOCK_HEIGHT + state.cameraY + BLOCK_HEIGHT;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.008);
      const glowAlpha = 0.35 + pulse * 0.35;
      ctx.save();
      ctx.shadowColor = `rgba(255, 255, 255, ${glowAlpha})`;
      ctx.shadowBlur = 18;
      drawBlock(state.moving.x, y, state.moving.width, BLOCK_HEIGHT, state.moving.color, state.moving.shadow);
      ctx.restore();
    }

    for (const f of state.flashes) {
      const cy = f.y + state.cameraY + BLOCK_HEIGHT / 2;
      const a = Math.max(0, f.alpha);
      ctx.strokeStyle = `rgba(255, 220, 120, ${a})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(f.x, cy, f.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255, 255, 220, ${a * 0.7})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(f.x, cy, f.r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const s of state.sparkles) {
      const y = s.y + state.cameraY;
      const alpha = Math.max(0, Math.min(1, s.life));
      ctx.fillStyle = `hsla(${s.hue}, 95%, 78%, ${alpha})`;
      ctx.beginPath();
      ctx.arc(s.x, y, s.size * (0.6 + 0.4 * alpha), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsla(${s.hue}, 100%, 92%, ${alpha * 0.7})`;
      ctx.beginPath();
      ctx.arc(s.x, y, s.size * 0.4 * alpha, 0, Math.PI * 2);
      ctx.fill();
    }

    if (sx !== 0 || sy !== 0) {
      ctx.restore();
    }
  }

  function drawGround() {
    const groundY = baseY + state.cameraY + BLOCK_HEIGHT;
    const grad = ctx.createLinearGradient(0, groundY, 0, viewH);
    grad.addColorStop(0, "rgba(20, 26, 66, 0.0)");
    grad.addColorStop(1, "rgba(20, 26, 66, 0.7)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, groundY, viewW, viewH - groundY);

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(viewW, groundY);
    ctx.stroke();
  }

  let lastTime = 0;
  function loop(t) {
    const dt = Math.min(48, t - lastTime || 16);
    lastTime = t;
    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  function startGame() {
    startScreen.classList.add("hidden");
    gameOverScreen.classList.add("hidden");
    tapHint.classList.remove("hidden");
    resetState();
    state.running = true;
    setTimeout(() => tapHint.classList.add("hidden"), 2200);
  }

  function handleTap(e) {
    if (e.cancelable) e.preventDefault();
    ensureAudio();
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    if (!state.running) return;
    drop();
  }

  function startWithAudio() {
    ensureAudio();
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
    startGame();
  }

  startBtn.addEventListener("click", startWithAudio);
  retryBtn.addEventListener("click", startWithAudio);

  canvas.addEventListener("pointerdown", handleTap, { passive: false });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "Enter") {
      if (!state.running && !startScreen.classList.contains("hidden")) {
        startGame();
      } else if (!state.running && !gameOverScreen.classList.contains("hidden")) {
        startGame();
      } else {
        drop();
      }
      e.preventDefault();
    }
  });

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 200));
  document.addEventListener("touchmove", (e) => {
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  resize();
  loadBest();
  requestAnimationFrame(loop);
})();
