(function () {
  "use strict";

  const canvas = document.getElementById("wheel");
  const ctx = canvas.getContext("2d");
  const spinBtn = document.getElementById("spin-btn");
  const resultEl = document.getElementById("result");
  const listEl = document.getElementById("item-list");
  const addForm = document.getElementById("add-form");
  const itemInput = document.getElementById("item-input");
  const resetBtn = document.getElementById("reset-btn");
  const shuffleBtn = document.getElementById("shuffle-btn");
  const removeWinnerEl = document.getElementById("remove-winner");
  const winModal = document.getElementById("win-modal");
  const winTitle = document.getElementById("win-title");
  const winClose = document.getElementById("win-close");

  const STORAGE_KEY = "roulette-items-v1";
  const DEFAULT_ITEMS = ["ラーメン", "カレー", "寿司", "パスタ", "焼肉", "そば"];

  const PALETTE = [
    "#ff6b6b", "#ffcc4d", "#4dd4ac", "#4d9bff",
    "#b980ff", "#ff8fab", "#59c1bd", "#ffa94d",
    "#7bd88f", "#f36bc0", "#6bb6ff", "#ffd93d"
  ];

  let items = loadItems();
  let angle = 0;          // current rotation in radians
  let spinning = false;
  let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

  function loadItems() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const clean = parsed
            .map((s) => String(s).trim())
            .filter((s) => s.length > 0)
            .slice(0, 24);
          if (clean.length) return clean;
        }
      }
    } catch (e) { /* ignore */ }
    return DEFAULT_ITEMS.slice();
  }

  function saveItems() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (e) { /* ignore */ }
  }

  function colorFor(i) {
    return PALETTE[i % PALETTE.length];
  }

  /* ---------- Canvas sizing ---------- */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const size = Math.max(1, Math.round(rect.width));
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  /* ---------- Drawing ---------- */
  function draw() {
    const size = canvas.width / dpr;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2;

    ctx.clearRect(0, 0, size, size);

    if (items.length === 0) {
      ctx.fillStyle = "#232e52";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#94a0c8";
      ctx.font = "16px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("項目を追加してね", cx, cy);
      return;
    }

    const n = items.length;
    const seg = (Math.PI * 2) / n;

    for (let i = 0; i < n; i++) {
      const start = angle + i * seg;
      const end = start + seg;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, end);
      ctx.closePath();
      ctx.fillStyle = colorFor(i);
      ctx.fill();

      // Label
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(start + seg / 2);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(20, 26, 48, 0.9)";
      const fontSize = Math.max(11, Math.min(20, r * 0.11));
      ctx.font = "700 " + fontSize + "px sans-serif";
      const label = fitLabel(items[i], r * 0.72, ctx);
      ctx.fillText(label, r * 0.9, 0);
      ctx.restore();
    }

    // Hub ring
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.17, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(11, 16, 32, 0.15)";
    ctx.fill();
  }

  function fitLabel(text, maxWidth, context) {
    if (context.measureText(text).width <= maxWidth) return text;
    let s = text;
    while (s.length > 1 && context.measureText(s + "…").width > maxWidth) {
      s = s.slice(0, -1);
    }
    return s + "…";
  }

  /* ---------- Spin ---------- */
  function spin() {
    if (spinning || items.length < 2) {
      if (items.length < 2) flashResult("項目を2つ以上入れてね");
      return;
    }
    spinning = true;
    spinBtn.disabled = true;
    resultEl.textContent = "";

    const n = items.length;
    const seg = (Math.PI * 2) / n;
    const winner = Math.floor(Math.random() * n);

    // Pointer sits at top (-90deg). Find rotation so winner's center lands there.
    const pointerAngle = -Math.PI / 2;
    const targetCenter = winner * seg + seg / 2;
    // We want: (angle + targetCenter) ≡ pointerAngle (mod 2π)
    const base = angle % (Math.PI * 2);
    let delta = pointerAngle - targetCenter - base;
    delta = ((delta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const turns = 5 + Math.floor(Math.random() * 3); // 5-7 full turns
    const total = turns * Math.PI * 2 + delta;

    const startAngle = angle;
    const duration = 4200 + Math.random() * 800;
    const startTime = performance.now();

    function frame(now) {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      angle = startAngle + total * eased;
      draw();
      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        angle = (startAngle + total) % (Math.PI * 2);
        draw();
        finishSpin(winner);
      }
    }
    requestAnimationFrame(frame);
  }

  function finishSpin(winner) {
    spinning = false;
    spinBtn.disabled = false;
    const name = items[winner];
    resultEl.textContent = "▶ " + name;
    showModal(name);
    vibrate();

    if (removeWinnerEl.checked && items.length > 1) {
      items.splice(winner, 1);
      saveItems();
      renderList();
      draw();
    }
  }

  function vibrate() {
    if (navigator.vibrate) {
      try { navigator.vibrate([18, 40, 18]); } catch (e) { /* ignore */ }
    }
  }

  let flashTimer = null;
  function flashResult(msg) {
    resultEl.textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      if (resultEl.textContent === msg) resultEl.textContent = "";
    }, 2000);
  }

  /* ---------- Modal ---------- */
  function showModal(name) {
    winTitle.textContent = name;
    winModal.classList.remove("hidden");
  }
  function hideModal() {
    winModal.classList.add("hidden");
  }

  /* ---------- Item list ---------- */
  function renderList() {
    listEl.innerHTML = "";
    if (items.length === 0) {
      const li = document.createElement("li");
      li.className = "empty-hint";
      li.style.background = "transparent";
      li.textContent = "まだ項目がありません";
      listEl.appendChild(li);
      return;
    }
    items.forEach((name, i) => {
      const li = document.createElement("li");

      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = colorFor(i);

      const label = document.createElement("span");
      label.className = "name";
      label.textContent = name;

      const remove = document.createElement("button");
      remove.className = "remove";
      remove.type = "button";
      remove.setAttribute("aria-label", name + " を削除");
      remove.textContent = "×";
      remove.addEventListener("click", () => removeItem(i));

      li.appendChild(swatch);
      li.appendChild(label);
      li.appendChild(remove);
      listEl.appendChild(li);
    });
  }

  function addItem(name) {
    const clean = name.trim();
    if (!clean) return;
    if (items.length >= 24) {
      flashResult("項目は最大24個までです");
      return;
    }
    items.push(clean.slice(0, 24));
    saveItems();
    renderList();
    draw();
  }

  function removeItem(i) {
    items.splice(i, 1);
    saveItems();
    renderList();
    draw();
  }

  function shuffle() {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    saveItems();
    renderList();
    draw();
  }

  function reset() {
    items = DEFAULT_ITEMS.slice();
    saveItems();
    renderList();
    draw();
  }

  /* ---------- Events ---------- */
  spinBtn.addEventListener("click", spin);
  canvas.addEventListener("click", spin);

  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    addItem(itemInput.value);
    itemInput.value = "";
    itemInput.focus();
  });

  resetBtn.addEventListener("click", reset);
  shuffleBtn.addEventListener("click", shuffle);
  winClose.addEventListener("click", hideModal);
  winModal.addEventListener("click", (e) => {
    if (e.target === winModal) hideModal();
  });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  });

  /* ---------- Init ---------- */
  renderList();
  resize();
})();
