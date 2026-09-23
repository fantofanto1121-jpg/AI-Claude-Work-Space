/* =====================================================================
 * gfx.js  :  描画エンジン（手続き的ピクセルアート）
 *
 * 外部画像を一切使わず、canvas 2D で全グラフィックを生成する。
 * 公開API（world.js / battle.js / ui.js から利用）:
 *   Gfx.drawTile(ctx, ch, px, py, size, opts)
 *   Gfx.drawActor(ctx, styleId, px, py, size, opts{dir,frame,flip,tint})
 *   Gfx.drawEnemy(ctx, spriteId, px, py, size, opts{frame,hitFlash})
 *   Gfx.battleBackground(ctx, w, h, theme, t)
 *   Gfx.Particles  … 簡易パーティクル
 * ===================================================================== */

window.Game = window.Game || {};

Game.Gfx = (function () {
  'use strict';

  /* ---- 小道具 ---- */
  function rr(ctx, x, y, w, h, r, col) {
    ctx.fillStyle = col;
    if (r <= 0) { ctx.fillRect(x, y, w, h); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }
  function px(ctx, x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); }
  // 決定的な擬似乱数（タイルのゆらぎ用）
  function hash(x, y) {
    let n = (x * 374761393 + y * 668265263) ^ 0x5bd1e995;
    n = (n ^ (n >> 13)) * 1274126177;
    return ((n ^ (n >> 16)) >>> 0) / 4294967295;
  }

  /* ---- キャラのスタイル定義（procedural actor） ---- */
  // skin / hair / outfit / accent
  const ACTOR = {
    lio:       { skin: '#f2c9a0', hair: '#5a3a1a', out: '#3f7fd6', acc: '#f5e05a', cape: '#2b5aa0' },
    sena:      { skin: '#f6d3b0', hair: '#c85a86', out: '#7b4fb5', acc: '#ffd24a', cape: '#5a3892' },
    gord:      { skin: '#e6b58a', hair: '#7a7f88', out: '#8a9099', acc: '#d94f4f', cape: '#5a5f66' },
    elder:     { skin: '#e8c4a2', hair: '#eae6df', out: '#6a5a86', acc: '#c9a34a', cape: '#4a3f5f' },
    villager1: { skin: '#f0c49a', hair: '#4a3320', out: '#c98a3a', acc: '#8a5a2a', cape: null },
    villager2: { skin: '#f4cba2', hair: '#2a2a2a', out: '#4aa06a', acc: '#2a6a44', cape: null }
  };
  // battler は同じスタイルを使うが、大きく横向きに描く
  const BATTLER = { lio_b: 'lio', sena_b: 'sena', gord_b: 'gord' };

  /* ---- タイル描画 ---- */
  const GRASS = ['#3b7a3b', '#41863f', '#357036'];
  function drawTile(ctx, ch, x, y, s, opts) {
    opts = opts || {};
    const gx = opts.gx || 0, gy = opts.gy || 0; // グリッド座標（ゆらぎ用）
    const v = hash(gx, gy);
    switch (ch) {
      case '.': case ',': case 'P': case 'B': case 'F': case 'r': case 'x':
      case 'S': case 'D': case 'C': case 'A':
        // まず下地
        drawGround(ctx, ch, x, y, s, v, gx, gy);
        drawOverlay(ctx, ch, x, y, s, v);
        break;
      case 'T': drawGround(ctx, '.', x, y, s, v, gx, gy); drawTree(ctx, x, y, s, v); break;
      case '%': drawGround(ctx, '.', x, y, s, v, gx, gy); drawBush(ctx, x, y, s, v); break;
      case 'W': case '~': drawWater(ctx, ch, x, y, s, v); break;
      case '#': drawRock(ctx, x, y, s, v); break;
      case 'H': drawHouseWall(ctx, x, y, s, v); break;
      case '=': drawGround(ctx, '.', x, y, s, v, gx, gy); drawFence(ctx, x, y, s); break;
      case '+': drawGround(ctx, '.', x, y, s, v, gx, gy); drawFlowerBed(ctx, x, y, s, v); break;
      case '*': drawStarStone(ctx, x, y, s, v); break;
      case 'o': drawGround(ctx, 'r', x, y, s, v, gx, gy); drawPillar(ctx, x, y, s); break;
      default: drawGround(ctx, '.', x, y, s, v, gx, gy);
    }
  }

  function drawGround(ctx, ch, x, y, s, v, gx, gy) {
    let base;
    if (ch === 'P' || ch === 'S' || ch === 'D' || ch === 'B') base = '#9a7a4a';
    else if (ch === 'F') base = '#8a6f52';
    else if (ch === 'r' || ch === 'C' || ch === 'A' || ch === 'o') base = '#6b6f78';
    else if (ch === 'x') base = '#3a3550';
    else base = GRASS[Math.floor(v * GRASS.length)]; // 草
    px(ctx, x, y, s, s, base);
    // 質感の点
    ctx.globalAlpha = 0.18;
    const n = 3;
    for (let i = 0; i < n; i++) {
      const hv = hash(gx * 7 + i, gy * 13 + i);
      const dx = Math.floor(hv * (s - 2)) + 1;
      const dy = Math.floor(hash(gx * 3 + i, gy * 5 + i) * (s - 2)) + 1;
      ctx.fillStyle = i % 2 ? '#ffffff' : '#000000';
      ctx.fillRect(x + dx, y + dy, Math.max(1, s / 8), Math.max(1, s / 8));
    }
    ctx.globalAlpha = 1;
  }

  function drawOverlay(ctx, ch, x, y, s, v) {
    if (ch === ',') { // 花
      const cols = ['#ffe14a', '#ff7ba8', '#7ac6ff'];
      ctx.fillStyle = cols[Math.floor(v * 3)];
      ctx.fillRect(x + s * 0.3, y + s * 0.3, s * 0.16, s * 0.16);
      ctx.fillRect(x + s * 0.6, y + s * 0.55, s * 0.16, s * 0.16);
    } else if (ch === 'S') { // 出口（下向き矢印の光）
      ctx.fillStyle = 'rgba(255,240,150,0.55)';
      ctx.fillRect(x + s * 0.35, y + s * 0.2, s * 0.3, s * 0.6);
    } else if (ch === 'D') { // 扉
      px(ctx, x + s * 0.2, y + s * 0.1, s * 0.6, s * 0.85, '#5a3a1a');
      px(ctx, x + s * 0.28, y + s * 0.2, s * 0.44, s * 0.7, '#7a5228');
      px(ctx, x + s * 0.6, y + s * 0.5, s * 0.1, s * 0.1, '#ffd24a');
    } else if (ch === 'C') { // 宝箱
      px(ctx, x + s * 0.18, y + s * 0.4, s * 0.64, s * 0.42, '#7a4a1a');
      px(ctx, x + s * 0.18, y + s * 0.3, s * 0.64, s * 0.16, '#a86a2a');
      px(ctx, x + s * 0.46, y + s * 0.42, s * 0.08, s * 0.18, '#ffd24a');
    } else if (ch === 'A') { // 祭壇
      px(ctx, x + s * 0.15, y + s * 0.25, s * 0.7, s * 0.6, '#4b4f5f');
      px(ctx, x + s * 0.3, y + s * 0.15, s * 0.4, s * 0.2, '#7a7fa0');
      ctx.fillStyle = 'rgba(150,180,255,0.5)';
      ctx.fillRect(x + s * 0.4, y + s * 0.05, s * 0.2, s * 0.4);
    } else if (ch === 'B') { // 橋の板目
      ctx.strokeStyle = 'rgba(60,40,20,0.5)';
      ctx.lineWidth = Math.max(1, s / 16);
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x, y + s * i / 4); ctx.lineTo(x + s, y + s * i / 4); ctx.stroke(); }
    }
  }

  function drawTree(ctx, x, y, s, v) {
    px(ctx, x + s * 0.42, y + s * 0.55, s * 0.16, s * 0.4, '#5a3a1a');
    const g1 = '#276b2a', g2 = '#358a34';
    ctx.fillStyle = g1;
    ctx.beginPath(); ctx.arc(x + s * 0.5, y + s * 0.42, s * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.arc(x + s * 0.4, y + s * 0.36, s * 0.26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.arc(x + s * 0.36, y + s * 0.3, s * 0.12, 0, Math.PI * 2); ctx.fill();
  }
  function drawBush(ctx, x, y, s) {
    ctx.fillStyle = '#2f6a30';
    ctx.beginPath(); ctx.arc(x + s * 0.35, y + s * 0.6, s * 0.24, 0, Math.PI * 2);
    ctx.arc(x + s * 0.6, y + s * 0.55, s * 0.26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3f8a3f';
    ctx.beginPath(); ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.2, 0, Math.PI * 2); ctx.fill();
  }
  function drawWater(ctx, ch, x, y, s, v) {
    px(ctx, x, y, s, s, ch === '~' ? '#0d1030' : '#2a5aa8');
    ctx.fillStyle = ch === '~' ? 'rgba(90,110,200,0.35)' : 'rgba(160,200,255,0.4)';
    const yy = y + s * (0.3 + 0.4 * v);
    ctx.fillRect(x + 1, yy, s - 2, Math.max(1, s / 10));
    ctx.fillRect(x + s * 0.3, yy + s * 0.3, s * 0.4, Math.max(1, s / 12));
  }
  function drawRock(ctx, x, y, s, v) {
    px(ctx, x, y, s, s, '#4a4f58');
    px(ctx, x, y, s, s * 0.28, '#5a606b');
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x, y + s * 0.72, s, s * 0.28);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x + s * 0.15, y + s * 0.1, s * 0.2, s * 0.12);
  }
  function drawHouseWall(ctx, x, y, s, v) {
    px(ctx, x, y, s, s, '#b98a5a');
    ctx.strokeStyle = 'rgba(90,60,30,0.4)';
    ctx.lineWidth = Math.max(1, s / 16);
    ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
    px(ctx, x, y, s, s * 0.2, '#8a5a2a'); // 屋根の陰
  }
  function drawFence(ctx, x, y, s) {
    px(ctx, x + s * 0.1, y + s * 0.3, s * 0.8, s * 0.12, '#8a6a3a');
    px(ctx, x + s * 0.2, y + s * 0.25, s * 0.12, s * 0.5, '#a07a44');
    px(ctx, x + s * 0.68, y + s * 0.25, s * 0.12, s * 0.5, '#a07a44');
  }
  function drawFlowerBed(ctx, x, y, s, v) {
    px(ctx, x + s * 0.1, y + s * 0.1, s * 0.8, s * 0.8, '#5a3a1a');
    const cols = ['#ff6a8a', '#ffd24a', '#7ab8ff'];
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = cols[(i + Math.floor(v * 3)) % 3];
      ctx.beginPath();
      ctx.arc(x + s * (0.3 + (i % 2) * 0.4), y + s * (0.3 + Math.floor(i / 2) * 0.4), s * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  function drawStarStone(ctx, x, y, s, v) {
    px(ctx, x, y, s, s, '#241f3a');
    ctx.fillStyle = 'rgba(150,180,255,' + (0.5 + 0.3 * Math.sin(v * 6.28)) + ')';
    star(ctx, x + s / 2, y + s / 2, s * 0.3, s * 0.13, 4);
  }
  function drawPillar(ctx, x, y, s) {
    px(ctx, x + s * 0.28, y + s * 0.05, s * 0.44, s * 0.9, '#8a8f9a');
    px(ctx, x + s * 0.22, y, s * 0.56, s * 0.14, '#a0a5b0');
    px(ctx, x + s * 0.22, y + s * 0.86, s * 0.56, s * 0.14, '#a0a5b0');
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(x + s * 0.6, y + s * 0.05, s * 0.12, s * 0.9);
  }
  function star(ctx, cx, cy, R, r, spikes) {
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const ang = (Math.PI * i) / spikes - Math.PI / 2;
      const rad = i % 2 ? r : R;
      ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad);
    }
    ctx.closePath(); ctx.fill();
  }

  /* ---- キャラ（procedural actor）---- */
  // dir: 'down'|'up'|'left'|'right' ; frame: 0|1 ; size: 描画高さ(px)
  function drawActor(ctx, styleId, x, y, s, opts) {
    opts = opts || {};
    const st = ACTOR[styleId] || (BATTLER[styleId] && ACTOR[BATTLER[styleId]]) || ACTOR.lio;
    const dir = opts.dir || 'down';
    const frame = opts.frame || 0;
    const flip = !!opts.flip;
    const u = s / 16; // 単位
    ctx.save();
    if (flip) { ctx.translate(x + s, y); ctx.scale(-1, 1); ctx.translate(-x, -y); }
    if (opts.tint) { ctx.globalAlpha = 1; }

    // 影
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(x + s / 2, y + s - u * 1.2, s * 0.32, u * 1.4, 0, 0, Math.PI * 2);
    ctx.fill();

    const legSwing = frame === 1 ? u : 0;
    // 脚
    px(ctx, x + u * 5, y + u * 12 - legSwing, u * 2, u * 3 + legSwing, '#333');
    px(ctx, x + u * 9, y + u * 12 + (frame === 1 ? 0 : 0) , u * 2, u * 3 + (u - legSwing), '#333');
    // 胴（マント）
    if (st.cape && dir !== 'up') {
      px(ctx, x + u * 3.5, y + u * 6.5, u * 9, u * 6, st.cape);
    }
    // 胴
    px(ctx, x + u * 4, y + u * 6, u * 8, u * 6.5, st.out);
    px(ctx, x + u * 4, y + u * 6, u * 8, u * 1.4, st.acc); // 肩章/帯
    // 腕
    px(ctx, x + u * 3, y + u * 7, u * 1.6, u * 4, st.out);
    px(ctx, x + u * 11.4, y + u * 7, u * 1.6, u * 4, st.out);
    // 頭
    px(ctx, x + u * 4.5, y + u * 1.5, u * 7, u * 5, st.skin);
    // 髪
    px(ctx, x + u * 4, y + u * 0.8, u * 8, u * 2.4, st.hair);
    px(ctx, x + u * 4, y + u * 1.2, u * 1.6, u * 3.5, st.hair);
    px(ctx, x + u * 10.4, y + u * 1.2, u * 1.6, u * 3.5, st.hair);
    // 顔（向き）
    if (dir !== 'up') {
      ctx.fillStyle = '#2a2018';
      if (dir === 'left') { px(ctx, x + u * 5.4, y + u * 3.4, u * 1.2, u * 1.2, '#2a2018'); }
      else if (dir === 'right') { px(ctx, x + u * 9.4, y + u * 3.4, u * 1.2, u * 1.2, '#2a2018'); }
      else {
        px(ctx, x + u * 5.6, y + u * 3.4, u * 1.1, u * 1.2, '#2a2018');
        px(ctx, x + u * 9.2, y + u * 3.4, u * 1.1, u * 1.2, '#2a2018');
      }
    }
    ctx.restore();
    if (opts.tint) {
      ctx.save(); ctx.globalAlpha = opts.tintA != null ? opts.tintA : 0.5;
      ctx.fillStyle = opts.tint; ctx.fillRect(x, y, s, s); ctx.restore();
    }
  }

  /* ---- 敵 ---- */
  function drawEnemy(ctx, sprite, x, y, s, opts) {
    opts = opts || {};
    const bob = Math.sin((opts.t || 0) * 3) * s * 0.02;
    y += bob;
    ctx.save();
    if (opts.hitFlash) { ctx.globalAlpha = 0.85; }
    switch (sprite) {
      case 'slime': eSlime(ctx, x, y, s, opts); break;
      case 'bat': eBat(ctx, x, y, s, opts); break;
      case 'wolf': eWolf(ctx, x, y, s, opts); break;
      case 'wisp': eWisp(ctx, x, y, s, opts); break;
      case 'golem': eGolem(ctx, x, y, s, opts); break;
      case 'shade': eShade(ctx, x, y, s, opts); break;
      case 'warden': eWarden(ctx, x, y, s, opts); break;
      case 'nox': eNox(ctx, x, y, s, opts); break;
      default: eSlime(ctx, x, y, s, opts);
    }
    ctx.restore();
    if (opts.hitFlash) {
      ctx.save(); ctx.globalAlpha = 0.6; ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, s, s); ctx.restore();
    }
  }
  function shadow(ctx, x, y, s) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x + s / 2, y + s * 0.94, s * 0.34, s * 0.08, 0, 0, Math.PI * 2); ctx.fill();
  }
  function eSlime(ctx, x, y, s) {
    shadow(ctx, x, y, s);
    ctx.fillStyle = '#3a3a6a';
    ctx.beginPath(); ctx.ellipse(x + s / 2, y + s * 0.62, s * 0.36, s * 0.32, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(120,120,200,0.4)';
    ctx.beginPath(); ctx.ellipse(x + s * 0.4, y + s * 0.5, s * 0.12, s * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    px(ctx, x + s * 0.38, y + s * 0.58, s * 0.06, s * 0.08, '#fff');
    px(ctx, x + s * 0.56, y + s * 0.58, s * 0.06, s * 0.08, '#fff');
  }
  function eBat(ctx, x, y, s, o) {
    shadow(ctx, x, y, s);
    const flap = Math.sin((o.t || 0) * 8) * s * 0.1;
    ctx.fillStyle = '#5a3a6a';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.5, y + s * 0.45);
    ctx.lineTo(x + s * 0.05, y + s * 0.3 + flap);
    ctx.lineTo(x + s * 0.2, y + s * 0.55);
    ctx.lineTo(x + s * 0.5, y + s * 0.6);
    ctx.lineTo(x + s * 0.8, y + s * 0.55);
    ctx.lineTo(x + s * 0.95, y + s * 0.3 + flap);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3a2444';
    ctx.beginPath(); ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.13, 0, Math.PI * 2); ctx.fill();
    px(ctx, x + s * 0.44, y + s * 0.46, s * 0.05, s * 0.05, '#ffde4a');
    px(ctx, x + s * 0.52, y + s * 0.46, s * 0.05, s * 0.05, '#ffde4a');
  }
  function eWolf(ctx, x, y, s) {
    shadow(ctx, x, y, s);
    ctx.fillStyle = '#3f4450';
    ctx.beginPath(); ctx.ellipse(x + s * 0.5, y + s * 0.6, s * 0.34, s * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    px(ctx, x + s * 0.62, y + s * 0.3, s * 0.26, s * 0.24, '#3f4450'); // 頭
    ctx.fillStyle = '#2a2e38';
    ctx.beginPath(); ctx.moveTo(x + s * 0.64, y + s * 0.3); ctx.lineTo(x + s * 0.68, y + s * 0.18); ctx.lineTo(x + s * 0.72, y + s * 0.3); ctx.fill();
    px(ctx, x + s * 0.78, y + s * 0.38, s * 0.05, s * 0.05, '#ff5a4a');
    // 脚
    px(ctx, x + s * 0.3, y + s * 0.72, s * 0.06, s * 0.18, '#2a2e38');
    px(ctx, x + s * 0.6, y + s * 0.72, s * 0.06, s * 0.18, '#2a2e38');
  }
  function eWisp(ctx, x, y, s, o) {
    const g = ctx.createRadialGradient(x + s / 2, y + s / 2, 1, x + s / 2, y + s / 2, s * 0.4);
    g.addColorStop(0, 'rgba(180,150,255,0.95)');
    g.addColorStop(0.5, 'rgba(120,90,220,0.6)');
    g.addColorStop(1, 'rgba(60,40,120,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x + s / 2, y + s * 0.45, s * 0.08, 0, Math.PI * 2); ctx.fill();
  }
  function eGolem(ctx, x, y, s) {
    shadow(ctx, x, y, s);
    px(ctx, x + s * 0.22, y + s * 0.25, s * 0.56, s * 0.55, '#6b6f78');
    px(ctx, x + s * 0.3, y + s * 0.08, s * 0.4, s * 0.28, '#7a7f88');
    px(ctx, x + s * 0.1, y + s * 0.3, s * 0.16, s * 0.4, '#5a5f66');
    px(ctx, x + s * 0.74, y + s * 0.3, s * 0.16, s * 0.4, '#5a5f66');
    px(ctx, x + s * 0.38, y + s * 0.16, s * 0.08, s * 0.08, '#7ad6ff');
    px(ctx, x + s * 0.54, y + s * 0.16, s * 0.08, s * 0.08, '#7ad6ff');
    ctx.strokeStyle = 'rgba(120,220,255,0.4)'; ctx.lineWidth = s / 24;
    ctx.strokeRect(x + s * 0.3, y + s * 0.36, s * 0.4, s * 0.36);
  }
  function eShade(ctx, x, y, s, o) {
    const sway = Math.sin((o.t || 0) * 2) * s * 0.04;
    ctx.fillStyle = 'rgba(20,10,40,0.9)';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.5, y + s * 0.05);
    ctx.quadraticCurveTo(x + s * 0.9 + sway, y + s * 0.5, x + s * 0.7, y + s * 0.95);
    ctx.lineTo(x + s * 0.3, y + s * 0.95);
    ctx.quadraticCurveTo(x + s * 0.1 - sway, y + s * 0.5, x + s * 0.5, y + s * 0.05);
    ctx.fill();
    ctx.fillStyle = '#b46aff';
    ctx.beginPath(); ctx.arc(x + s * 0.42, y + s * 0.4, s * 0.05, 0, Math.PI * 2);
    ctx.arc(x + s * 0.58, y + s * 0.4, s * 0.05, 0, Math.PI * 2); ctx.fill();
  }
  function eWarden(ctx, x, y, s) {
    shadow(ctx, x, y, s);
    px(ctx, x + s * 0.2, y + s * 0.2, s * 0.6, s * 0.6, '#5a606b');
    px(ctx, x + s * 0.28, y + s * 0.05, s * 0.44, s * 0.28, '#6b727e');
    px(ctx, x + s * 0.05, y + s * 0.28, s * 0.16, s * 0.5, '#4a4f58');
    px(ctx, x + s * 0.79, y + s * 0.28, s * 0.16, s * 0.5, '#4a4f58');
    ctx.fillStyle = '#ff8a3a';
    px(ctx, x + s * 0.34, y + s * 0.14, s * 0.1, s * 0.1, '#ff8a3a');
    px(ctx, x + s * 0.56, y + s * 0.14, s * 0.1, s * 0.1, '#ff8a3a');
    ctx.strokeStyle = 'rgba(255,160,80,0.5)'; ctx.lineWidth = s / 20;
    ctx.strokeRect(x + s * 0.28, y + s * 0.34, s * 0.44, s * 0.4);
  }
  function eNox(ctx, x, y, s, o) {
    const t = o.t || 0;
    // 闇のオーラ
    const g = ctx.createRadialGradient(x + s / 2, y + s / 2, s * 0.1, x + s / 2, y + s / 2, s * 0.55);
    g.addColorStop(0, 'rgba(80,20,120,0.5)');
    g.addColorStop(1, 'rgba(10,0,20,0)');
    ctx.fillStyle = g; ctx.fillRect(x - s * 0.1, y - s * 0.1, s * 1.2, s * 1.2);
    // 本体
    ctx.fillStyle = '#160a24';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.5, y + s * 0.02);
    ctx.quadraticCurveTo(x + s * 1.0, y + s * 0.5, x + s * 0.72, y + s * 0.98);
    ctx.lineTo(x + s * 0.28, y + s * 0.98);
    ctx.quadraticCurveTo(x + s * 0.0, y + s * 0.5, x + s * 0.5, y + s * 0.02);
    ctx.fill();
    // 王冠の星
    ctx.fillStyle = 'rgba(180,120,255,0.9)';
    star(ctx, x + s * 0.5, y + s * 0.16, s * 0.12, s * 0.05, 5);
    // 眼
    const glow = 0.6 + 0.4 * Math.sin(t * 4);
    ctx.fillStyle = 'rgba(255,60,120,' + glow + ')';
    ctx.beginPath(); ctx.arc(x + s * 0.4, y + s * 0.42, s * 0.06, 0, Math.PI * 2);
    ctx.arc(x + s * 0.6, y + s * 0.42, s * 0.06, 0, Math.PI * 2); ctx.fill();
    // 手（闇の触手）
    ctx.strokeStyle = 'rgba(60,20,90,0.8)'; ctx.lineWidth = s / 14; ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i += 2) {
      ctx.beginPath();
      ctx.moveTo(x + s * 0.5, y + s * 0.6);
      ctx.quadraticCurveTo(x + s * (0.5 + i * 0.5), y + s * (0.6 + 0.1 * Math.sin(t * 3)),
        x + s * (0.5 + i * 0.4), y + s * 0.95);
      ctx.stroke();
    }
  }

  /* ---- バトル背景 ---- */
  function battleBackground(ctx, w, h, theme, t) {
    let top, bot;
    if (theme === 'dungeon') { top = '#241f3a'; bot = '#0c0a18'; }
    else if (theme === 'town') { top = '#3a4a7a'; bot = '#12203a'; }
    else { top = '#2a4a3a'; bot = '#0e2018'; } // field
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, top); g.addColorStop(1, bot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // 星
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 40; i++) {
      const sx = (i * 97) % w, sy = (i * 53) % (h * 0.6);
      const a = 0.3 + 0.5 * Math.abs(Math.sin(t * 2 + i));
      ctx.globalAlpha = a;
      ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.globalAlpha = 1;
    // 地面
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.86, w * 0.6, h * 0.14, 0, 0, Math.PI * 2); ctx.fill();
  }

  /* ---- パーティクル ---- */
  function Particles() { this.list = []; }
  Particles.prototype.spawn = function (opt) {
    const n = opt.count || 12;
    for (let i = 0; i < n; i++) {
      const a = (opt.angle != null ? opt.angle : Math.random() * Math.PI * 2) +
        (Math.random() - 0.5) * (opt.spread != null ? opt.spread : Math.PI * 2);
      const sp = (opt.speed || 80) * (0.5 + Math.random());
      this.list.push({
        x: opt.x, y: opt.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opt.lift || 0),
        life: opt.life || 0.6, max: opt.life || 0.6,
        col: Array.isArray(opt.col) ? opt.col[i % opt.col.length] : (opt.col || '#fff'),
        size: opt.size || 4, grav: opt.grav != null ? opt.grav : 120
      });
    }
  };
  Particles.prototype.update = function (dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt; if (p.life <= 0) { this.list.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt;
    }
  };
  Particles.prototype.draw = function (ctx) {
    for (const p of this.list) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  };
  Particles.prototype.count = function () { return this.list.length; };

  return {
    drawTile, drawActor, drawEnemy, battleBackground, star,
    Particles, ACTOR, BATTLER, px, rr
  };
})();
