/* =====================================================================
 * gfx.js  :  描画エンジン（手続き的ピクセルアート）
 *
 * 外部画像を一切使わず、canvas 2D で全グラフィックを生成する。
 * 公開API（world.js / battle.js / ui.js から利用）:
 *   Gfx.drawTile(ctx, ch, px, py, size, opts{gx,gy})
 *   Gfx.drawActor(ctx, styleId, px, py, size, opts{dir,frame,flip,tint,tintA})
 *   Gfx.drawEnemy(ctx, spriteId, px, py, size, opts{t,hitFlash})
 *   Gfx.battleBackground(ctx, w, h, theme, t)
 *   Gfx.star(ctx, cx, cy, R, r, spikes)
 *   Gfx.Particles  … 簡易パーティクル
 *   Gfx.ACTOR / Gfx.BATTLER / Gfx.px / Gfx.rr
 * ===================================================================== */

window.Game = window.Game || {};

Game.Gfx = (function () {
  'use strict';

  /* ---- 小道具（公開ヘルパ：シグネチャ維持） ---- */
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
  // 追加ストリーム
  function hs(x, y, seed) { return hash(x * 131 + seed * 977, y * 197 - seed * 313); }

  // hex 明暗（rgb文字列を返す）。amt: -1(暗)〜+1(明)
  function shade(hex, amt) {
    let r, g, b;
    if (hex[0] === '#') {
      const c = parseInt(hex.slice(1), 16);
      r = (c >> 16) & 255; g = (c >> 8) & 255; b = c & 255;
    } else { r = 128; g = 128; b = 128; }
    if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { r *= (1 + amt); g *= (1 + amt); b *= (1 + amt); }
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }

  /* ---- キャラのスタイル定義（procedural actor） ---- */
  // skin / hair / out(衣) / acc(装飾) / cape / role / pants / boots
  const ACTOR = {
    lio:       { skin: '#f3caa2', hair: '#5a3a1a', out: '#3f7fd6', acc: '#ffd85a', cape: '#c94a4a', role: 'hero',    pants: '#2b4f8a', boots: '#3a2a18' },
    sena:      { skin: '#f7d5b2', hair: '#d95f8f', out: '#7b4fb5', acc: '#ffd24a', cape: '#5a3892', role: 'mage',    pants: '#4a2f7a', boots: '#3a2444' },
    gord:      { skin: '#e6b58a', hair: '#7a7f88', out: '#9aa2ae', acc: '#d94f4f', cape: '#4a5560', role: 'knight',  pants: '#5a616c', boots: '#3a3f48' },
    elder:     { skin: '#ecc9a8', hair: '#efe9e0', out: '#5a4d80', acc: '#e0bc5a', cape: '#40355c', role: 'elder',   pants: '#463a63', boots: '#33304a' },
    villager1: { skin: '#f1c69c', hair: '#4a3320', out: '#c98a3a', acc: '#8a5a2a', cape: null,      role: 'villager',pants: '#7a5a2e', boots: '#4a3220' },
    villager2: { skin: '#f5cda4', hair: '#2a2a2a', out: '#4aa06a', acc: '#2a6a44', cape: null,      role: 'child',   pants: '#2f7a4e', boots: '#274a30' }
  };
  // battler は同じスタイルを使う（横向き大サイズで描く）
  const BATTLER = { lio_b: 'lio', sena_b: 'sena', gord_b: 'gord' };

  /* ---- タイル：色パレット（ホットパスで生成しないよう定数化） ---- */
  const GRASS   = ['#3f7d3a', '#478a3f', '#376f33', '#4b9345'];
  const GRASS_L = ['#5aa64f', '#63b356', '#4f9646', '#6cbb5e'];
  const GRASS_D = ['#2c5f2b', '#2f6630', '#274f26', '#356b31'];

  /* ---- タイル描画 ---- */
  function drawTile(ctx, ch, x, y, s, opts) {
    opts = opts || {};
    const gx = opts.gx || 0, gy = opts.gy || 0;
    const v = hash(gx, gy);
    switch (ch) {
      case '.': case ',': case 'P': case 'B': case 'F': case 'r': case 'x':
      case 'S': case 'D': case 'C': case 'A':
        drawGround(ctx, ch, x, y, s, v, gx, gy);
        drawOverlay(ctx, ch, x, y, s, v, gx, gy);
        break;
      case 'T': drawGround(ctx, '.', x, y, s, v, gx, gy); drawTree(ctx, x, y, s, v, gx, gy); break;
      case '%': drawGround(ctx, '.', x, y, s, v, gx, gy); drawBush(ctx, x, y, s, v); break;
      case 'W': case '~': drawWater(ctx, ch, x, y, s, v, gx, gy); break;
      case '#': drawRock(ctx, x, y, s, v, gx, gy); break;
      case 'H': drawHouseWall(ctx, x, y, s, v, gx, gy); break;
      case '=': drawGround(ctx, '.', x, y, s, v, gx, gy); drawFence(ctx, x, y, s); break;
      case '+': drawGround(ctx, '.', x, y, s, v, gx, gy); drawFlowerBed(ctx, x, y, s, v); break;
      case '*': drawStarStone(ctx, x, y, s, v, gx, gy); break;
      case 'o': drawGround(ctx, 'r', x, y, s, v, gx, gy); drawPillar(ctx, x, y, s, v); break;
      default: drawGround(ctx, '.', x, y, s, v, gx, gy);
    }
  }

  function drawGround(ctx, ch, x, y, s, v, gx, gy) {
    const i4 = ((gx * 3 + gy * 5) % 4 + 4) % 4;
    if (ch === 'P' || ch === 'S' || ch === 'D' || ch === 'B') { drawDirt(ctx, x, y, s, v, gx, gy); return; }
    if (ch === 'F') { drawWoodFloor(ctx, x, y, s, gx, gy); return; }
    if (ch === 'r' || ch === 'C' || ch === 'A' || ch === 'o') { drawRuinFloor(ctx, x, y, s, v, gx, gy); return; }
    if (ch === 'x') { drawSpireFloor(ctx, x, y, s, v, gx, gy); return; }
    // 草地
    px(ctx, x, y, s, s, GRASS[i4]);
    // 明暗の草むら（決定的）
    const blades = 3;
    for (let k = 0; k < blades; k++) {
      const hx = hs(gx, gy, k + 1), hy = hs(gy, gx, k + 7);
      const bx = x + Math.floor(hx * (s - 3)) + 1;
      const by = y + Math.floor(hy * (s - 4)) + 2;
      const bw = Math.max(1, s * 0.10);
      ctx.fillStyle = (k === 0) ? GRASS_D[i4] : GRASS_L[i4];
      ctx.fillRect(bx, by, bw, Math.max(2, s * 0.22));
    }
    // 微細な明点（ハイライト）
    ctx.fillStyle = GRASS_L[i4];
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x + s * 0.15, y + s * 0.15, Math.max(1, s / 10), Math.max(1, s / 10));
    ctx.globalAlpha = 1;
  }

  function drawDirt(ctx, x, y, s, v, gx, gy) {
    px(ctx, x, y, s, s, '#8f6f42');
    // 上側にわずかな明帯（踏み固めた道の照り）
    px(ctx, x, y, s, Math.max(1, s * 0.16), '#a2814f');
    // 小石・くぼみ
    for (let k = 0; k < 3; k++) {
      const hx = hs(gx, gy, k + 2), hy = hs(gy, gx, k + 5);
      const dx = x + Math.floor(hx * (s - 3)) + 1;
      const dy = y + Math.floor(hy * (s - 3)) + 1;
      const sz = Math.max(1, s * (0.08 + hx * 0.06));
      ctx.fillStyle = k === 0 ? 'rgba(60,44,24,0.5)' : 'rgba(200,175,130,0.55)';
      ctx.fillRect(dx, dy, sz, sz);
    }
    // 下辺のわずかな陰
    ctx.fillStyle = 'rgba(50,36,18,0.28)';
    ctx.fillRect(x, y + s - Math.max(1, s * 0.12), s, Math.max(1, s * 0.12));
  }

  function drawWoodFloor(ctx, x, y, s, gx, gy) {
    px(ctx, x, y, s, s, (gy % 2 === 0) ? '#8a6f52' : '#7f6549');
    // 板の継ぎ目
    ctx.fillStyle = 'rgba(40,26,14,0.4)';
    ctx.fillRect(x, y + s - Math.max(1, s / 14), s, Math.max(1, s / 14));
    const seam = ((gx + gy) % 2) ? s * 0.5 : s * 0.5;
    ctx.fillRect(x + Math.round(seam), y, Math.max(1, s / 16), s);
    // 木目
    ctx.fillStyle = 'rgba(255,235,200,0.10)';
    ctx.fillRect(x, y + s * 0.35, s, Math.max(1, s / 20));
  }

  function drawRuinFloor(ctx, x, y, s, v, gx, gy) {
    const base = (gx + gy) % 2 ? '#5c616b' : '#565b64';
    px(ctx, x, y, s, s, base);
    // 目地（タイルの繋がり）
    ctx.fillStyle = 'rgba(20,22,30,0.55)';
    ctx.fillRect(x, y, s, Math.max(1, s / 14));
    ctx.fillRect(x, y, Math.max(1, s / 14), s);
    // 面取りハイライト
    ctx.fillStyle = 'rgba(150,158,172,0.35)';
    ctx.fillRect(x + Math.max(1, s / 14), y + Math.max(1, s / 14), s * 0.5, Math.max(1, s / 16));
    // ひび / 苔（決定的にたまに）
    if (v > 0.7) {
      ctx.strokeStyle = 'rgba(20,22,30,0.5)'; ctx.lineWidth = Math.max(1, s / 18);
      ctx.beginPath();
      ctx.moveTo(x + s * 0.2, y + s * 0.3);
      ctx.lineTo(x + s * 0.45, y + s * 0.55);
      ctx.lineTo(x + s * 0.4, y + s * 0.8);
      ctx.stroke();
    } else if (v < 0.16) {
      ctx.fillStyle = 'rgba(70,120,70,0.35)';
      ctx.fillRect(x + s * 0.55, y + s * 0.6, s * 0.22, s * 0.14);
    }
  }

  function drawSpireFloor(ctx, x, y, s, v, gx, gy) {
    px(ctx, x, y, s, s, (gx + gy) % 2 ? '#332d4d' : '#2d2845');
    // 目地
    ctx.fillStyle = 'rgba(10,8,20,0.6)';
    ctx.fillRect(x, y, s, Math.max(1, s / 14));
    ctx.fillRect(x, y, Math.max(1, s / 14), s);
    // 秘紋のかすかな光（決定的）
    const glow = 0.10 + 0.14 * v;
    ctx.fillStyle = 'rgba(150,120,255,' + glow.toFixed(3) + ')';
    ctx.fillRect(x + s * 0.4, y + s * 0.4, s * 0.2, s * 0.2);
    if (v > 0.82) {
      ctx.fillStyle = 'rgba(180,160,255,0.5)';
      star(ctx, x + s * 0.5, y + s * 0.5, s * 0.16, s * 0.06, 4);
    }
  }

  function drawOverlay(ctx, ch, x, y, s, v, gx, gy) {
    if (ch === ',') { // 花
      const cols = [['#ffe14a', '#fff2a0'], ['#ff7ba8', '#ffd0e0'], ['#7ac6ff', '#d0ecff']];
      const c = cols[Math.floor(v * 3)];
      flower(ctx, x + s * 0.34, y + s * 0.36, s * 0.11, c[0], c[1]);
      flower(ctx, x + s * 0.64, y + s * 0.62, s * 0.10, c[0], c[1]);
    } else if (ch === 'S') { // 出口の光柱
      const g = ctx.createLinearGradient(0, y, 0, y + s);
      g.addColorStop(0, 'rgba(255,244,170,0.65)');
      g.addColorStop(1, 'rgba(255,244,170,0.05)');
      ctx.fillStyle = g;
      ctx.fillRect(x + s * 0.28, y, s * 0.44, s);
      ctx.fillStyle = 'rgba(255,255,210,0.8)';
      star(ctx, x + s * 0.5, y + s * 0.3, s * 0.14, s * 0.05, 4);
    } else if (ch === 'D') { // 扉
      px(ctx, x + s * 0.18, y + s * 0.06, s * 0.64, s * 0.9, '#4a2f16');
      px(ctx, x + s * 0.24, y + s * 0.12, s * 0.52, s * 0.82, '#6f4a22');
      // アーチ上部
      ctx.fillStyle = '#4a2f16';
      ctx.fillRect(x + s * 0.24, y + s * 0.12, s * 0.52, s * 0.08);
      // 板目
      ctx.fillStyle = 'rgba(40,24,10,0.5)';
      ctx.fillRect(x + s * 0.5 - Math.max(1, s / 26), y + s * 0.12, Math.max(1, s / 13), s * 0.82);
      // 取っ手
      px(ctx, x + s * 0.62, y + s * 0.5, s * 0.08, s * 0.08, '#ffd85a');
    } else if (ch === 'C') { // 宝箱
      px(ctx, x + s * 0.16, y + s * 0.42, s * 0.68, s * 0.42, '#6f451a');
      px(ctx, x + s * 0.16, y + s * 0.42, s * 0.68, s * 0.08, '#4a2e12'); // 影
      px(ctx, x + s * 0.16, y + s * 0.28, s * 0.68, s * 0.18, '#9a6428'); // 蓋
      px(ctx, x + s * 0.16, y + s * 0.28, s * 0.68, s * 0.05, '#c98a3a');
      // 金具
      ctx.fillStyle = '#e0b24a';
      ctx.fillRect(x + s * 0.14, y + s * 0.3, s * 0.06, s * 0.5);
      ctx.fillRect(x + s * 0.8, y + s * 0.3, s * 0.06, s * 0.5);
      px(ctx, x + s * 0.46, y + s * 0.44, s * 0.08, s * 0.14, '#ffe07a'); // 錠
    } else if (ch === 'A') { // 祭壇
      // 台座
      px(ctx, x + s * 0.14, y + s * 0.5, s * 0.72, s * 0.4, '#4b4f5f');
      px(ctx, x + s * 0.14, y + s * 0.5, s * 0.72, s * 0.06, '#5f6478');
      px(ctx, x + s * 0.26, y + s * 0.34, s * 0.48, s * 0.2, '#6a6f88');
      // 浮遊する星光
      const g = ctx.createRadialGradient(x + s * 0.5, y + s * 0.28, 1, x + s * 0.5, y + s * 0.28, s * 0.32);
      g.addColorStop(0, 'rgba(180,200,255,0.85)');
      g.addColorStop(1, 'rgba(120,150,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + s * 0.14, y - s * 0.05, s * 0.72, s * 0.6);
      ctx.fillStyle = 'rgba(230,240,255,0.9)';
      star(ctx, x + s * 0.5, y + s * 0.26, s * 0.12, s * 0.05, 5);
    } else if (ch === 'B') { // 橋の板目
      ctx.strokeStyle = 'rgba(50,32,16,0.55)';
      ctx.lineWidth = Math.max(1, s / 14);
      for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(x, y + s * i / 4); ctx.lineTo(x + s, y + s * i / 4); ctx.stroke();
      }
      // 縁の桁
      px(ctx, x, y, Math.max(1, s * 0.1), s, '#5a3a1a');
      px(ctx, x + s - Math.max(1, s * 0.1), y, Math.max(1, s * 0.1), s, '#5a3a1a');
    }
  }

  function flower(ctx, cx, cy, r, col, hi) {
    ctx.fillStyle = col;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      ctx.fillRect(cx + Math.cos(a) * r - r * 0.5, cy + Math.sin(a) * r - r * 0.5, r, r);
    }
    ctx.fillStyle = hi;
    ctx.fillRect(cx - r * 0.4, cy - r * 0.4, r * 0.8, r * 0.8);
  }

  function drawTree(ctx, x, y, s, v, gx, gy) {
    // 幹
    px(ctx, x + s * 0.42, y + s * 0.55, s * 0.16, s * 0.42, '#5a3a1a');
    px(ctx, x + s * 0.42, y + s * 0.55, s * 0.06, s * 0.42, '#6f4a22');
    // 葉（3層で立体感）。位置は決定的に微ゆらぎ
    const jitter = (v - 0.5) * s * 0.06;
    const cx = x + s * 0.5 + jitter, cy = y + s * 0.4;
    ctx.fillStyle = '#1f5a24';
    ctx.beginPath(); ctx.arc(cx, cy + s * 0.04, s * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2b7a2e';
    ctx.beginPath(); ctx.arc(cx - s * 0.12, cy - s * 0.02, s * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3c9a3c';
    ctx.beginPath(); ctx.arc(cx - s * 0.16, cy - s * 0.08, s * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(180,255,180,0.18)';
    ctx.beginPath(); ctx.arc(cx - s * 0.2, cy - s * 0.12, s * 0.1, 0, Math.PI * 2); ctx.fill();
  }
  function drawBush(ctx, x, y, s) {
    ctx.fillStyle = '#245a26';
    ctx.beginPath();
    ctx.arc(x + s * 0.35, y + s * 0.62, s * 0.24, 0, Math.PI * 2);
    ctx.arc(x + s * 0.62, y + s * 0.58, s * 0.26, 0, Math.PI * 2);
    ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3c8a3c';
    ctx.beginPath(); ctx.arc(x + s * 0.44, y + s * 0.48, s * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(180,255,180,0.15)';
    ctx.beginPath(); ctx.arc(x + s * 0.4, y + s * 0.44, s * 0.08, 0, Math.PI * 2); ctx.fill();
  }

  function drawWater(ctx, ch, x, y, s, v, gx, gy) {
    const abyss = ch === '~';
    px(ctx, x, y, s, s, abyss ? '#0c0f2c' : '#245a9e');
    // 深み（下ほど暗く）
    ctx.fillStyle = abyss ? 'rgba(0,0,10,0.5)' : 'rgba(10,30,80,0.45)';
    ctx.fillRect(x, y + s * 0.6, s, s * 0.4);
    // 波（gx で位相を連続させる）
    const bands = 3;
    for (let i = 0; i < bands; i++) {
      const ph = hs(gx + i, gy, i + 1);
      const yy = y + s * (0.16 + i * 0.28 + (ph - 0.5) * 0.06);
      ctx.fillStyle = abyss
        ? 'rgba(110,120,220,' + (0.18 + 0.12 * ph).toFixed(3) + ')'
        : 'rgba(170,210,255,' + (0.28 + 0.18 * ph).toFixed(3) + ')';
      const off = (((gx * 5 + i * 3) % 4) / 4) * s;
      ctx.fillRect(x, yy, s * 0.44, Math.max(1, s / 12));
      ctx.fillRect(x + (off % s) - s * 0.1, yy + s * 0.1, s * 0.3, Math.max(1, s / 14));
    }
    // きらめき
    if (v > 0.6) {
      ctx.fillStyle = abyss ? 'rgba(160,170,255,0.6)' : 'rgba(240,250,255,0.8)';
      ctx.fillRect(x + s * (0.2 + v * 0.5), y + s * (0.2 + v * 0.4), Math.max(1, s * 0.09), Math.max(1, s * 0.09));
    }
  }

  function drawRock(ctx, x, y, s, v, gx, gy) {
    px(ctx, x, y, s, s, '#474c56');
    // 岩の面（多角シェーディング）
    ctx.fillStyle = '#565c68';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.1, y + s * 0.35);
    ctx.lineTo(x + s * (0.4 + v * 0.1), y + s * 0.1);
    ctx.lineTo(x + s * 0.85, y + s * 0.4);
    ctx.lineTo(x + s * 0.7, y + s * 0.9);
    ctx.lineTo(x + s * 0.2, y + s * 0.85);
    ctx.closePath(); ctx.fill();
    // 上面ハイライト
    ctx.fillStyle = '#6b717d';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.1, y + s * 0.35);
    ctx.lineTo(x + s * (0.4 + v * 0.1), y + s * 0.1);
    ctx.lineTo(x + s * 0.55, y + s * 0.3);
    ctx.lineTo(x + s * 0.25, y + s * 0.42);
    ctx.closePath(); ctx.fill();
    // 影
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(x, y + s * 0.82, s, s * 0.18);
    // ひび
    ctx.strokeStyle = 'rgba(20,22,28,0.5)'; ctx.lineWidth = Math.max(1, s / 20);
    ctx.beginPath(); ctx.moveTo(x + s * 0.5, y + s * 0.35); ctx.lineTo(x + s * 0.6, y + s * 0.7); ctx.stroke();
  }

  function drawHouseWall(ctx, x, y, s, v, gx, gy) {
    // 屋根と壁を y で切り替え（上段=屋根風）
    px(ctx, x, y, s, s, '#c39468');
    // 石壁の目地（レンガ）
    ctx.fillStyle = 'rgba(120,86,48,0.45)';
    ctx.fillRect(x, y + s * 0.5 - Math.max(1, s / 20), s, Math.max(1, s / 16));
    const bshift = (gy % 2) ? s * 0.5 : 0;
    ctx.fillRect(x + ((bshift) % s), y, Math.max(1, s / 18), s * 0.5);
    ctx.fillRect(x + ((bshift + s * 0.5) % s), y + s * 0.5, Math.max(1, s / 18), s * 0.5);
    // ハイライト・陰
    px(ctx, x, y, s, Math.max(1, s * 0.12), '#d6ab7e');
    ctx.fillStyle = 'rgba(60,40,20,0.28)';
    ctx.fillRect(x, y + s - Math.max(1, s * 0.14), s, Math.max(1, s * 0.14));
  }

  function drawFence(ctx, x, y, s) {
    px(ctx, x + s * 0.08, y + s * 0.32, s * 0.84, s * 0.12, '#7a5a2e');
    px(ctx, x + s * 0.08, y + s * 0.32, s * 0.84, Math.max(1, s * 0.04), '#a07a44');
    px(ctx, x + s * 0.2, y + s * 0.2, s * 0.12, s * 0.56, '#8a6a3a');
    px(ctx, x + s * 0.68, y + s * 0.2, s * 0.12, s * 0.56, '#8a6a3a');
    px(ctx, x + s * 0.2, y + s * 0.2, Math.max(1, s * 0.04), s * 0.56, '#a07a44');
    px(ctx, x + s * 0.68, y + s * 0.2, Math.max(1, s * 0.04), s * 0.56, '#a07a44');
  }

  function drawFlowerBed(ctx, x, y, s, v) {
    px(ctx, x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84, '#4a3016');
    px(ctx, x + s * 0.08, y + s * 0.08, s * 0.84, Math.max(1, s * 0.08), '#5a3c1e');
    const cols = [['#ff6a8a', '#ffd0dc'], ['#ffd24a', '#fff0b0'], ['#7ab8ff', '#d0ecff']];
    for (let i = 0; i < 4; i++) {
      const c = cols[(i + Math.floor(v * 3)) % 3];
      flower(ctx, x + s * (0.32 + (i % 2) * 0.36), y + s * (0.32 + Math.floor(i / 2) * 0.36), s * 0.1, c[0], c[1]);
    }
  }

  function drawStarStone(ctx, x, y, s, v, gx, gy) {
    px(ctx, x, y, s, s, '#201b36');
    // 石塊
    ctx.fillStyle = '#3a3358';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.5, y + s * 0.15);
    ctx.lineTo(x + s * 0.82, y + s * 0.55);
    ctx.lineTo(x + s * 0.55, y + s * 0.88);
    ctx.lineTo(x + s * 0.2, y + s * 0.7);
    ctx.lineTo(x + s * 0.22, y + s * 0.35);
    ctx.closePath(); ctx.fill();
    // 内部の星光
    const glow = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(v * 6.28));
    const g = ctx.createRadialGradient(x + s * 0.5, y + s * 0.52, 1, x + s * 0.5, y + s * 0.52, s * 0.4);
    g.addColorStop(0, 'rgba(160,190,255,' + glow.toFixed(3) + ')');
    g.addColorStop(1, 'rgba(90,110,220,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, s, s);
    ctx.fillStyle = 'rgba(210,225,255,0.9)';
    star(ctx, x + s * 0.5, y + s * 0.52, s * 0.24, s * 0.1, 4);
  }

  function drawPillar(ctx, x, y, s, v) {
    // 影
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x + s * 0.24, y + s * 0.9, s * 0.56, s * 0.08);
    // 柱身
    px(ctx, x + s * 0.28, y + s * 0.05, s * 0.44, s * 0.88, '#8a8f9a');
    px(ctx, x + s * 0.28, y + s * 0.05, s * 0.14, s * 0.88, '#a2a7b2'); // ハイライト
    px(ctx, x + s * 0.6, y + s * 0.05, s * 0.12, s * 0.88, '#6a6f7a');  // 陰
    // 溝
    ctx.fillStyle = 'rgba(60,64,72,0.5)';
    ctx.fillRect(x + s * 0.46, y + s * 0.1, Math.max(1, s / 22), s * 0.8);
    // 柱頭・柱礎
    px(ctx, x + s * 0.22, y, s * 0.56, s * 0.14, '#a0a5b0');
    px(ctx, x + s * 0.22, y + s * 0.84, s * 0.56, s * 0.14, '#a0a5b0');
    px(ctx, x + s * 0.22, y, s * 0.56, Math.max(1, s * 0.04), '#c0c5d0');
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
  function drawActor(ctx, styleId, x, y, s, opts) {
    opts = opts || {};
    const st = ACTOR[styleId] || (BATTLER[styleId] && ACTOR[BATTLER[styleId]]) || ACTOR.lio;
    const dir = opts.dir || 'down';
    const frame = opts.frame || 0;
    const flip = !!opts.flip;
    const role = st.role || 'villager';
    const u = s / 16;
    const cx = x + s / 2;
    const up = dir === 'up';
    const side = dir === 'left' || dir === 'right';

    ctx.save();
    if (flip) { ctx.translate(x + s, y); ctx.scale(-1, 1); ctx.translate(-x, -y); }

    // 派生色
    const out = st.out, acc = st.acc, hair = st.hair, skin = st.skin;
    const pants = st.pants || shade(out, -0.45);
    const boots = st.boots || '#2a2018';
    const outD = shade(out, -0.24), outL = shade(out, 0.2);
    const hairL = shade(hair, 0.24), hairD = shade(hair, -0.3);
    const skinD = shade(skin, -0.16);

    // 影
    ctx.fillStyle = 'rgba(0,0,0,0.26)';
    ctx.beginPath();
    ctx.ellipse(cx, y + s - u * 0.9, s * 0.3, u * 1.2, 0, 0, Math.PI * 2);
    ctx.fill();

    const childScaleY = role === 'child' ? 0.9 : 1;
    const yb = y + (role === 'child' ? u * 1.2 : 0); // 子どもは頭身低め

    // マント（背面レイヤ：up 以外）
    if (st.cape && !up) drawCape(ctx, st.cape, cx, yb, u, frame, side);

    // ---- 脚 ----
    const legTop = yb + u * 11.4, legH = u * 3.3 * childScaleY;
    if (side) {
      const fx = frame === 1 ? u * 1.1 : -u * 0.5;
      const bx = frame === 1 ? -u * 0.7 : u * 0.9;
      px(ctx, cx - u * 1.0 + bx, legTop, u * 1.9, legH, shade(pants, -0.12));
      px(ctx, cx - u * 1.2 + bx, legTop + legH - u * 0.7, u * 2.4, u * 1.0, boots);
      px(ctx, cx - u * 1.0 + fx, legTop, u * 1.9, legH, pants);
      px(ctx, cx - u * 1.2 + fx, legTop + legH - u * 0.7, u * 2.6, u * 1.0, boots);
    } else {
      const s1 = frame === 1 ? u * 0.6 : 0, s2 = frame === 1 ? 0 : u * 0.6;
      px(ctx, cx - u * 2.6, legTop, u * 2.0, legH - s1, pants);
      px(ctx, cx + u * 0.6, legTop, u * 2.0, legH - s2, pants);
      px(ctx, cx - u * 2.7, legTop + legH - s1 - u * 0.6, u * 2.2, u * 1.0, boots);
      px(ctx, cx + u * 0.5, legTop + legH - s2 - u * 0.6, u * 2.2, u * 1.0, boots);
    }

    // ---- 胴 ----
    const torsoY = yb + u * 6.0, torsoH = u * 5.6 * childScaleY, torsoW = u * 6.8;
    px(ctx, cx - torsoW / 2, torsoY, torsoW, torsoH, out);
    px(ctx, cx - torsoW / 2, torsoY, u * 1.5, torsoH, outL);            // 左照り
    px(ctx, cx + torsoW / 2 - u * 1.5, torsoY, u * 1.5, torsoH, outD);  // 右陰
    // 肩章/襟
    px(ctx, cx - torsoW / 2, torsoY, torsoW, u * 1.1, acc);
    // ベルト
    px(ctx, cx - torsoW / 2, torsoY + torsoH - u * 1.2, torsoW, u * 1.1, acc);

    // 役割別の胴装飾
    if (role === 'knight') {
      // 胸当てのプレート
      px(ctx, cx - u * 2.4, torsoY + u * 1.4, u * 4.8, u * 2.6, shade(out, 0.1));
      px(ctx, cx - u * 0.3, torsoY + u * 1.2, u * 0.6, torsoH - u * 2, outD);
    } else if (role === 'hero') {
      // 胸のエンブレム（星）
      ctx.fillStyle = acc;
      star(ctx, cx, torsoY + u * 2.6, u * 1.2, u * 0.5, 5);
    } else if (role === 'mage' || role === 'elder') {
      // ローブの縦ライン
      px(ctx, cx - u * 0.3, torsoY + u * 1.2, u * 0.6, torsoH - u * 1.4, acc);
    }

    // ---- 腕 ----
    const armY = torsoY + u * 0.6, armH = u * 4.0 * childScaleY;
    const armSw = frame === 1 ? u * 0.7 : -u * 0.7;
    if (up) {
      px(ctx, cx - torsoW / 2 - u * 1.0, armY, u * 1.6, armH, outD);
      px(ctx, cx + torsoW / 2 - u * 0.6, armY, u * 1.6, armH, outD);
    } else if (side) {
      // 前腕のみ見える
      px(ctx, cx - u * 0.4, armY + u * 0.4, u * 1.7, armH, out);
      px(ctx, cx - u * 0.4, armY + armH - u * 0.4, u * 1.7, u * 1.2, skin); // 手
    } else {
      px(ctx, cx - torsoW / 2 - u * 1.0, armY + armSw, u * 1.6, armH, out);
      px(ctx, cx + torsoW / 2 - u * 0.6, armY - armSw, u * 1.6, armH, out);
      px(ctx, cx - torsoW / 2 - u * 1.0, armY + armH + armSw - u * 0.4, u * 1.6, u * 1.2, skin);
      px(ctx, cx + torsoW / 2 - u * 0.6, armY + armH - armSw - u * 0.4, u * 1.6, u * 1.2, skin);
    }

    // ---- 頭 ----
    const headW = u * 7 * (role === 'child' ? 1.05 : 1);
    const headY = yb + u * 1.3, headH = u * 5.0;
    // 首
    px(ctx, cx - u * 1.3, headY + headH - u * 1.2, u * 2.6, u * 1.4, skinD);
    // 顔
    px(ctx, cx - headW / 2, headY, headW, headH, skin);
    px(ctx, cx - headW / 2, headY + headH - u * 1.0, headW, u * 1.0, skinD); // あご陰
    if (!up && !side) px(ctx, cx + headW / 2 - u * 1.2, headY, u * 1.2, headH, skinD); // 右頬陰

    // 髪 or 兜
    if (role === 'knight') {
      drawHelmet(ctx, cx, headY, headW, headH, u, out, outL, outD, acc, dir, up, side);
    } else {
      drawHair(ctx, cx, headY, headW, headH, u, hair, hairL, hairD, role, up, side);
    }

    // 顔パーツ（背面は描かない）
    if (!up && role !== 'knight') {
      const eyeY = headY + u * 2.5;
      ctx.fillStyle = '#2a1d14';
      if (dir === 'left') {
        px(ctx, cx - u * 2.1, eyeY, u * 1.2, u * 1.4, '#2a1d14');
        px(ctx, cx - u * 2.0, eyeY + u * 0.1, u * 0.5, u * 0.5, '#fff');
      } else if (dir === 'right') {
        px(ctx, cx + u * 0.9, eyeY, u * 1.2, u * 1.4, '#2a1d14');
        px(ctx, cx + u * 1.4, eyeY + u * 0.1, u * 0.5, u * 0.5, '#fff');
      } else {
        px(ctx, cx - u * 2.3, eyeY, u * 1.1, u * 1.4, '#2a1d14');
        px(ctx, cx + u * 1.2, eyeY, u * 1.1, u * 1.4, '#2a1d14');
        px(ctx, cx - u * 2.1, eyeY + u * 0.1, u * 0.45, u * 0.5, '#fff');
        px(ctx, cx + u * 1.4, eyeY + u * 0.1, u * 0.45, u * 0.5, '#fff');
        // 頬
        ctx.fillStyle = 'rgba(255,150,150,0.25)';
        ctx.fillRect(cx - u * 2.6, eyeY + u * 1.3, u * 1.0, u * 0.7);
        ctx.fillRect(cx + u * 1.6, eyeY + u * 1.3, u * 1.0, u * 0.7);
      }
      // 長老・年配の髭
      if (role === 'elder') {
        px(ctx, cx - u * 2.2, headY + u * 3.9, u * 4.4, u * 2.8, hairL);
        px(ctx, cx - u * 0.6, headY + u * 3.9, u * 1.2, u * 3.2, shade(hair, -0.05));
      }
    }

    ctx.restore();

    // tint（被弾フラッシュ等：仕様維持）
    if (opts.tint) {
      ctx.save();
      ctx.globalAlpha = opts.tintA != null ? opts.tintA : 0.5;
      ctx.fillStyle = opts.tint;
      ctx.fillRect(x, y, s, s);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawCape(ctx, col, cx, y, u, frame, side) {
    const sway = frame === 1 ? u * 0.5 : -u * 0.4;
    ctx.fillStyle = col;
    ctx.beginPath();
    if (side) {
      ctx.moveTo(cx - u * 1.5, y + u * 6.2);
      ctx.lineTo(cx + u * 2.2, y + u * 6.6);
      ctx.lineTo(cx + u * 1.6 + sway, y + u * 13.5);
      ctx.lineTo(cx - u * 2.4 + sway * 0.5, y + u * 13.0);
    } else {
      ctx.moveTo(cx - u * 3.7, y + u * 6.2);
      ctx.lineTo(cx + u * 3.7, y + u * 6.2);
      ctx.lineTo(cx + u * 3.0 + sway, y + u * 13.0);
      ctx.lineTo(cx - u * 3.0 + sway, y + u * 13.0);
    }
    ctx.closePath(); ctx.fill();
    // 内側の陰
    ctx.fillStyle = shade(col, -0.28);
    ctx.fillRect(cx - u * 0.4, y + u * 6.4, u * 0.8, u * 6.2);
  }

  function drawHair(ctx, cx, headY, headW, headH, u, hair, hairL, hairD, role, up, side) {
    if (up) {
      // 後頭部：頭全体を覆う
      px(ctx, cx - headW / 2 - u * 0.2, headY - u * 0.6, headW + u * 0.4, headH + u * 0.8, hair);
      px(ctx, cx - headW / 2 - u * 0.2, headY - u * 0.6, u * 1.6, headH + u * 0.8, hairD);
      px(ctx, cx - headW / 2, headY - u * 0.6, headW, u * 0.8, hairL);
      if (role === 'mage') { // 後ろ髪を長く
        px(ctx, cx - u * 3.0, headY + headH - u * 0.4, u * 6.0, u * 3.2, hair);
      }
      return;
    }
    // 前髪・トップ
    px(ctx, cx - headW / 2 - u * 0.2, headY - u * 0.7, headW + u * 0.4, u * 2.7, hair);
    px(ctx, cx - headW / 2 - u * 0.2, headY - u * 0.7, headW + u * 0.4, u * 0.8, hairL);
    // 側面の髪
    px(ctx, cx - headW / 2 - u * 0.2, headY - u * 0.2, u * 1.6, u * 3.4, hair);
    px(ctx, cx + headW / 2 - u * 1.4, headY - u * 0.2, u * 1.6, u * 3.4, hair);
    // 前髪の房
    px(ctx, cx - u * 0.6, headY - u * 0.4, u * 1.2, u * 1.8, hairD);
    if (role === 'mage') { // ロングヘア
      px(ctx, cx - headW / 2 - u * 0.6, headY + u * 1.6, u * 1.7, u * 6.2, hair);
      px(ctx, cx + headW / 2 - u * 1.1, headY + u * 1.6, u * 1.7, u * 6.2, hair);
      px(ctx, cx - headW / 2 - u * 0.6, headY + u * 1.6, u * 0.6, u * 6.2, hairL);
    }
    if (role === 'hero') { // ヘッドバンド
      px(ctx, cx - headW / 2 - u * 0.2, headY + u * 0.5, headW + u * 0.4, u * 0.8, '#ffd85a');
      px(ctx, cx + headW / 2 - u * 0.2, headY + u * 0.5, u * 0.8, u * 2.6, '#e0b24a'); // 結び目の垂れ
    }
    if (role === 'elder') { // フード気味に深く
      px(ctx, cx - headW / 2 - u * 0.2, headY - u * 0.7, u * 1.8, u * 4.4, hair);
      px(ctx, cx + headW / 2 - u * 1.6, headY - u * 0.7, u * 1.8, u * 4.4, hair);
    }
  }

  function drawHelmet(ctx, cx, headY, headW, headH, u, out, outL, outD, acc, dir, up, side) {
    // 兜本体
    px(ctx, cx - headW / 2 - u * 0.3, headY - u * 0.8, headW + u * 0.6, headH + u * 1.0, shade(out, 0.05));
    px(ctx, cx - headW / 2 - u * 0.3, headY - u * 0.8, headW + u * 0.6, u * 1.1, outL);
    px(ctx, cx + headW / 2 - u * 1.2, headY - u * 0.8, u * 1.2, headH + u * 1.0, outD);
    // 前立て（プルーム）
    px(ctx, cx - u * 0.7, headY - u * 2.6, u * 1.4, u * 2.4, acc);
    if (!up) {
      // 面頬のスリット
      px(ctx, cx - headW / 2 + u * 0.4, headY + u * 2.2, headW - u * 0.8, u * 1.0, '#0a0a14');
      ctx.fillStyle = 'rgba(120,200,255,0.7)';
      if (dir === 'left') px(ctx, cx - u * 2.0, headY + u * 2.4, u * 0.7, u * 0.6, 'rgba(150,210,255,0.8)');
      else if (dir === 'right') px(ctx, cx + u * 1.3, headY + u * 2.4, u * 0.7, u * 0.6, 'rgba(150,210,255,0.8)');
      else {
        px(ctx, cx - u * 1.8, headY + u * 2.4, u * 0.7, u * 0.6, 'rgba(150,210,255,0.8)');
        px(ctx, cx + u * 1.1, headY + u * 2.4, u * 0.7, u * 0.6, 'rgba(150,210,255,0.8)');
      }
      // 鼻当て
      px(ctx, cx - u * 0.3, headY + u * 1.0, u * 0.6, u * 2.6, outD);
    }
  }

  /* ---- 敵 ---- */
  function drawEnemy(ctx, sprite, x, y, s, opts) {
    opts = opts || {};
    const t = opts.t || 0;
    const bob = Math.sin(t * 3) * s * 0.02;
    y += bob;
    ctx.save();
    if (opts.hitFlash) ctx.globalAlpha = 0.9;
    switch (sprite) {
      case 'slime': eSlime(ctx, x, y, s, t); break;
      case 'bat': eBat(ctx, x, y, s, t); break;
      case 'wolf': eWolf(ctx, x, y, s, t); break;
      case 'wisp': eWisp(ctx, x, y, s, t); break;
      case 'golem': eGolem(ctx, x, y, s, t); break;
      case 'shade': eShade(ctx, x, y, s, t); break;
      case 'warden': eWarden(ctx, x, y, s, t); break;
      case 'nox': eNox(ctx, x, y, s, t); break;
      default: eSlime(ctx, x, y, s, t);
    }
    ctx.restore();
    if (opts.hitFlash) {
      ctx.save(); ctx.globalAlpha = 0.55; ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, s, s); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  function shadow(ctx, x, y, s, wScale) {
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(x + s / 2, y + s * 0.94, s * (wScale || 0.34), s * 0.075, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function eSlime(ctx, x, y, s, t) {
    shadow(ctx, x, y, s, 0.32);
    const squash = 1 + Math.sin(t * 3) * 0.06;
    const cy = y + s * 0.64;
    const rx = s * 0.36 / squash, ry = s * 0.32 * squash;
    // 本体
    const g = ctx.createRadialGradient(x + s * 0.42, cy - ry * 0.3, 1, x + s / 2, cy, rx * 1.4);
    g.addColorStop(0, '#5a5aa0'); g.addColorStop(0.6, '#3a3a72'); g.addColorStop(1, '#26264e');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x + s / 2, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    // ハイライト
    ctx.fillStyle = 'rgba(160,170,240,0.55)';
    ctx.beginPath(); ctx.ellipse(x + s * 0.4, cy - ry * 0.4, rx * 0.28, ry * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    // 目
    px(ctx, x + s * 0.4, cy - s * 0.02, s * 0.06, s * 0.09, '#f4f4ff');
    px(ctx, x + s * 0.55, cy - s * 0.02, s * 0.06, s * 0.09, '#f4f4ff');
    px(ctx, x + s * 0.41, cy + s * 0.01, s * 0.03, s * 0.05, '#101024');
    px(ctx, x + s * 0.56, cy + s * 0.01, s * 0.03, s * 0.05, '#101024');
  }

  function eBat(ctx, x, y, s, t) {
    shadow(ctx, x, y, s, 0.22);
    const flap = Math.sin(t * 9) * s * 0.14;
    // 翼
    ctx.fillStyle = '#4a2f5c';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.5, y + s * 0.45);
    ctx.lineTo(x + s * 0.02, y + s * 0.26 + flap);
    ctx.lineTo(x + s * 0.14, y + s * 0.42 + flap * 0.5);
    ctx.lineTo(x + s * 0.06, y + s * 0.56 + flap);
    ctx.lineTo(x + s * 0.3, y + s * 0.55);
    ctx.lineTo(x + s * 0.5, y + s * 0.62);
    ctx.lineTo(x + s * 0.7, y + s * 0.55);
    ctx.lineTo(x + s * 0.94, y + s * 0.56 + flap);
    ctx.lineTo(x + s * 0.86, y + s * 0.42 + flap * 0.5);
    ctx.lineTo(x + s * 0.98, y + s * 0.26 + flap);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(120,80,150,0.5)';
    ctx.fillRect(x + s * 0.16, y + s * 0.32 + flap * 0.6, s * 0.18, Math.max(1, s * 0.02));
    // 体
    ctx.fillStyle = '#2f1d3c';
    ctx.beginPath(); ctx.arc(x + s * 0.5, y + s * 0.5, s * 0.14, 0, Math.PI * 2); ctx.fill();
    // 耳
    ctx.beginPath();
    ctx.moveTo(x + s * 0.42, y + s * 0.4); ctx.lineTo(x + s * 0.38, y + s * 0.28); ctx.lineTo(x + s * 0.48, y + s * 0.38);
    ctx.moveTo(x + s * 0.58, y + s * 0.4); ctx.lineTo(x + s * 0.62, y + s * 0.28); ctx.lineTo(x + s * 0.52, y + s * 0.38);
    ctx.fill();
    // 目
    px(ctx, x + s * 0.43, y + s * 0.47, s * 0.055, s * 0.06, '#ffde4a');
    px(ctx, x + s * 0.52, y + s * 0.47, s * 0.055, s * 0.06, '#ffde4a');
    // 牙
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.46, y + s * 0.56); ctx.lineTo(x + s * 0.48, y + s * 0.61); ctx.lineTo(x + s * 0.5, y + s * 0.56);
    ctx.moveTo(x + s * 0.5, y + s * 0.56); ctx.lineTo(x + s * 0.52, y + s * 0.61); ctx.lineTo(x + s * 0.54, y + s * 0.56);
    ctx.fill();
  }

  function eWolf(ctx, x, y, s, t) {
    shadow(ctx, x, y, s, 0.36);
    const step = Math.sin(t * 4) * s * 0.02;
    // 胴
    ctx.fillStyle = '#3b404c';
    ctx.beginPath(); ctx.ellipse(x + s * 0.46, y + s * 0.58, s * 0.32, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    // 尻尾
    ctx.strokeStyle = '#33373f'; ctx.lineWidth = s * 0.09; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x + s * 0.2, y + s * 0.52);
    ctx.quadraticCurveTo(x + s * 0.02, y + s * 0.4, x + s * 0.1, y + s * 0.28); ctx.stroke();
    // 脚
    ctx.fillStyle = '#2a2e38';
    ctx.fillRect(x + s * 0.28, y + s * 0.68, s * 0.07, s * 0.22 + step);
    ctx.fillRect(x + s * 0.58, y + s * 0.68, s * 0.07, s * 0.22 - step);
    ctx.fillRect(x + s * 0.38, y + s * 0.7, s * 0.07, s * 0.2 - step);
    ctx.fillRect(x + s * 0.5, y + s * 0.7, s * 0.07, s * 0.2 + step);
    // 頭
    ctx.fillStyle = '#414651';
    px(ctx, x + s * 0.6, y + s * 0.34, s * 0.28, s * 0.24, '#414651');
    // 鼻先
    ctx.beginPath();
    ctx.moveTo(x + s * 0.84, y + s * 0.42); ctx.lineTo(x + s * 0.95, y + s * 0.46); ctx.lineTo(x + s * 0.84, y + s * 0.52);
    ctx.fill();
    // 耳
    ctx.fillStyle = '#2f333c';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.62, y + s * 0.34); ctx.lineTo(x + s * 0.6, y + s * 0.2); ctx.lineTo(x + s * 0.72, y + s * 0.32);
    ctx.moveTo(x + s * 0.78, y + s * 0.32); ctx.lineTo(x + s * 0.82, y + s * 0.2); ctx.lineTo(x + s * 0.86, y + s * 0.34);
    ctx.fill();
    // たてがみ
    ctx.fillStyle = '#2a2e38';
    ctx.fillRect(x + s * 0.55, y + s * 0.34, s * 0.06, s * 0.28);
    // 目
    px(ctx, x + s * 0.78, y + s * 0.4, s * 0.05, s * 0.05, '#ff5a4a');
  }

  function eWisp(ctx, x, y, s, t) {
    const cx = x + s / 2, cy = y + s * 0.5 + Math.sin(t * 2.4) * s * 0.03;
    // 外周オーラ
    const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, s * 0.44);
    g.addColorStop(0, 'rgba(200,175,255,0.95)');
    g.addColorStop(0.45, 'rgba(140,100,235,0.6)');
    g.addColorStop(1, 'rgba(70,40,130,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, s * 0.44, 0, Math.PI * 2); ctx.fill();
    // 芯
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx, cy - s * 0.02, s * 0.09, 0, Math.PI * 2); ctx.fill();
    // 旋回する火の粉
    for (let i = 0; i < 3; i++) {
      const a = t * 2 + i * Math.PI * 2 / 3;
      const rr2 = s * 0.28;
      ctx.fillStyle = 'rgba(220,200,255,' + (0.5 + 0.3 * Math.sin(t * 4 + i)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2 * 0.7, s * 0.04, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function eGolem(ctx, x, y, s, t) {
    shadow(ctx, x, y, s, 0.36);
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.5);
    // 胴
    px(ctx, x + s * 0.22, y + s * 0.26, s * 0.56, s * 0.54, '#666b74');
    px(ctx, x + s * 0.22, y + s * 0.26, s * 0.1, s * 0.54, '#7c828c'); // 照り
    px(ctx, x + s * 0.68, y + s * 0.26, s * 0.1, s * 0.54, '#545961'); // 陰
    // 頭
    px(ctx, x + s * 0.32, y + s * 0.08, s * 0.36, s * 0.26, '#767c86');
    px(ctx, x + s * 0.32, y + s * 0.08, s * 0.36, s * 0.05, '#8a909a');
    // 目
    px(ctx, x + s * 0.39, y + s * 0.17, s * 0.07, s * 0.06, 'rgba(120,220,255,' + (0.6 + 0.4 * pulse) + ')');
    px(ctx, x + s * 0.54, y + s * 0.17, s * 0.07, s * 0.06, 'rgba(120,220,255,' + (0.6 + 0.4 * pulse) + ')');
    // 腕
    px(ctx, x + s * 0.08, y + s * 0.3, s * 0.16, s * 0.42, '#565b63');
    px(ctx, x + s * 0.76, y + s * 0.3, s * 0.16, s * 0.42, '#565b63');
    px(ctx, x + s * 0.05, y + s * 0.66, s * 0.22, s * 0.16, '#4c5158'); // 拳
    px(ctx, x + s * 0.73, y + s * 0.66, s * 0.22, s * 0.16, '#4c5158');
    // 核（発光）
    const cg = ctx.createRadialGradient(x + s * 0.5, y + s * 0.52, 1, x + s * 0.5, y + s * 0.52, s * 0.18);
    cg.addColorStop(0, 'rgba(150,230,255,' + (0.7 + 0.3 * pulse) + ')');
    cg.addColorStop(1, 'rgba(60,120,200,0)');
    ctx.fillStyle = cg; ctx.fillRect(x + s * 0.28, y + s * 0.3, s * 0.44, s * 0.44);
    // 秘紋
    ctx.strokeStyle = 'rgba(120,220,255,0.4)'; ctx.lineWidth = s / 26;
    ctx.strokeRect(x + s * 0.32, y + s * 0.4, s * 0.36, s * 0.3);
  }

  function eShade(ctx, x, y, s, t) {
    const sway = Math.sin(t * 2) * s * 0.05;
    const hover = Math.sin(t * 1.6) * s * 0.03;
    // オーラ
    const g = ctx.createRadialGradient(x + s / 2, y + s * 0.45, s * 0.05, x + s / 2, y + s * 0.45, s * 0.5);
    g.addColorStop(0, 'rgba(70,30,110,0.4)'); g.addColorStop(1, 'rgba(20,10,40,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, s, s);
    // 外套（裾がゆらぐ）
    ctx.fillStyle = 'rgba(22,12,42,0.95)';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.5, y + s * 0.04 + hover);
    ctx.quadraticCurveTo(x + s * 0.92 + sway, y + s * 0.5, x + s * 0.74, y + s * 0.9);
    ctx.lineTo(x + s * 0.62, y + s * 0.82 + sway * 0.5);
    ctx.lineTo(x + s * 0.5, y + s * 0.92);
    ctx.lineTo(x + s * 0.38, y + s * 0.82 - sway * 0.5);
    ctx.lineTo(x + s * 0.26, y + s * 0.9);
    ctx.quadraticCurveTo(x + s * 0.08 - sway, y + s * 0.5, x + s * 0.5, y + s * 0.04 + hover);
    ctx.fill();
    // フードの奥
    ctx.fillStyle = '#0a0416';
    ctx.beginPath(); ctx.ellipse(x + s * 0.5, y + s * 0.38 + hover, s * 0.16, s * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    // 眼
    const gl = 0.6 + 0.4 * Math.sin(t * 3);
    ctx.fillStyle = 'rgba(190,120,255,' + gl.toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(x + s * 0.43, y + s * 0.38 + hover, s * 0.045, 0, Math.PI * 2);
    ctx.arc(x + s * 0.57, y + s * 0.38 + hover, s * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }

  function eWarden(ctx, x, y, s, t) {
    shadow(ctx, x, y, s, 0.4);
    const pulse = 0.5 + 0.5 * Math.sin(t * 2);
    // 威圧オーラ
    const g = ctx.createRadialGradient(x + s / 2, y + s * 0.5, s * 0.2, x + s / 2, y + s * 0.5, s * 0.6);
    g.addColorStop(0, 'rgba(255,140,60,' + (0.12 + 0.12 * pulse) + ')');
    g.addColorStop(1, 'rgba(120,50,10,0)');
    ctx.fillStyle = g; ctx.fillRect(x - s * 0.1, y - s * 0.1, s * 1.2, s * 1.2);
    // 胴（重厚な石像）
    px(ctx, x + s * 0.2, y + s * 0.22, s * 0.6, s * 0.58, '#5a606b');
    px(ctx, x + s * 0.2, y + s * 0.22, s * 0.1, s * 0.58, '#6c727e');
    px(ctx, x + s * 0.7, y + s * 0.22, s * 0.1, s * 0.58, '#4a4f58');
    // 肩当て
    px(ctx, x + s * 0.12, y + s * 0.24, s * 0.16, s * 0.2, '#6c727e');
    px(ctx, x + s * 0.72, y + s * 0.24, s * 0.16, s * 0.2, '#6c727e');
    // 頭・冠
    px(ctx, x + s * 0.3, y + s * 0.04, s * 0.4, s * 0.24, '#656b76');
    ctx.fillStyle = '#4a4f58';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(x + s * (0.34 + i * 0.12), y + s * 0.06);
      ctx.lineTo(x + s * (0.38 + i * 0.12), y - s * 0.02);
      ctx.lineTo(x + s * (0.42 + i * 0.12), y + s * 0.06);
      ctx.fill();
    }
    // 眼
    ctx.fillStyle = 'rgba(255,150,60,' + (0.7 + 0.3 * pulse) + ')';
    px(ctx, x + s * 0.36, y + s * 0.13, s * 0.09, s * 0.07, ctx.fillStyle);
    px(ctx, x + s * 0.55, y + s * 0.13, s * 0.09, s * 0.07, ctx.fillStyle);
    // 腕・拳
    px(ctx, x + s * 0.08, y + s * 0.34, s * 0.16, s * 0.4, '#50555e');
    px(ctx, x + s * 0.76, y + s * 0.34, s * 0.16, s * 0.4, '#50555e');
    // 胸の紋章（発光）
    ctx.fillStyle = 'rgba(255,170,80,' + (0.5 + 0.4 * pulse) + ')';
    star(ctx, x + s * 0.5, y + s * 0.5, s * 0.11, s * 0.045, 6);
    // ひび
    ctx.strokeStyle = 'rgba(20,20,26,0.5)'; ctx.lineWidth = s / 30;
    ctx.beginPath(); ctx.moveTo(x + s * 0.4, y + s * 0.28); ctx.lineTo(x + s * 0.46, y + s * 0.5); ctx.lineTo(x + s * 0.42, y + s * 0.72); ctx.stroke();
  }

  function eNox(ctx, x, y, s, t) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    // 巨大な闇のオーラ（多重）
    const g = ctx.createRadialGradient(x + s / 2, y + s * 0.48, s * 0.1, x + s / 2, y + s * 0.48, s * 0.62);
    g.addColorStop(0, 'rgba(110,30,160,' + (0.4 + 0.2 * pulse) + ')');
    g.addColorStop(0.6, 'rgba(50,10,90,0.3)');
    g.addColorStop(1, 'rgba(10,0,20,0)');
    ctx.fillStyle = g; ctx.fillRect(x - s * 0.15, y - s * 0.15, s * 1.3, s * 1.3);
    // 渦巻く外套
    const sway = Math.sin(t * 1.5) * s * 0.04;
    ctx.fillStyle = '#150922';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.5, y + s * 0.0);
    ctx.quadraticCurveTo(x + s * 1.02 + sway, y + s * 0.5, x + s * 0.74, y + s * 0.99);
    ctx.lineTo(x + s * 0.6, y + s * 0.88);
    ctx.lineTo(x + s * 0.5, y + s * 0.99);
    ctx.lineTo(x + s * 0.4, y + s * 0.88);
    ctx.lineTo(x + s * 0.26, y + s * 0.99);
    ctx.quadraticCurveTo(x + s * -0.02 - sway, y + s * 0.5, x + s * 0.5, y + s * 0.0);
    ctx.fill();
    // 内側のうっすらした紫
    ctx.fillStyle = 'rgba(90,40,140,0.5)';
    ctx.beginPath();
    ctx.moveTo(x + s * 0.5, y + s * 0.12);
    ctx.quadraticCurveTo(x + s * 0.78, y + s * 0.5, x + s * 0.6, y + s * 0.85);
    ctx.lineTo(x + s * 0.4, y + s * 0.85);
    ctx.quadraticCurveTo(x + s * 0.22, y + s * 0.5, x + s * 0.5, y + s * 0.12);
    ctx.fill();
    // 王冠の星
    ctx.fillStyle = 'rgba(200,150,255,' + (0.7 + 0.3 * pulse) + ')';
    star(ctx, x + s * 0.5, y + s * 0.15, s * 0.13, s * 0.05, 5);
    // 六つ眼
    const glow = 0.6 + 0.4 * Math.sin(t * 4);
    ctx.fillStyle = 'rgba(255,60,120,' + glow.toFixed(3) + ')';
    const eyes = [[0.4, 0.4], [0.6, 0.4], [0.36, 0.52], [0.64, 0.52], [0.44, 0.6], [0.56, 0.6]];
    eyes.forEach((e, i) => {
      const r = s * (i < 2 ? 0.055 : 0.035);
      ctx.beginPath(); ctx.arc(x + s * e[0], y + s * e[1], r, 0, Math.PI * 2); ctx.fill();
    });
    // 闇の触手
    ctx.strokeStyle = 'rgba(80,30,120,0.85)'; ctx.lineWidth = s / 15; ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i += 2) {
      ctx.beginPath();
      ctx.moveTo(x + s * 0.5, y + s * 0.62);
      ctx.quadraticCurveTo(
        x + s * (0.5 + i * 0.52), y + s * (0.58 + 0.12 * Math.sin(t * 3 + i)),
        x + s * (0.5 + i * 0.42), y + s * 0.96);
      ctx.stroke();
    }
  }

  /* ---- バトル背景 ---- */
  function battleBackground(ctx, w, h, theme, t) {
    if (theme === 'town') bgTown(ctx, w, h, t);
    else if (theme === 'dungeon') bgDungeon(ctx, w, h, t);
    else bgField(ctx, w, h, t);
  }

  function skyStars(ctx, w, h, t, count, maxY, col) {
    ctx.fillStyle = col || '#fff';
    for (let i = 0; i < count; i++) {
      const sx = (i * 97 + (i * i * 13) % 61) % w;
      const sy = (i * 53) % maxY;
      const a = 0.25 + 0.55 * Math.abs(Math.sin(t * 2 + i * 1.3));
      ctx.globalAlpha = a;
      const sz = (i % 7 === 0) ? 2.5 : 1.5;
      ctx.fillRect(sx, sy, sz, sz);
    }
    ctx.globalAlpha = 1;
  }

  function bgTown(ctx, w, h, t) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1a2350'); g.addColorStop(0.5, '#26305e'); g.addColorStop(1, '#0c1226');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    skyStars(ctx, w, h, t, 46, h * 0.55);
    // 月
    const mx = w * 0.78, my = h * 0.18;
    const mg = ctx.createRadialGradient(mx, my, 1, mx, my, w * 0.16);
    mg.addColorStop(0, 'rgba(255,246,210,0.9)'); mg.addColorStop(0.5, 'rgba(255,240,200,0.3)'); mg.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = mg; ctx.fillRect(mx - w * 0.16, my - w * 0.16, w * 0.32, w * 0.32);
    ctx.fillStyle = '#fdf3cf';
    ctx.beginPath(); ctx.arc(mx, my, w * 0.06, 0, Math.PI * 2); ctx.fill();
    // 遠景の家並み（シルエット）
    const hy = h * 0.62;
    ctx.fillStyle = '#141a34';
    for (let i = 0; i < 7; i++) {
      const bw = w * 0.16, bx = i * bw - w * 0.02;
      const bh = h * (0.1 + ((i * 37) % 5) * 0.02);
      ctx.fillRect(bx, hy - bh, bw * 0.9, bh);
      // 屋根
      ctx.beginPath();
      ctx.moveTo(bx - bw * 0.05, hy - bh);
      ctx.lineTo(bx + bw * 0.45, hy - bh - bw * 0.35);
      ctx.lineTo(bx + bw * 0.95, hy - bh);
      ctx.fill();
      // 窓明かり
      if (i % 2 === 0) {
        ctx.fillStyle = 'rgba(255,200,110,' + (0.5 + 0.3 * Math.sin(t * 2 + i)).toFixed(2) + ')';
        ctx.fillRect(bx + bw * 0.35, hy - bh * 0.6, bw * 0.18, bh * 0.22);
        ctx.fillStyle = '#141a34';
      }
    }
    groundPlane(ctx, w, h, '#101832', '#0a0f22');
  }

  function bgField(ctx, w, h, t) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#182a44'); g.addColorStop(0.5, '#1c3a34'); g.addColorStop(1, '#0c1c16');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    skyStars(ctx, w, h, t, 34, h * 0.45, 'rgba(220,235,255,1)');
    // 遠い木立（2層）
    treeLine(ctx, w, h * 0.6, w * 0.14, '#14261e', 0.12);
    treeLine(ctx, w, h * 0.66, w * 0.1, '#0e1f16', 0.16);
    // 蛍
    for (let i = 0; i < 10; i++) {
      const fx = (i * 83) % w;
      const fy = h * 0.4 + ((i * 57) % Math.floor(h * 0.3)) + Math.sin(t * 1.5 + i) * 8;
      ctx.fillStyle = 'rgba(180,255,150,' + (0.3 + 0.5 * Math.abs(Math.sin(t * 2 + i))).toFixed(2) + ')';
      ctx.fillRect(fx, fy, 2.5, 2.5);
    }
    groundPlane(ctx, w, h, '#132a1e', '#0a1a12');
  }

  function treeLine(ctx, w, baseY, tw, col, heightFrac) {
    ctx.fillStyle = col;
    const n = Math.ceil(w / tw) + 1;
    for (let i = 0; i < n; i++) {
      const cx = i * tw;
      const th = baseY * heightFrac + (i % 3) * tw * 0.3;
      ctx.beginPath();
      ctx.moveTo(cx - tw * 0.6, baseY);
      ctx.lineTo(cx, baseY - th - tw * 0.6);
      ctx.lineTo(cx + tw * 0.6, baseY);
      ctx.fill();
    }
    ctx.fillRect(0, baseY - 1, w, 3);
  }

  function bgDungeon(ctx, w, h, t) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#241f3a'); g.addColorStop(0.55, '#161228'); g.addColorStop(1, '#080611');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // 浮遊する塵/星屑
    ctx.fillStyle = '#b7a6e0';
    for (let i = 0; i < 30; i++) {
      const sx = (i * 71) % w;
      const sy = ((i * 61) % Math.floor(h * 0.8)) + Math.sin(t * 0.8 + i) * 6;
      ctx.globalAlpha = 0.15 + 0.35 * Math.abs(Math.sin(t + i));
      ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.globalAlpha = 1;
    // 崩れた円柱のシルエット
    ctx.fillStyle = '#100c1e';
    const cols = [0.08, 0.28, 0.72, 0.92];
    cols.forEach((cf, i) => {
      const cxp = w * cf, cw = w * 0.09, top = h * (0.1 + (i % 2) * 0.06);
      ctx.fillRect(cxp - cw / 2, top, cw, h * 0.6 - top);
      ctx.fillRect(cxp - cw * 0.7, top, cw * 1.4, h * 0.03); // 柱頭
    });
    // 中央の秘紋の光輪
    const rx = w * 0.5, ry = h * 0.5;
    const glow = 0.12 + 0.1 * (0.5 + 0.5 * Math.sin(t * 1.5));
    const rg = ctx.createRadialGradient(rx, ry, w * 0.02, rx, ry, w * 0.4);
    rg.addColorStop(0, 'rgba(150,110,255,' + glow.toFixed(3) + ')');
    rg.addColorStop(1, 'rgba(80,40,160,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);
    groundPlane(ctx, w, h, '#171228', '#0b0818');
  }

  function groundPlane(ctx, w, h, top, bot) {
    const gy = h * 0.62;
    const g = ctx.createLinearGradient(0, gy, 0, h);
    g.addColorStop(0, top); g.addColorStop(1, bot);
    ctx.fillStyle = g; ctx.fillRect(0, gy, w, h - gy);
    // 戦闘の舞台となる床の陰
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.86, w * 0.6, h * 0.13, 0, 0, Math.PI * 2); ctx.fill();
    // 地平の照り
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, gy, w, 2);
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
        size: opt.size || 4, grav: opt.grav != null ? opt.grav : 120,
        spin: (Math.random() - 0.5) * 6
      });
    }
  };
  Particles.prototype.update = function (dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt; if (p.life <= 0) { this.list.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += p.grav * dt;
      // 空気抵抗（自然な減衰）
      p.vx *= (1 - 1.2 * dt); p.vy *= (1 - 0.4 * dt);
    }
  };
  Particles.prototype.draw = function (ctx) {
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.list) {
      const k = Math.max(0, p.life / p.max);
      const sz = p.size * (0.35 + 0.65 * k);
      // 芯（加算的な明るさ）
      ctx.globalAlpha = Math.min(1, k * 1.1);
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
      // 淡いグロー
      ctx.globalAlpha = Math.min(1, k * 0.4);
      ctx.fillRect(p.x - sz, p.y - sz, sz * 2, sz * 2);
    }
    ctx.globalCompositeOperation = prevOp;
    ctx.globalAlpha = 1;
  };
  Particles.prototype.count = function () { return this.list.length; };

  return {
    drawTile, drawActor, drawEnemy, battleBackground, star,
    Particles, ACTOR, BATTLER, px, rr
  };
})();
