"use strict";
/* =====================================================================
   クリスタルの塔 — 光の勇者アルト
   Canvas 手描きグラフィック重視の小型JRPG
   ===================================================================== */

/* ---------- 基本ユーティリティ ---------- */
const clamp = (v,a,b)=>v<a?a:v>b?b:v;
const lerp  = (a,b,t)=>a+(b-a)*t;
const rand  = (a,b)=>a+Math.random()*(b-a);
const chance= p=>Math.random()<p;
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
const easeOut = t=>1-Math.pow(1-t,3);
const easeIn  = t=>t*t*t;
const easeInOut = t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
const easeBack = t=>{const c=2.2;return 1+ (c+1)*Math.pow(t-1,3)+c*Math.pow(t-1,2);};

/* 色ミックス（#rrggbb を白へ寄せる等） */
function hex2rgb(h){h=h.replace('#','');return[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
function rgb2hex(r,g,b){const f=n=>clamp(Math.round(n),0,255).toString(16).padStart(2,'0');return '#'+f(r)+f(g)+f(b);}
function mix(a,b,t){const A=hex2rgb(a),B=hex2rgb(b);return rgb2hex(lerp(A[0],B[0],t),lerp(A[1],B[1],t),lerp(A[2],B[2],t));}
function shade(h,amt){return amt>=0?mix(h,'#ffffff',amt):mix(h,'#000000',-amt);}

/* 疑似乱数・ノイズ（マップ生成用） */
let _seed = 20260927;
function rnd(){_seed=(_seed*1103515245+12345)&0x7fffffff;return _seed/0x7fffffff;}
function hash(x,y){let h=x*374761393+y*668265263;h=(h^(h>>13))*1274126177;return((h^(h>>16))>>>0)/4294967295;}
function smooth(t){return t*t*(3-2*t);}
function vnoise(x,y){
  const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi;
  const a=hash(xi,yi),b=hash(xi+1,yi),c=hash(xi,yi+1),d=hash(xi+1,yi+1);
  const u=smooth(xf),v=smooth(yf);
  return (a*(1-u)+b*u)*(1-v)+(c*(1-u)+d*u)*v;
}

/* ---------- DOM ---------- */
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const titleCv = document.getElementById('title-canvas');
const titleCtx = titleCv.getContext('2d');
const el = id=>document.getElementById(id);
const fieldHud = el('field-hud'), pad = el('pad'), battleUI = el('battle-ui');
const battleMsg = el('battle-msg'), battleMenu = el('battle-menu');
const titleScreen = el('title-screen'), eventScreen = el('event-screen');

/* ---------- ビュー ---------- */
const V = {w:0,h:0,dpr:1,tile:48};
function resize(){
  const dpr = Math.min(window.devicePixelRatio||1, 2.5);
  const w = window.innerWidth, h = window.innerHeight;
  V.w=w; V.h=h; V.dpr=dpr;
  cv.width = Math.round(w*dpr); cv.height=Math.round(h*dpr);
  cv.style.width=w+'px'; cv.style.height=h+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  V.tile = Math.max(40, Math.round(Math.min(w,h)/9));
  // title canvas
  const tr = titleCv.getBoundingClientRect();
  titleCv.width = Math.max(1,Math.round(tr.width*dpr));
  titleCv.height= Math.max(1,Math.round(tr.height*dpr));
  titleCtx.setTransform(dpr,0,0,dpr,0,0);
}
window.addEventListener('resize',resize);

/* =====================================================================
   マップ生成
   ===================================================================== */
const MAP = {W:46,H:34,t:[],start:{x:0,y:0},tower:{x:0,y:0}};
const BLOCKED = new Set(['T','~','O','R']); // 木/水/塔/岩

function buildMap(){
  const {W,H}=MAP; const t=[];
  for(let y=0;y<H;y++){const r=[];for(let x=0;x<W;x++)r.push('.');t.push(r);}
  // 外周は森の壁
  for(let x=0;x<W;x++){t[0][x]='T';t[1][x]=chance(.5)?'T':'.';t[H-1][x]='T';t[H-2][x]=chance(.5)?'T':'.';}
  for(let y=0;y<H;y++){t[y][0]='T';t[y][1]=chance(.5)?'T':'.';t[y][W-1]='T';t[y][W-2]=chance(.5)?'T':'.';}
  // 木の群生（値ノイズ）
  for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++){
    const n = vnoise(x*0.20+3.1, y*0.20+7.7);
    if(n>0.63) t[y][x]='T';
    else if(n<0.16 && chance(.4)) t[y][x]='R'; // 岩
  }
  // 池（楕円）
  const pond={x:Math.floor(W*0.68),y:Math.floor(H*0.55),rx:5.2,ry:3.4};
  for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++){
    const dx=(x-pond.x)/pond.rx, dy=(y-pond.y)/pond.ry;
    if(dx*dx+dy*dy<1) t[y][x]='~';
  }
  // 開始地点と塔
  const start={x:Math.floor(W/2),y:H-4};
  const tower={x:Math.floor(W/2)+2,y:3};
  MAP.start=start; MAP.tower=tower;
  const clearAround=(cx,cy,r,fill)=>{
    for(let y=cy-r;y<=cy+r;y++)for(let x=cx-r;x<=cx+r;x++)
      if(x>0&&x<W-1&&y>0&&y<H-1) t[y][x]=fill;
  };
  clearAround(start.x,start.y,2,'.');
  // 塔へ蛇行する道を掘る
  let x=start.x, y=start.y;
  const carve=(cx,cy)=>{
    if(cx<=1||cx>=W-2||cy<=1||cy>=H-2) return;
    // 道の周囲の木を除去して通れる幅を確保
    for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
      const nx=cx+i,ny=cy+j;
      if(nx>0&&nx<W-1&&ny>0&&ny<H-1 && t[ny][nx]==='T') t[ny][nx]='.';
    }
    t[cy][cx] = (t[cy][cx]==='~') ? '=' : '#';
  };
  let guard=0;
  while(y>tower.y+1 && guard++<2000){
    carve(x,y);
    const towardX = tower.x>x?1:(tower.x<x?-1:0);
    const r=rnd();
    if(r<0.60) y--;
    else if(r<0.80) x=clamp(x+towardX*(chance(.7)?1:0)+ (chance(.5)?1:-1),2,W-3);
    else x=clamp(x+towardX,2,W-3);
  }
  // 塔手前を横に接続
  while(x!==tower.x){ carve(x,y); x+=x<tower.x?1:-1; }
  while(y>tower.y){ carve(x,y); y--; }
  clearAround(tower.x,tower.y,2,'.');
  // 塔の広場は道タイルに
  for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++) if(t[tower.y+1+j])t[tower.y+1+j][tower.x+i]='#';
  t[tower.y][tower.x]='O';

  // 花畑をところどころに
  for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++){
    if(t[y][x]==='.' && vnoise(x*0.35+40,y*0.35+9)>0.70) t[y][x]=',';
  }

  // 宝箱を数個（草の上、開始・塔から離れた場所）
  let chests=0, tries=0;
  while(chests<4 && tries++<400){
    const cx=2+Math.floor(rnd()*(W-4)), cy=2+Math.floor(rnd()*(H-4));
    if((t[cy][cx]==='.'||t[cy][cx]===',') &&
       Math.hypot(cx-start.x,cy-start.y)>7 &&
       Math.hypot(cx-tower.x,cy-tower.y)>4){
      t[cy][cx]='C'; chests++;
    }
  }
  MAP.t=t;
}
function tileAt(x,y){ if(x<0||y<0||x>=MAP.W||y>=MAP.H) return 'T'; return MAP.t[y][x]; }
function walkable(x,y){ return !BLOCKED.has(tileAt(x,y)); }

/* =====================================================================
   エンティティ
   ===================================================================== */
const player = {
  fx:0,fy:0, gx:0,gy:0, facing:'down', move:null, walkPhase:0,
  lv:1, xp:0, next:12, hp:36, maxhp:36, mp:14, maxmp:14, atk:11, def:5, gold:0,
  invuln:0
};
let enemies = [];
let chestGold = {}; // key "x,y" -> amount
let bossDefeated = false;

const ENEMY_DATA = {
  slime:{name:'スライム',       hp:16, atk:7,  def:2, xp:7,  gold:6,  col:'#4fd07a', draw:'slime'},
  bat:  {name:'ヴァンパイアバット',hp:22, atk:11, def:3, xp:12, gold:11, col:'#a06bff', draw:'bat'},
  wolf: {name:'シャドウウルフ',   hp:34, atk:15, def:6, xp:19, gold:16, col:'#5a6b9e', draw:'wolf'},
  golem:{name:'ストーンゴーレム', hp:60, atk:18, def:11,xp:34, gold:30, col:'#8a8578', draw:'golem'},
  boss: {name:'影の王 ノクス',    hp:150,atk:24, def:12,xp:0,  gold:0,  col:'#c04bff', draw:'boss', boss:true},
};
const ROAM_POOL = ['slime','slime','bat','bat','wolf','golem'];

function spawnEnemies(){
  enemies = [];
  let placed=0, tries=0;
  while(placed<8 && tries++<600){
    const x=2+Math.floor(rnd()*(MAP.W-4)), y=2+Math.floor(rnd()*(MAP.H-4));
    if(walkable(x,y) && tileAt(x,y)!=='#' &&
       Math.hypot(x-MAP.start.x,y-MAP.start.y)>6){
      const key = ROAM_POOL[Math.floor(rnd()*ROAM_POOL.length)];
      enemies.push({key, gx:x,gy:y,fx:x,fy:y, move:null, wait:rand(400,1600), phase:rand(0,6)});
      placed++;
    }
  }
}

/* =====================================================================
   カメラ
   ===================================================================== */
const cam={x:0,y:0};
function updateCamera(){
  const T=V.tile;
  const worldW=MAP.W*T, worldH=MAP.H*T;
  let cx = (player.fx+0.5)*T - V.w/2;
  let cy = (player.fy+0.5)*T - V.h/2;
  cam.x = worldW>V.w ? clamp(cx,0,worldW-V.w) : (worldW-V.w)/2;
  cam.y = worldH>V.h ? clamp(cy,0,worldH-V.h) : (worldH-V.h)/2;
}

/* =====================================================================
   入力
   ===================================================================== */
let heldDir=null;
const DIRV={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]};
function tryStartMove(dir){
  if(state!=='field'||player.move) return;
  player.facing=dir;
  const[dx,dy]=DIRV[dir];
  const nx=player.gx+dx, ny=player.gy+dy;
  if(!walkable(nx,ny)) { return; }
  player.move={sx:player.gx,sy:player.gy,tx:nx,ty:ny,t:0,dur:0.15};
}
document.addEventListener('keydown',e=>{
  const m={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',w:'up',s:'down',a:'left',d:'right',W:'up',S:'down',A:'left',D:'right'};
  if(m[e.key]){heldDir=m[e.key];e.preventDefault();}
});
document.addEventListener('keyup',e=>{
  const m={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',w:'up',s:'down',a:'left',d:'right',W:'up',S:'down',A:'left',D:'right'};
  if(m[e.key]&&heldDir===m[e.key]) heldDir=null;
});
// 十字キー
pad.querySelectorAll('.dbtn').forEach(b=>{
  const dir=b.dataset.dir;
  const on=e=>{e.preventDefault();heldDir=dir;};
  const off=e=>{e.preventDefault();if(heldDir===dir)heldDir=null;};
  b.addEventListener('pointerdown',on);
  b.addEventListener('pointerup',off);
  b.addEventListener('pointerleave',off);
  b.addEventListener('pointercancel',off);
});
// スワイプ（画面ドラッグでジョイスティック的に）
let swipe=null;
cv.addEventListener('pointerdown',e=>{ if(state==='field'){swipe={x:e.clientX,y:e.clientY};} });
cv.addEventListener('pointermove',e=>{
  if(!swipe||state!=='field')return;
  const dx=e.clientX-swipe.x, dy=e.clientY-swipe.y;
  const th=18;
  if(Math.abs(dx)<th && Math.abs(dy)<th){heldDir=null;return;}
  heldDir = Math.abs(dx)>Math.abs(dy) ? (dx>0?'right':'left') : (dy>0?'down':'up');
});
const endSwipe=()=>{swipe=null;heldDir=heldDir&&pad.contains(document.activeElement)?heldDir:null;heldDir=null;};
cv.addEventListener('pointerup',()=>{swipe=null;heldDir=null;});
cv.addEventListener('pointercancel',()=>{swipe=null;heldDir=null;});

/* =====================================================================
   フィールド更新
   ===================================================================== */
const fireflies = Array.from({length:26},()=>({x:rand(0,1),y:rand(0,1),ph:rand(0,6.28),sp:rand(.2,.6)}));

function updateField(dt){
  // プレイヤー移動
  if(!player.move && heldDir) tryStartMove(heldDir);
  if(player.move){
    const m=player.move; m.t+=dt/m.dur;
    player.walkPhase+=dt*10;
    if(m.t>=1){
      player.gx=m.tx; player.gy=m.ty; player.fx=m.tx; player.fy=m.ty; player.move=null;
      onArrive();
    } else {
      const e=m.t;
      player.fx=lerp(m.sx,m.tx,e); player.fy=lerp(m.sy,m.ty,e);
    }
  } else { player.walkPhase*=Math.max(0,1-dt*6); }

  if(player.invuln>0) player.invuln-=dt;

  // 敵ローミング
  for(const en of enemies){
    en.phase+=dt;
    if(en.move){
      const m=en.move; m.t+=dt/m.dur;
      if(m.t>=1){en.gx=m.tx;en.gy=m.ty;en.fx=m.tx;en.fy=m.ty;en.move=null;en.wait=rand(500,1800);}
      else{const e=easeInOut(clamp(m.t,0,1));en.fx=lerp(m.sx,m.tx,e);en.fy=lerp(m.sy,m.ty,e);}
    } else {
      en.wait-=dt*1000;
      if(en.wait<=0){
        const dirs=Object.values(DIRV).sort(()=>rnd()-0.5);
        for(const[dx,dy]of dirs){
          const nx=en.gx+dx,ny=en.gy+dy;
          if(walkable(nx,ny)&&tileAt(nx,ny)!=='O'){en.move={sx:en.gx,sy:en.gy,tx:nx,ty:ny,t:0,dur:0.28};break;}
        }
        if(!en.move) en.wait=rand(400,900);
      }
    }
    // 接触判定
    if(player.invuln<=0 && Math.hypot(en.fx-player.fx,en.fy-player.fy)<0.62){
      encounter(en);
      return;
    }
  }

  // 蛍
  for(const f of fireflies){ f.ph+=dt*f.sp*3; }
  updateCamera();
}

function onArrive(){
  const t=tileAt(player.gx,player.gy);
  if(t==='C'){ openChest(player.gx,player.gy); }
  // 塔隣接でボス戦
  if(!bossDefeated){
    for(const[dx,dy]of Object.values(DIRV)){
      if(tileAt(player.gx+dx,player.gy+dy)==='O'){ startBossIntro(); return; }
    }
  } else {
    for(const[dx,dy]of Object.values(DIRV)){
      if(tileAt(player.gx+dx,player.gy+dy)==='O'){ showEnding(); return; }
    }
  }
  // ランダムエンカウント
  if((t==='.'||t===',') && chance(0.055) && player.invuln<=0){
    const key=ROAM_POOL[Math.floor(Math.random()*ROAM_POOL.length)];
    startBattle(key,null);
  }
}

function openChest(x,y){
  const key=x+','+y;
  const amount = chestGold[key] ?? (chestGold[key]=Math.round(rand(18,55)));
  MAP.t[y][x]='.';
  player.gold+=amount;
  spawnFloatWorld(x,y,'+'+amount+' G','#ffd45e');
  for(let i=0;i<20;i++) fieldSpark.push({x,y,vx:rand(-1.4,1.4),vy:rand(-2.2,-.4),life:1,col:'#ffd45e'});
  updateHUD();
}

/* フィールドの簡易パーティクル／数字 */
let fieldSpark=[];
let worldFloats=[];
function spawnFloatWorld(gx,gy,text,col){ worldFloats.push({x:gx,y:gy,text,col,life:1.2}); }

/* =====================================================================
   バトル
   ===================================================================== */
let state='title';
let battle=null;
let floaters=[];   // 戦闘中ダメージ数字
let fx=[];         // 戦闘パーティクル
let shake=0, redFlash=0, whiteFlash=0;
const tweens=[];
function tween(obj,props,dur,ease=easeInOut){
  return new Promise(res=>{
    const from={}; for(const k in props) from[k]=obj[k]||0;
    tweens.push({obj,from,to:props,dur:dur/1000,t:0,ease,res});
  });
}
function updateTweens(dt){
  for(let i=tweens.length-1;i>=0;i--){
    const tw=tweens[i]; tw.t+=dt;
    const k=clamp(tw.t/tw.dur,0,1), e=tw.ease(k);
    for(const key in tw.to) tw.obj[key]=lerp(tw.from[key],tw.to[key],e);
    if(k>=1){tweens.splice(i,1);tw.res();}
  }
}

function encounter(en){
  enemies.splice(enemies.indexOf(en),1);
  startBattle(en.key,en);
}

async function startBossIntro(){
  await startBattle('boss',null,true);
}

async function startBattle(key,source,isBoss){
  const d=ENEMY_DATA[key];
  // ローミング敵は少しレベルスケール
  const scale = key==='boss'?1: (1 + (player.lv-1)*0.08);
  battle={
    key, data:d, isBoss:!!(d.boss),
    ehp:Math.round(d.hp*scale), emaxhp:Math.round(d.hp*scale),
    eatk:Math.round(d.atk*scale), edef:d.def,
    xp:Math.round(d.xp*scale), gold:Math.round(d.gold*scale),
    hero:{ox:0,oy:0,flash:0,squash:0},
    enemy:{ox:0,oy:0,flash:0,scale:1,alpha:1,bob:0},
    over:false, source
  };
  floaters=[]; fx=[]; shake=0; redFlash=0;
  state='battle';
  fieldHud.classList.remove('hidden');
  pad.classList.add('hidden');
  battleUI.classList.remove('hidden');
  setMenu(false);
  // 登場演出
  battle.enemy.scale=0.2; battle.enemy.alpha=0;
  whiteFlash=0.7;
  say(battle.isBoss ? `塔の主 ${d.name} が立ちはだかる！` : `${d.name} が あらわれた！`);
  await tween(battle.enemy,{scale:1,alpha:1},520,easeBack);
  await sleep(battle.isBoss?700:350);
  await playerTurn();
}

function say(t){ battleMsg.innerHTML=t; }
function setMenu(on){
  battleMenu.style.pointerEvents=on?'auto':'none';
  battleMenu.style.opacity=on?'1':'0.45';
  battleMenu.querySelectorAll('.cmd').forEach(b=>{
    if(b.dataset.cmd==='fire') b.disabled = player.mp<4;
    else if(b.dataset.cmd==='heal') b.disabled = player.mp<3;
    else b.disabled=false;
  });
}

async function playerTurn(){
  if(battle.over) return;
  say('コマンドを えらぼう。');
  setMenu(true);
}

/* ダメージ計算 */
function physDmg(atk,def){
  let base=Math.max(1, atk - def*0.5);
  base*=rand(0.88,1.12);
  const crit=chance(0.13);
  return {dmg:Math.max(1,Math.round(base*(crit?1.9:1))), crit};
}

battleMenu.addEventListener('click',e=>{
  const b=e.target.closest('.cmd'); if(!b||b.disabled) return;
  if(battleMenu.style.pointerEvents==='none') return;
  const cmd=b.dataset.cmd;
  setMenu(false);
  if(cmd==='attack') doAttack();
  else if(cmd==='fire') doFire();
  else if(cmd==='heal') doHeal();
  else if(cmd==='run') doRun();
});

function heroBattlePos(){ return {x:V.w*0.26, y:V.h*0.62}; }
function enemyBattlePos(){ return {x:V.w*0.72, y:V.h*0.42}; }

async function doAttack(){
  say('アルトの こうげき！');
  const H=heroBattlePos(), E=enemyBattlePos();
  await tween(battle.hero,{ox:(E.x-H.x)*0.62, oy:(E.y-H.y)*0.4},150,easeIn);
  slashAt(E.x,E.y);
  shake=10;
  const {dmg,crit}=physDmg(player.atk,battle.edef);
  hitEnemy(dmg,crit);
  await tween(battle.hero,{ox:0,oy:0},220,easeOut);
  await afterPlayer();
}
async function doFire(){
  player.mp-=4; updateHUD();
  say('アルトは ファイアを となえた！');
  const H=heroBattlePos(), E=enemyBattlePos();
  await castGlow('#ff9a3c');
  await fireball(H.x,H.y-V.tile*0.4,E.x,E.y);
  fireBurst(E.x,E.y); shake=14; whiteFlash=0.25;
  let base=(16+player.lv*3)*rand(0.9,1.12);
  base -= battle.edef*0.25;
  hitEnemy(Math.max(1,Math.round(base)),false,'#ff8a2b');
  await sleep(220);
  await afterPlayer();
}
async function doHeal(){
  player.mp-=3; updateHUD();
  say('アルトは ヒールで きずを いやした！');
  const H=heroBattlePos();
  await castGlow('#54e07a');
  healSpark(H.x,H.y);
  const heal=Math.round(24+player.lv*4);
  const real=Math.min(heal,player.maxhp-player.hp);
  player.hp+=real; updateHUD();
  spawnFloat(H.x,H.y-V.tile*0.9,'+'+real,'#54e07a',false);
  await sleep(520);
  await afterPlayer();
}
async function doRun(){
  if(battle.isBoss){ say('ボスからは 逃げられない！'); await sleep(700); await enemyTurn(); return; }
  say('アルトは にげだした…');
  await sleep(500);
  if(chance(0.6)){
    say('うまく にげきった！');
    await sleep(600);
    player.invuln=1.4;
    endBattle(false);
  } else {
    say('しかし まわりこまれた！');
    await sleep(700);
    await enemyTurn();
  }
}

function hitEnemy(dmg,crit,col){
  battle.ehp=Math.max(0,battle.ehp-dmg);
  battle.enemy.flash=1;
  const E=enemyBattlePos();
  spawnFloat(E.x,E.y-V.tile*1.1,dmg+(crit?'!':''),col||(crit?'#ffd45e':'#ffffff'),crit);
  tween(battle.enemy,{ox:12},60,easeOut).then(()=>tween(battle.enemy,{ox:0},120,easeOut));
}

async function afterPlayer(){
  if(battle.ehp<=0){ await victory(); return; }
  await sleep(180);
  await enemyTurn();
}

async function enemyTurn(){
  if(battle.over) return;
  const E=enemyBattlePos(), H=heroBattlePos();
  say(`${battle.data.name}の こうげき！`);
  await sleep(120);
  await tween(battle.enemy,{ox:(H.x-E.x)*0.5, oy:(H.y-E.y)*0.4},170,easeIn);
  battle.hero.flash=1; redFlash=0.5; shake=12;
  const {dmg,crit}=physDmg(battle.eatk,player.def);
  player.hp=Math.max(0,player.hp-dmg); updateHUD();
  spawnFloat(H.x,H.y-V.tile*0.8,dmg+(crit?'!':''),'#ff5d6c',crit);
  await tween(battle.enemy,{ox:0,oy:0},240,easeOut);
  if(player.hp<=0){ await defeat(); return; }
  await sleep(160);
  await playerTurn();
}

async function victory(){
  battle.over=true;
  say(`${battle.data.name}を たおした！`);
  battle.enemy.flash=1;
  await tween(battle.enemy,{alpha:0,scale:1.35,oy:20},600,easeIn);
  await sleep(200);
  const gainXp=battle.xp, gainGold=battle.gold;
  player.xp+=gainXp; player.gold+=gainGold; updateHUD();
  const ups=[];
  while(player.xp>=player.next){ player.xp-=player.next; levelUp(ups); }
  if(battle.isBoss){ bossDefeated=true; showEnding(true); return; }
  let body=`<div><span class="reward">経験値 +${gainXp}</span> ／ <b class="g">${gainGold} ゴールド</b> 手に入れた！</div>`;
  if(ups.length){
    body+=`<div style="margin-top:12px" class="up">レベル ${player.lv} に あがった！</div>`;
    body+=`<div style="margin-top:4px;font-size:13px">`+ups.join(' ／ ')+`</div>`;
  }
  showEvent(ups.length?'levelup':'win', ups.length?'LEVEL UP!':'VICTORY', body, ups.length?'つづける':'つづける', ()=>{ resumeField(); });
}

function levelUp(ups){
  player.lv++;
  const dh=8+Math.floor(rand(0,3)), dm=3+Math.floor(rand(0,2)), da=3, dd=2;
  player.maxhp+=dh; player.maxmp+=dm; player.atk+=da; player.def+=dd;
  player.hp=player.maxhp; player.mp=player.maxmp;
  player.next=Math.round(player.next*1.7);
  ups.push(`HP+${dh}`,`MP+${dm}`,`ちから+${da}`,`まもり+${dd}`);
  updateHUD();
}

async function defeat(){
  battle.over=true;
  say('アルトは たおれてしまった…');
  await tween(battle.hero,{oy:40,flash:0},700,easeIn);
  await sleep(400);
  const lost=Math.round(player.gold*0.15);
  player.gold-=lost;
  showEvent('lose','GAME OVER',
    `<div>アルトは 力尽きた…</div><div style="margin-top:8px">${lost>0?`<b class="g">${lost} ゴールド</b> を失った。`:''}</div><div style="margin-top:8px">村で 目を覚ました。</div>`,
    'もう一度',()=>{ revive(); });
}

function revive(){
  player.hp=player.maxhp; player.mp=player.maxmp;
  player.gx=MAP.start.x; player.gy=MAP.start.y; player.fx=player.gx; player.fy=player.gy;
  player.invuln=1.5; player.move=null; heldDir=null;
  spawnEnemies();
  resumeField();
}

function endBattle(){
  battle=null; state='field';
  battleUI.classList.add('hidden');
  pad.classList.remove('hidden');
  heldDir=null;
  updateCamera();
}
function resumeField(){
  eventScreen.classList.add('hidden');
  endBattle();
  // 倒した敵の再出現
  if(enemies.length<6){
    setTimeout(()=>{ if(state==='field') respawnOne(); }, rand(3000,6000));
  }
}
function respawnOne(){
  let tries=0;
  while(tries++<200){
    const x=2+Math.floor(rnd()*(MAP.W-4)), y=2+Math.floor(rnd()*(MAP.H-4));
    if(walkable(x,y)&&tileAt(x,y)!=='#'&&Math.hypot(x-player.fx,y-player.fy)>8){
      const key=ROAM_POOL[Math.floor(rnd()*ROAM_POOL.length)];
      enemies.push({key,gx:x,gy:y,fx:x,fy:y,move:null,wait:rand(600,1600),phase:rand(0,6)});
      break;
    }
  }
}

/* ---------- 戦闘エフェクト ---------- */
function spawnFloat(x,y,text,col,crit){ floaters.push({x,y,vy:-1.2,life:1.1,text,col,crit,scale:crit?1.5:1}); }
function slashAt(x,y){
  for(let i=0;i<3;i++) fx.push({type:'slash',x,y,ang:-0.7+i*0.25,life:1,r:V.tile*0.9});
  for(let i=0;i<16;i++){const a=rand(0,6.28);fx.push({type:'spark',x,y,vx:Math.cos(a)*rand(2,7),vy:Math.sin(a)*rand(2,7),life:1,col:'#dfe9ff',r:rand(2,4)});}
}
async function castGlow(col){
  const H=heroBattlePos();
  for(let i=0;i<24;i++){const a=rand(0,6.28),d=rand(V.tile*0.6,V.tile*1.1);
    fx.push({type:'gather',x:H.x+Math.cos(a)*d,y:H.y+Math.sin(a)*d-V.tile*0.3,tx:H.x,ty:H.y-V.tile*0.4,life:1,col,r:rand(2,5)});}
  await sleep(360);
}
function fireball(x0,y0,x1,y1){
  return new Promise(res=>{
    const p={x:x0,y:y0};
    tween(p,{x:x1,y:y1},340,easeIn).then(res);
    const emit=setInterval(()=>{
      for(let i=0;i<3;i++)fx.push({type:'fire',x:p.x+rand(-6,6),y:p.y+rand(-6,6),vx:rand(-1,1),vy:rand(-1,1),life:1,r:rand(6,12)});
    },16);
    setTimeout(()=>clearInterval(emit),360);
  });
}
function fireBurst(x,y){
  for(let i=0;i<40;i++){const a=rand(0,6.28),s=rand(3,9);
    fx.push({type:'fire',x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-2,life:1,r:rand(8,18)});}
}
function healSpark(x,y){
  for(let i=0;i<26;i++){const a=rand(0,6.28),d=rand(0,V.tile*0.6);
    fx.push({type:'heal',x:x+Math.cos(a)*d,y:y+rand(10,V.tile*0.6),vy:rand(-3,-1.2),life:1,col:'#8effb0',r:rand(3,6)});}
  fx.push({type:'ring',x,y:y-V.tile*0.4,life:1,r:10,col:'#54e07a'});
}

function updateFx(dt){
  for(let i=fx.length-1;i>=0;i--){
    const p=fx[i]; p.life-=dt*(p.type==='slash'?3.2:p.type==='ring'?2.2:1.8);
    if(p.type==='spark'||p.type==='fire'){ p.x+=p.vx; p.y+=p.vy; p.vy+=0.35; p.vx*=0.94; p.vy*=0.96; }
    else if(p.type==='heal'){ p.y+=p.vy; p.vy*=0.98; }
    else if(p.type==='gather'){ p.x=lerp(p.x,p.tx,0.18); p.y=lerp(p.y,p.ty,0.18); }
    if(p.life<=0) fx.splice(i,1);
  }
  for(let i=floaters.length-1;i>=0;i--){const f=floaters[i];f.y+=f.vy;f.vy*=0.92;f.life-=dt*1.1;if(f.life<=0)floaters.splice(i,1);}
  if(battle){ battle.enemy.flash=Math.max(0,battle.enemy.flash-dt*4); battle.hero.flash=Math.max(0,battle.hero.flash-dt*4); battle.enemy.bob+=dt; }
  shake=Math.max(0,shake-dt*40);
  redFlash=Math.max(0,redFlash-dt*1.6);
  whiteFlash=Math.max(0,whiteFlash-dt*2.2);
}

/* =====================================================================
   HUD
   ===================================================================== */
function updateHUD(){
  el('hud-lv').textContent='Lv.'+player.lv;
  el('hud-hp').style.width=(player.hp/player.maxhp*100)+'%';
  el('hud-mp').style.width=(player.mp/player.maxmp*100)+'%';
  el('hud-hp-num').textContent=player.hp+'/'+player.maxhp;
  el('hud-mp-num').textContent=player.mp+'/'+player.maxmp;
  el('hud-gold').textContent=player.gold;
}

/* =====================================================================
   描画 : タイル
   ===================================================================== */
function drawGrass(g,px,py,T,x,y){
  const v=hash(x,y);
  const base=mix('#2f7d43','#3d9954',v*0.6);
  const top=shade(base,0.10);
  const grd=g.createLinearGradient(px,py,px,py+T);
  grd.addColorStop(0,top); grd.addColorStop(1,shade(base,-0.10));
  g.fillStyle=grd; g.fillRect(px,py,T+1,T+1);
  // 草の斑点
  g.fillStyle=shade(base,0.16);
  for(let i=0;i<3;i++){const hx=hash(x*7+i,y*13+i),hy=hash(x*3+i,y*17+i);
    g.fillRect(px+hx*T,py+hy*T,2,2);}
}
function drawFlower(g,px,py,T,x,y){
  drawGrass(g,px,py,T,x,y);
  const cols=['#ff6f91','#ffd45e','#8ecbff','#c58bff'];
  for(let i=0;i<3;i++){
    const c=cols[Math.floor(hash(x*5+i,y*9+i)*cols.length)];
    const fx2=px+ (0.2+hash(x+i,y)*0.6)*T, fy2=py+(0.25+hash(x,y+i)*0.6)*T;
    g.fillStyle=c;
    for(let k=0;k<5;k++){const a=k/5*6.28;g.beginPath();g.arc(fx2+Math.cos(a)*2.6,fy2+Math.sin(a)*2.6,2,0,6.28);g.fill();}
    g.fillStyle='#fff6c0';g.beginPath();g.arc(fx2,fy2,1.6,0,6.28);g.fill();
  }
}
function drawPath(g,px,py,T,x,y){
  const v=hash(x,y);
  const grd=g.createLinearGradient(px,py,px,py+T);
  grd.addColorStop(0,mix('#c9a26b','#d8b57e',v)); grd.addColorStop(1,'#a9813f');
  g.fillStyle=grd; g.fillRect(px,py,T+1,T+1);
  g.fillStyle='rgba(120,86,40,.45)';
  for(let i=0;i<4;i++){const hx=hash(x*11+i,y*7+i),hy=hash(x*5+i,y*3+i);g.fillRect(px+hx*T,py+hy*T,3,3);}
}
function drawWater(g,px,py,T,x,y,t){
  const grd=g.createLinearGradient(px,py,px,py+T);
  grd.addColorStop(0,'#2a6fd6'); grd.addColorStop(1,'#123a86');
  g.fillStyle=grd; g.fillRect(px,py,T+1,T+1);
  g.strokeStyle='rgba(255,255,255,.28)'; g.lineWidth=1.5;
  for(let i=0;i<2;i++){
    const yy=py+T*(0.35+i*0.32)+Math.sin(t*1.6+x*0.7+i)*2.2;
    g.beginPath();
    g.moveTo(px,yy);
    g.quadraticCurveTo(px+T*0.5,yy+Math.sin(t*2+x)*2.5,px+T,yy);
    g.stroke();
  }
}
function drawBridge(g,px,py,T,x,y,t){
  drawWater(g,px,py,T,x,y,t);
  const grd=g.createLinearGradient(px,py,px,py+T);
  grd.addColorStop(0,'#a9793f');grd.addColorStop(1,'#7c5427');
  g.fillStyle=grd; g.fillRect(px,py+T*0.12,T+1,T*0.76);
  g.fillStyle='rgba(0,0,0,.22)';
  for(let i=0;i<4;i++)g.fillRect(px+i*(T/4),py+T*0.12,1.5,T*0.76);
  g.fillStyle='#5c3d1c';g.fillRect(px,py+T*0.12,T+1,3);g.fillRect(px,py+T*0.85,T+1,3);
}
function drawTree(g,px,py,T,x,y){
  drawGrass(g,px,py,T,x,y);
  const cx=px+T/2, by=py+T*0.92;
  g.fillStyle='rgba(0,0,0,.22)';g.beginPath();g.ellipse(cx,by,T*0.32,T*0.12,0,0,6.28);g.fill();
  // 幹
  g.fillStyle='#6b4426';g.fillRect(cx-T*0.07,py+T*0.5,T*0.14,T*0.4);
  // 樹冠（重ね）
  const v=hash(x,y);
  const green=mix('#1f6b39','#2f8a49',v);
  const blobs=[[0,-0.05,0.34],[-0.2,0.08,0.24],[0.2,0.08,0.24],[0,0.18,0.26]];
  for(const[bx,byo,br]of blobs){
    g.fillStyle=shade(green,-0.12);
    g.beginPath();g.arc(cx+bx*T,py+T*0.42+byo*T+2,br*T,0,6.28);g.fill();
  }
  for(const[bx,byo,br]of blobs){
    g.fillStyle=green;
    g.beginPath();g.arc(cx+bx*T,py+T*0.42+byo*T,br*T,0,6.28);g.fill();
  }
  g.fillStyle=shade(green,0.20);
  g.beginPath();g.arc(cx-T*0.08,py+T*0.32,T*0.14,0,6.28);g.fill();
}
function drawRock(g,px,py,T,x,y){
  drawGrass(g,px,py,T,x,y);
  const cx=px+T/2,cy=py+T*0.6;
  g.fillStyle='rgba(0,0,0,.22)';g.beginPath();g.ellipse(cx,py+T*0.85,T*0.3,T*0.1,0,0,6.28);g.fill();
  const grd=g.createLinearGradient(px,cy-T*0.3,px,cy+T*0.3);
  grd.addColorStop(0,'#9aa0aa');grd.addColorStop(1,'#5c626e');
  g.fillStyle=grd;
  g.beginPath();
  g.moveTo(cx-T*0.28,cy+T*0.22);g.lineTo(cx-T*0.18,cy-T*0.18);g.lineTo(cx+T*0.06,cy-T*0.26);
  g.lineTo(cx+T*0.28,cy-T*0.05);g.lineTo(cx+T*0.24,cy+T*0.22);g.closePath();g.fill();
  g.fillStyle='rgba(255,255,255,.25)';
  g.beginPath();g.moveTo(cx-T*0.18,cy-T*0.18);g.lineTo(cx+T*0.06,cy-T*0.26);g.lineTo(cx-T*0.02,cy-T*0.05);g.closePath();g.fill();
}
function drawChest(g,px,py,T,x,y,t){
  drawGrass(g,px,py,T,x,y);
  const cx=px+T/2, by=py+T*0.78, w=T*0.46,h=T*0.3;
  g.fillStyle='rgba(0,0,0,.25)';g.beginPath();g.ellipse(cx,by+2,w*0.6,T*0.09,0,0,6.28);g.fill();
  const grd=g.createLinearGradient(px,by-h,px,by);
  grd.addColorStop(0,'#b9822f');grd.addColorStop(1,'#845516');
  g.fillStyle=grd;g.fillRect(cx-w/2,by-h,w,h);
  g.fillStyle='#6b3f10';g.fillRect(cx-w/2,by-h-T*0.12,w,T*0.14);
  g.fillStyle='#ffd45e';g.fillRect(cx-w/2,by-h-2,w,3);
  g.fillStyle='#fff2b0';g.fillRect(cx-T*0.03,by-h*0.7,T*0.06,T*0.16);
  // きらめき
  const gl=0.5+0.5*Math.sin(t*3+x);
  g.fillStyle=`rgba(255,240,180,${0.3+gl*0.4})`;
  g.beginPath();g.arc(cx+w*0.4,by-h-T*0.14,2+gl*2,0,6.28);g.fill();
}
function drawTower(g,px,py,T,x,y,t){
  drawPath(g,px,py,T,x,y);
  const cx=px+T/2;
  const baseY=py+T*0.95, topY=py-T*1.4;
  g.fillStyle='rgba(0,0,0,.3)';g.beginPath();g.ellipse(cx,baseY,T*0.5,T*0.14,0,0,6.28);g.fill();
  // 本体
  const grd=g.createLinearGradient(cx-T*0.4,0,cx+T*0.4,0);
  grd.addColorStop(0,'#3a4570');grd.addColorStop(.5,'#5765a0');grd.addColorStop(1,'#2c3358');
  g.fillStyle=grd;
  g.beginPath();
  g.moveTo(cx-T*0.34,baseY);g.lineTo(cx-T*0.26,topY+T*0.5);g.lineTo(cx+T*0.26,topY+T*0.5);g.lineTo(cx+T*0.34,baseY);g.closePath();g.fill();
  // 屋根
  g.fillStyle='#6b4bb0';
  g.beginPath();g.moveTo(cx-T*0.34,topY+T*0.55);g.lineTo(cx,topY-T*0.2);g.lineTo(cx+T*0.34,topY+T*0.55);g.closePath();g.fill();
  // 窓
  g.fillStyle='rgba(255,220,120,.85)';
  for(let i=0;i<3;i++){g.fillRect(cx-T*0.06,baseY-T*(0.5+i*0.55),T*0.12,T*0.2);}
  // クリスタル
  const gl=0.6+0.4*Math.sin(t*2);
  g.save();
  g.shadowColor='#c9a4ff';g.shadowBlur=20*gl;
  g.fillStyle=`rgba(200,150,255,${0.85})`;
  g.beginPath();g.moveTo(cx,topY-T*0.55);g.lineTo(cx-T*0.13,topY-T*0.15);g.lineTo(cx,topY+T*0.1);g.lineTo(cx+T*0.13,topY-T*0.15);g.closePath();g.fill();
  g.fillStyle=`rgba(255,255,255,${0.6*gl})`;
  g.beginPath();g.moveTo(cx,topY-T*0.5);g.lineTo(cx-T*0.05,topY-T*0.2);g.lineTo(cx+T*0.05,topY-T*0.2);g.closePath();g.fill();
  g.restore();
}

/* =====================================================================
   描画 : キャラクター（フィールド俯瞰）
   ===================================================================== */
function drawHeroField(g,cx,cy,T,facing,phase){
  const bob=Math.sin(phase*2)*T*0.03;
  const step=Math.sin(phase*2)*T*0.06;
  cy+=bob;
  // 影
  g.fillStyle='rgba(0,0,0,.28)';g.beginPath();g.ellipse(cx,cy+T*0.34,T*0.22,T*0.09,0,0,6.28);g.fill();
  // 足
  g.fillStyle='#33406e';
  g.fillRect(cx-T*0.12,cy+T*0.14+ (facing==='up'||facing==='down'?step:0),T*0.09,T*0.14);
  g.fillRect(cx+T*0.03,cy+T*0.14- (facing==='up'||facing==='down'?step:0),T*0.09,T*0.14);
  // マント（上向き時に見える）
  if(facing==='up'){g.fillStyle='#7a3bd0';g.beginPath();g.moveTo(cx-T*0.16,cy-T*0.1);g.lineTo(cx+T*0.16,cy-T*0.1);g.lineTo(cx+T*0.1,cy+T*0.2);g.lineTo(cx-T*0.1,cy+T*0.2);g.closePath();g.fill();}
  // 胴
  const bg=g.createLinearGradient(cx,cy-T*0.1,cx,cy+T*0.2);
  bg.addColorStop(0,'#5a7bd8');bg.addColorStop(1,'#3450a0');
  g.fillStyle=bg;
  g.beginPath();g.roundRect(cx-T*0.16,cy-T*0.06,T*0.32,T*0.26,T*0.08);g.fill();
  // ベルト
  g.fillStyle='#d9a441';g.fillRect(cx-T*0.16,cy+T*0.08,T*0.32,T*0.04);
  // 頭
  const hy=cy-T*0.2;
  g.fillStyle='#ffdab0';g.beginPath();g.arc(cx,hy,T*0.15,0,6.28);g.fill();
  // 髪
  g.fillStyle='#7a4a22';
  if(facing==='up'){g.beginPath();g.arc(cx,hy,T*0.16,0,6.28);g.fill();}
  else{
    g.beginPath();g.arc(cx,hy-T*0.02,T*0.16,Math.PI,0);g.fill();
    g.fillRect(cx-T*0.16,hy-T*0.05,T*0.32,T*0.06);
  }
  // 顔
  if(facing!=='up'){
    g.fillStyle='#26324f';
    if(facing==='down'){g.beginPath();g.arc(cx-T*0.06,hy+T*0.03,T*0.022,0,6.28);g.arc(cx+T*0.06,hy+T*0.03,T*0.022,0,6.28);g.fill();}
    else if(facing==='left'){g.beginPath();g.arc(cx-T*0.07,hy+T*0.03,T*0.024,0,6.28);g.fill();}
    else{g.beginPath();g.arc(cx+T*0.07,hy+T*0.03,T*0.024,0,6.28);g.fill();}
  }
  // 剣（背に）
  g.strokeStyle='#cfd8ee';g.lineWidth=T*0.03;
  g.beginPath();g.moveTo(cx+T*0.14,cy-T*0.12);g.lineTo(cx+T*0.22,cy-T*0.28);g.stroke();
}

function drawEnemyField(g,key,cx,cy,T,phase){
  g.fillStyle='rgba(0,0,0,.26)';g.beginPath();g.ellipse(cx,cy+T*0.3,T*0.2,T*0.08,0,0,6.28);g.fill();
  const s=T*0.7;
  if(key==='slime') drawSlime(g,cx,cy,s,phase,0);
  else if(key==='bat') drawBat(g,cx,cy-T*0.1,s,phase,0);
  else if(key==='wolf') drawWolf(g,cx,cy,s,phase,0);
  else drawGolem(g,cx,cy,s*0.9,phase,0);
}

/* =====================================================================
   描画 : クリーチャー（共通・戦闘でも使用）
   size s ≒ 描画高さの目安, t=時間, flash=0..1
   ===================================================================== */
function flashOverlay(g,path,flash){ if(flash<=0)return; g.globalAlpha=flash*0.85;g.fillStyle='#fff';path();g.globalAlpha=1; }

function drawSlime(g,x,y,s,t,flash){
  const sq=1+Math.sin(t*3)*0.06;
  const w=s*0.6*sq, h=s*0.5/sq;
  const body=()=>{g.beginPath();g.ellipse(x,y+s*0.05,w,h,0,0,6.28);
    g.moveTo(x-w,y+s*0.05);g.lineTo(x+w,y+s*0.05);g.closePath();};
  const grd=g.createLinearGradient(x,y-h,x,y+h);
  grd.addColorStop(0,shade('#4fd07a',0.25));grd.addColorStop(1,'#2a9e55');
  g.fillStyle=grd;
  g.beginPath();g.ellipse(x,y,w,h,0,Math.PI,0);g.rect(x-w,y,w*2,h*0.9);g.fill();
  g.beginPath();g.ellipse(x,y+h*0.9,w,h*0.3,0,0,6.28);g.fill();
  // ハイライト
  g.fillStyle='rgba(255,255,255,.5)';g.beginPath();g.ellipse(x-w*0.35,y-h*0.35,w*0.18,h*0.22,0,0,6.28);g.fill();
  // 目
  g.fillStyle='#12351f';g.beginPath();g.arc(x-w*0.28,y,w*0.1,0,6.28);g.arc(x+w*0.28,y,w*0.1,0,6.28);g.fill();
  g.fillStyle='#fff';g.beginPath();g.arc(x-w*0.3,y-w*0.04,w*0.04,0,6.28);g.arc(x+w*0.26,y-w*0.04,w*0.04,0,6.28);g.fill();
  flashOverlay(g,()=>{g.beginPath();g.ellipse(x,y,w,h,0,Math.PI,0);g.rect(x-w,y,w*2,h);g.fill();},flash);
}

function drawBat(g,x,y,s,t,flash){
  const flap=Math.sin(t*8)*0.5;
  const r=s*0.24;
  // 翼
  g.fillStyle='#6a3fb0';
  const wing=(dir)=>{g.beginPath();g.moveTo(x,y);
    g.quadraticCurveTo(x+dir*s*0.5,y-s*0.3-flap*s*0.2,x+dir*s*0.75,y+ (flap)*s*0.1);
    g.quadraticCurveTo(x+dir*s*0.55,y+s*0.12,x+dir*s*0.4,y+s*0.05);
    g.quadraticCurveTo(x+dir*s*0.45,y+s*0.2,x+dir*s*0.28,y+s*0.1);
    g.quadraticCurveTo(x+dir*s*0.3,y+s*0.24,x+dir*s*0.14,y+s*0.12);
    g.closePath();g.fill();};
  wing(1);wing(-1);
  // 体
  const grd=g.createLinearGradient(x,y-r,x,y+r);grd.addColorStop(0,'#8a5bd8');grd.addColorStop(1,'#4b277f');
  g.fillStyle=grd;g.beginPath();g.arc(x,y,r,0,6.28);g.fill();
  // 耳
  g.fillStyle='#4b277f';
  g.beginPath();g.moveTo(x-r*0.5,y-r*0.6);g.lineTo(x-r*0.2,y-r*1.3);g.lineTo(x-r*0.05,y-r*0.7);g.closePath();
  g.moveTo(x+r*0.5,y-r*0.6);g.lineTo(x+r*0.2,y-r*1.3);g.lineTo(x+r*0.05,y-r*0.7);g.closePath();g.fill();
  // 目
  g.fillStyle='#ffd45e';g.beginPath();g.arc(x-r*0.35,y-r*0.05,r*0.16,0,6.28);g.arc(x+r*0.35,y-r*0.05,r*0.16,0,6.28);g.fill();
  g.fillStyle='#7a1020';g.beginPath();g.arc(x-r*0.35,y-r*0.05,r*0.07,0,6.28);g.arc(x+r*0.35,y-r*0.05,r*0.07,0,6.28);g.fill();
  // 牙
  g.fillStyle='#fff';g.beginPath();g.moveTo(x-r*0.15,y+r*0.4);g.lineTo(x-r*0.05,y+r*0.65);g.lineTo(x+r*0.02,y+r*0.4);g.closePath();
  g.moveTo(x+r*0.15,y+r*0.4);g.lineTo(x+r*0.05,y+r*0.65);g.lineTo(x-r*0.02,y+r*0.4);g.closePath();g.fill();
  flashOverlay(g,()=>{g.beginPath();g.arc(x,y,r*1.1,0,6.28);g.fill();},flash);
}

function drawWolf(g,x,y,s,t,flash){
  const br=Math.sin(t*4)*s*0.02;
  const bodyGrd=g.createLinearGradient(x,y-s*0.3,x,y+s*0.3);
  bodyGrd.addColorStop(0,'#6c7aa8');bodyGrd.addColorStop(1,'#33405f');
  g.fillStyle=bodyGrd;
  // 胴
  g.beginPath();g.ellipse(x,y+s*0.08+br,s*0.42,s*0.24,0,0,6.28);g.fill();
  // 脚
  g.fillStyle='#2b3550';
  for(const dx of[-0.3,-0.12,0.12,0.3])g.fillRect(x+dx*s,y+s*0.2,s*0.07,s*0.2);
  // 頭
  g.fillStyle=bodyGrd;g.beginPath();g.arc(x-s*0.34,y-s*0.02+br,s*0.2,0,6.28);g.fill();
  // 鼻先
  g.fillStyle='#232c44';g.beginPath();g.moveTo(x-s*0.5,y-s*0.02);g.lineTo(x-s*0.66,y+s*0.04);g.lineTo(x-s*0.5,y+s*0.1);g.closePath();g.fill();
  // 耳
  g.fillStyle='#33405f';
  g.beginPath();g.moveTo(x-s*0.4,y-s*0.16);g.lineTo(x-s*0.46,y-s*0.34);g.lineTo(x-s*0.3,y-s*0.2);g.closePath();
  g.moveTo(x-s*0.28,y-s*0.16);g.lineTo(x-s*0.24,y-s*0.34);g.lineTo(x-s*0.16,y-s*0.18);g.closePath();g.fill();
  // 尾
  g.strokeStyle='#33405f';g.lineWidth=s*0.1;g.lineCap='round';
  g.beginPath();g.moveTo(x+s*0.4,y);g.quadraticCurveTo(x+s*0.66,y-s*0.1,x+s*0.6,y-s*0.28+Math.sin(t*5)*s*0.05);g.stroke();
  // 目
  g.fillStyle='#ff5d6c';g.beginPath();g.arc(x-s*0.38,y-s*0.05,s*0.045,0,6.28);g.fill();
  flashOverlay(g,()=>{g.beginPath();g.ellipse(x,y+s*0.08,s*0.42,s*0.24,0,0,6.28);g.arc(x-s*0.34,y-s*0.02,s*0.2,0,6.28);g.fill();},flash);
}

function drawGolem(g,x,y,s,t,flash){
  const br=Math.sin(t*2)*s*0.02;y+=br;
  const stone=g.createLinearGradient(x,y-s*0.4,x,y+s*0.4);
  stone.addColorStop(0,'#9a958a');stone.addColorStop(1,'#5f5a50');
  g.fillStyle=stone;
  // 腕
  g.beginPath();g.roundRect(x-s*0.5,y-s*0.1,s*0.16,s*0.42,s*0.05);g.roundRect(x+s*0.34,y-s*0.1,s*0.16,s*0.42,s*0.05);g.fill();
  // 胴
  g.beginPath();g.roundRect(x-s*0.32,y-s*0.28,s*0.64,s*0.6,s*0.08);g.fill();
  // 頭
  g.beginPath();g.roundRect(x-s*0.2,y-s*0.5,s*0.4,s*0.28,s*0.06);g.fill();
  // ひび
  g.strokeStyle='rgba(0,0,0,.3)';g.lineWidth=2;
  g.beginPath();g.moveTo(x-s*0.1,y-s*0.2);g.lineTo(x,y);g.lineTo(x-s*0.06,y+s*0.2);g.stroke();
  // コア（光る）
  const gl=0.6+0.4*Math.sin(t*3);
  g.save();g.shadowColor='#ff9a3c';g.shadowBlur=14*gl;
  g.fillStyle=`rgba(255,150,60,${0.9})`;g.beginPath();g.arc(x,y+s*0.02,s*0.08,0,6.28);g.fill();g.restore();
  // 目
  g.fillStyle='#ffcf5e';g.beginPath();g.arc(x-s*0.08,y-s*0.36,s*0.04,0,6.28);g.arc(x+s*0.08,y-s*0.36,s*0.04,0,6.28);g.fill();
  flashOverlay(g,()=>{g.beginPath();g.roundRect(x-s*0.32,y-s*0.28,s*0.64,s*0.6,s*0.08);g.roundRect(x-s*0.2,y-s*0.5,s*0.4,s*0.28,s*0.06);g.fill();},flash);
}

function drawBoss(g,x,y,s,t,flash){
  const br=Math.sin(t*1.6)*s*0.03;y+=br;
  // オーラ
  const gl=0.5+0.5*Math.sin(t*2);
  g.save();g.globalCompositeOperation='lighter';
  const aur=g.createRadialGradient(x,y,s*0.1,x,y,s*0.9);
  aur.addColorStop(0,`rgba(150,60,220,${0.35*gl})`);aur.addColorStop(1,'rgba(150,60,220,0)');
  g.fillStyle=aur;g.beginPath();g.arc(x,y,s*0.9,0,6.28);g.fill();g.restore();
  // マント
  g.fillStyle='#2a1550';
  g.beginPath();g.moveTo(x,y-s*0.4);
  g.quadraticCurveTo(x-s*0.7,y-s*0.1,x-s*0.5,y+s*0.55+Math.sin(t*2)*s*0.04);
  g.lineTo(x+s*0.5,y+s*0.55+Math.sin(t*2+1)*s*0.04);
  g.quadraticCurveTo(x+s*0.7,y-s*0.1,x,y-s*0.4);g.closePath();g.fill();
  // 鎧
  const arm=g.createLinearGradient(x,y-s*0.3,x,y+s*0.3);
  arm.addColorStop(0,'#4b3a7a');arm.addColorStop(1,'#2a1e4a');
  g.fillStyle=arm;g.beginPath();g.roundRect(x-s*0.26,y-s*0.24,s*0.52,s*0.55,s*0.08);g.fill();
  // 肩
  g.fillStyle='#5a4590';
  g.beginPath();g.moveTo(x-s*0.34,y-s*0.2);g.lineTo(x-s*0.18,y-s*0.3);g.lineTo(x-s*0.12,y-s*0.1);g.closePath();
  g.moveTo(x+s*0.34,y-s*0.2);g.lineTo(x+s*0.18,y-s*0.3);g.lineTo(x+s*0.12,y-s*0.1);g.closePath();g.fill();
  // 兜
  g.fillStyle='#3a2a66';g.beginPath();g.roundRect(x-s*0.17,y-s*0.5,s*0.34,s*0.3,s*0.06);g.fill();
  // 角
  g.fillStyle='#c9b3ff';
  g.beginPath();g.moveTo(x-s*0.15,y-s*0.48);g.lineTo(x-s*0.3,y-s*0.72);g.lineTo(x-s*0.06,y-s*0.5);g.closePath();
  g.moveTo(x+s*0.15,y-s*0.48);g.lineTo(x+s*0.3,y-s*0.72);g.lineTo(x+s*0.06,y-s*0.5);g.closePath();g.fill();
  // 目
  g.save();g.shadowColor='#ff3b6b';g.shadowBlur=12;
  g.fillStyle='#ff3b6b';g.beginPath();g.arc(x-s*0.07,y-s*0.36,s*0.04,0,6.28);g.arc(x+s*0.07,y-s*0.36,s*0.04,0,6.28);g.fill();g.restore();
  // 剣
  g.strokeStyle='#c9a4ff';g.lineWidth=s*0.05;g.lineCap='round';
  g.beginPath();g.moveTo(x+s*0.28,y+s*0.3);g.lineTo(x+s*0.55,y-s*0.4);g.stroke();
  flashOverlay(g,()=>{g.beginPath();g.roundRect(x-s*0.26,y-s*0.24,s*0.52,s*0.55,s*0.08);g.roundRect(x-s*0.17,y-s*0.5,s*0.34,s*0.3,s*0.06);g.fill();},flash);
}

function drawHeroBack(g,x,y,s,flash,phase){
  // 背後からの勇者（戦闘）
  g.fillStyle='rgba(0,0,0,.25)';g.beginPath();g.ellipse(x,y+s*0.42,s*0.3,s*0.1,0,0,6.28);g.fill();
  // マント
  const cg=g.createLinearGradient(x,y-s*0.3,x,y+s*0.4);cg.addColorStop(0,'#8a3bd0');cg.addColorStop(1,'#5a1fa0');
  g.fillStyle=cg;
  g.beginPath();g.moveTo(x-s*0.2,y-s*0.28);g.lineTo(x+s*0.2,y-s*0.28);
  g.quadraticCurveTo(x+s*0.26,y+s*0.2,x+s*0.14,y+s*0.4);
  g.lineTo(x-s*0.14,y+s*0.4);g.quadraticCurveTo(x-s*0.26,y+s*0.2,x-s*0.2,y-s*0.28);g.closePath();g.fill();
  // 頭（後頭部）
  g.fillStyle='#ffdab0';g.beginPath();g.arc(x,y-s*0.34,s*0.15,0,6.28);g.fill();
  g.fillStyle='#7a4a22';g.beginPath();g.arc(x,y-s*0.36,s*0.16,0,6.28);g.fill();
  // 剣を構える
  g.strokeStyle='#e6ecff';g.lineWidth=s*0.05;g.lineCap='round';
  g.beginPath();g.moveTo(x+s*0.16,y+s*0.1);g.lineTo(x+s*0.4,y-s*0.5);g.stroke();
  g.fillStyle='#d9a441';g.fillRect(x+s*0.1,y+s*0.05,s*0.14,s*0.05);
  flashOverlay(g,()=>{g.beginPath();g.arc(x,y-s*0.34,s*0.18,0,6.28);g.rect(x-s*0.2,y-s*0.28,s*0.4,s*0.68);g.fill();},flash);
}

/* =====================================================================
   メイン描画
   ===================================================================== */
function renderField(){
  const T=V.tile, now=performance.now()/1000;
  ctx.fillStyle='#0e1524';ctx.fillRect(0,0,V.w,V.h);
  const x0=Math.floor(cam.x/T), y0=Math.floor(cam.y/T);
  const x1=Math.ceil((cam.x+V.w)/T), y1=Math.ceil((cam.y+V.h)/T);
  // 地面レイヤ
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const px=Math.round(x*T-cam.x), py=Math.round(y*T-cam.y);
    const c=tileAt(x,y);
    if(c==='~') drawWater(ctx,px,py,T,x,y,now);
    else if(c==='=') drawBridge(ctx,px,py,T,x,y,now);
    else if(c==='#') drawPath(ctx,px,py,T,x,y);
    else if(c===',') drawFlower(ctx,px,py,T,x,y);
    else drawGrass(ctx,px,py,T,x,y);
  }
  // オブジェクト（y順）
  const objs=[];
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const c=tileAt(x,y);
    if(c==='T') objs.push({y:y+0.9,fn:()=>drawTree(ctx,x*T-cam.x,y*T-cam.y,T,x,y)});
    else if(c==='R') objs.push({y:y+0.6,fn:()=>drawRock(ctx,x*T-cam.x,y*T-cam.y,T,x,y)});
    else if(c==='C') objs.push({y:y+0.8,fn:()=>drawChest(ctx,x*T-cam.x,y*T-cam.y,T,x,y,now)});
    else if(c==='O') objs.push({y:y+0.95,fn:()=>drawTower(ctx,x*T-cam.x,y*T-cam.y,T,x,y,now)});
  }
  for(const en of enemies) objs.push({y:en.fy+0.5,fn:()=>drawEnemyField(ctx,en.key,(en.fx+0.5)*T-cam.x,(en.fy+0.5)*T-cam.y,T,en.phase)});
  objs.push({y:player.fy+0.5,fn:()=>{
    const px=(player.fx+0.5)*T-cam.x, py=(player.fy+0.5)*T-cam.y;
    if(player.invuln>0 && Math.floor(player.invuln*12)%2===0) ctx.globalAlpha=0.5;
    drawHeroField(ctx,px,py,T,player.facing,player.walkPhase);
    ctx.globalAlpha=1;
  }});
  objs.sort((a,b)=>a.y-b.y);
  for(const o of objs) o.fn();

  // フィールドのきらめき
  for(let i=fieldSpark.length-1;i>=0;i--){const p=fieldSpark[i];
    const px=(p.x+0.5)*T-cam.x+p.vx*10,py=(p.y+0.3)*T-cam.y+p.vy*10;
    ctx.globalAlpha=p.life;ctx.fillStyle=p.col;ctx.beginPath();ctx.arc(px,py,3*p.life,0,6.28);ctx.fill();ctx.globalAlpha=1;
    p.vy+=0.05;p.x+=p.vx*0.02;p.y+=p.vy*0.02;p.life-=0.02;if(p.life<=0)fieldSpark.splice(i,1);}
  // ワールド数字
  for(let i=worldFloats.length-1;i>=0;i--){const f=worldFloats[i];
    const px=(f.x+0.5)*T-cam.x, py=(f.y)*T-cam.y-(1.2-f.life)*30;
    ctx.globalAlpha=clamp(f.life,0,1);ctx.font=`800 ${Math.round(T*0.34)}px sans-serif`;ctx.textAlign='center';
    ctx.lineWidth=4;ctx.strokeStyle='rgba(0,0,0,.6)';ctx.strokeText(f.text,px,py);
    ctx.fillStyle=f.col;ctx.fillText(f.text,px,py);ctx.globalAlpha=1;f.life-=0.02;if(f.life<=0)worldFloats.splice(i,1);}
  ctx.textAlign='left';

  // 蛍（夜の雰囲気）
  ctx.save();ctx.globalCompositeOperation='lighter';
  for(const f of fireflies){
    const px=f.x*V.w, py=f.y*V.h+Math.sin(f.ph)*10;
    const a=0.25+0.35*(0.5+0.5*Math.sin(f.ph*1.7));
    ctx.fillStyle=`rgba(180,255,150,${a})`;ctx.beginPath();ctx.arc(px,py,2.5,0,6.28);ctx.fill();
  }
  ctx.restore();
  // 画面周辺のビネット
  const vg=ctx.createRadialGradient(V.w/2,V.h/2,V.h*0.3,V.w/2,V.h/2,V.h*0.85);
  vg.addColorStop(0,'rgba(0,0,0,0)');vg.addColorStop(1,'rgba(0,0,0,.5)');
  ctx.fillStyle=vg;ctx.fillRect(0,0,V.w,V.h);
}

function renderBattle(){
  const now=performance.now()/1000;
  const sx=(Math.random()-0.5)*shake, sy=(Math.random()-0.5)*shake;
  ctx.save();ctx.translate(sx,sy);
  // 背景（塔内 / 森の夜）
  const bg=ctx.createLinearGradient(0,0,0,V.h);
  if(battle.isBoss){bg.addColorStop(0,'#1a0e2e');bg.addColorStop(1,'#0a0616');}
  else{bg.addColorStop(0,'#132447');bg.addColorStop(0.6,'#0e1830');bg.addColorStop(1,'#0a1020');}
  ctx.fillStyle=bg;ctx.fillRect(-20,-20,V.w+40,V.h+40);
  // 星／塵
  ctx.save();ctx.globalCompositeOperation='lighter';
  for(let i=0;i<40;i++){const hx=hash(i,3),hy=hash(i,7);
    const a=0.2+0.2*Math.sin(now*2+i);ctx.fillStyle=`rgba(200,210,255,${a})`;
    ctx.fillRect(hx*V.w,hy*V.h*0.6,1.5,1.5);}
  ctx.restore();
  // 地面
  const gy=V.h*0.66;
  const gg=ctx.createLinearGradient(0,gy,0,V.h);
  gg.addColorStop(0, battle.isBoss?'#241338':'#1c3a2a');
  gg.addColorStop(1, battle.isBoss?'#0d0820':'#0c1a12');
  ctx.fillStyle=gg;ctx.beginPath();ctx.moveTo(0,gy);ctx.quadraticCurveTo(V.w/2,gy-20,V.w,gy);ctx.lineTo(V.w,V.h);ctx.lineTo(0,V.h);ctx.closePath();ctx.fill();

  const E=enemyBattlePos(), H=heroBattlePos();
  // 敵
  ctx.save();
  ctx.globalAlpha=battle.enemy.alpha;
  ctx.translate(E.x+battle.enemy.ox, E.y+battle.enemy.oy+Math.sin(battle.enemy.bob*2)*6);
  const es=battle.enemy.scale*(battle.isBoss?V.tile*3.4:V.tile*2.2);
  ctx.scale(battle.enemy.scale,battle.enemy.scale);
  ctx.translate(-E.x,-E.y);
  const d=battle.data.draw;
  if(d==='slime')drawSlime(ctx,E.x,E.y,es,now,battle.enemy.flash);
  else if(d==='bat')drawBat(ctx,E.x,E.y,es,now,battle.enemy.flash);
  else if(d==='wolf')drawWolf(ctx,E.x,E.y,es,now,battle.enemy.flash);
  else if(d==='golem')drawGolem(ctx,E.x,E.y,es,now,battle.enemy.flash);
  else drawBoss(ctx,E.x,E.y,es,now,battle.enemy.flash);
  ctx.restore();

  // 敵HPバー
  if(battle.enemy.alpha>0.9){
    const bw=Math.min(V.w*0.5,260), bx=E.x-bw/2, by=E.y-es*0.75;
    ctx.font='800 13px sans-serif';ctx.textAlign='left';
    ctx.fillStyle='#fff';ctx.fillText(battle.data.name,bx,by-6);
    ctx.fillStyle='rgba(0,0,0,.5)';ctx.fillRect(bx,by,bw,8);
    const r=battle.ehp/battle.emaxhp;
    const hg=ctx.createLinearGradient(bx,0,bx+bw,0);hg.addColorStop(0,'#ff5d6c');hg.addColorStop(1,'#ff9a3c');
    ctx.fillStyle=hg;ctx.fillRect(bx,by,bw*r,8);
    ctx.strokeStyle='rgba(255,255,255,.3)';ctx.lineWidth=1;ctx.strokeRect(bx,by,bw,8);
  }

  // 勇者（背後）
  ctx.save();ctx.translate(battle.hero.ox,battle.hero.oy);
  if(battle.hero.flash>0 && Math.floor(now*20)%2===0) ctx.globalAlpha=0.6;
  drawHeroBack(ctx,H.x,H.y,V.tile*2.0,battle.hero.flash,0);
  ctx.restore();

  // パーティクル
  drawFx(ctx);
  // ダメージ数字
  for(const f of floaters){
    ctx.globalAlpha=clamp(f.life,0,1);
    const sz=Math.round(V.tile*0.5*f.scale*(f.crit?1.15:1));
    ctx.font=`900 ${sz}px sans-serif`;ctx.textAlign='center';
    ctx.lineWidth=5;ctx.strokeStyle='rgba(0,0,0,.7)';ctx.strokeText(f.text,f.x,f.y);
    ctx.fillStyle=f.col;ctx.fillText(f.text,f.x,f.y);
  }
  ctx.globalAlpha=1;ctx.textAlign='left';
  ctx.restore();

  // 被弾赤フラッシュ
  if(redFlash>0){ctx.fillStyle=`rgba(200,20,40,${redFlash*0.4})`;ctx.fillRect(0,0,V.w,V.h);}
  if(whiteFlash>0){ctx.fillStyle=`rgba(255,255,255,${whiteFlash})`;ctx.fillRect(0,0,V.w,V.h);}
}

function drawFx(g){
  g.save();g.globalCompositeOperation='lighter';
  for(const p of fx){
    if(p.type==='spark'){g.fillStyle=`rgba(220,235,255,${p.life})`;g.beginPath();g.arc(p.x,p.y,p.r*p.life,0,6.28);g.fill();}
    else if(p.type==='fire'){const c=mix('#fff2b0','#e0361a',1-p.life);g.fillStyle=c;g.globalAlpha=p.life;g.beginPath();g.arc(p.x,p.y,p.r*p.life,0,6.28);g.fill();g.globalAlpha=1;}
    else if(p.type==='heal'||p.type==='gather'){g.fillStyle=p.col;g.globalAlpha=p.life;g.beginPath();g.arc(p.x,p.y,p.r,0,6.28);g.fill();g.globalAlpha=1;}
    else if(p.type==='ring'){g.strokeStyle=p.col;g.globalAlpha=p.life;g.lineWidth=3;g.beginPath();g.arc(p.x,p.y,(1-p.life)*V.tile*1.4+10,0,6.28);g.stroke();g.globalAlpha=1;}
    else if(p.type==='slash'){g.strokeStyle=`rgba(255,255,255,${p.life})`;g.lineWidth=4*p.life;
      g.beginPath();g.arc(p.x,p.y,p.r,p.ang-0.6,p.ang+0.6);g.stroke();
      g.strokeStyle=`rgba(150,200,255,${p.life*0.6})`;g.lineWidth=8*p.life;g.beginPath();g.arc(p.x,p.y,p.r,p.ang-0.5,p.ang+0.5);g.stroke();}
  }
  g.restore();
}

/* =====================================================================
   タイトル画面アニメ
   ===================================================================== */
function renderTitle(now){
  const g=titleCtx, w=titleCv.clientWidth||titleCv.width, h=titleCv.clientHeight||titleCv.height;
  const W=parseFloat(getComputedStyle(titleCv).width), Hh=parseFloat(getComputedStyle(titleCv).height);
  g.clearRect(0,0,W,Hh);
  // 空
  const sky=g.createLinearGradient(0,0,0,Hh);sky.addColorStop(0,'#160e33');sky.addColorStop(0.6,'#241452');sky.addColorStop(1,'#3a2270');
  g.fillStyle=sky;g.fillRect(0,0,W,Hh);
  // 月
  g.save();g.shadowColor='#fff';g.shadowBlur=30;g.fillStyle='#fce9b8';g.beginPath();g.arc(W*0.76,Hh*0.26,W*0.09,0,6.28);g.fill();g.restore();
  // 星
  g.globalCompositeOperation='lighter';
  for(let i=0;i<50;i++){const hx=hash(i,11),hy=hash(i,29);const a=0.3+0.5*Math.sin(now*2+i);
    g.fillStyle=`rgba(255,255,255,${a})`;g.fillRect(hx*W,hy*Hh*0.7,1.6,1.6);}
  g.globalCompositeOperation='source-over';
  // 遠景の木々
  g.fillStyle='#160d2e';
  for(let i=0;i<10;i++){const bx=i/9*W;g.beginPath();g.moveTo(bx-30,Hh);g.lineTo(bx,Hh*0.62);g.lineTo(bx+30,Hh);g.closePath();g.fill();}
  // 地面
  g.fillStyle='#0f0a22';g.fillRect(0,Hh*0.86,W,Hh*0.2);
  // 塔（中央）
  const cx=W*0.5, baseY=Hh*0.9, topY=Hh*0.2;
  const tg=g.createLinearGradient(cx-40,0,cx+40,0);tg.addColorStop(0,'#3a4570');tg.addColorStop(.5,'#5765a0');tg.addColorStop(1,'#2c3358');
  g.fillStyle=tg;g.beginPath();g.moveTo(cx-38,baseY);g.lineTo(cx-26,topY+40);g.lineTo(cx+26,topY+40);g.lineTo(cx+38,baseY);g.closePath();g.fill();
  g.fillStyle='#6b4bb0';g.beginPath();g.moveTo(cx-38,topY+45);g.lineTo(cx,topY-25);g.lineTo(cx+38,topY+45);g.closePath();g.fill();
  g.fillStyle='rgba(255,220,120,.8)';for(let i=0;i<4;i++)g.fillRect(cx-7,baseY-40-i*60,14,26);
  // クリスタル
  const gl=0.6+0.4*Math.sin(now*2);
  g.save();g.shadowColor='#c9a4ff';g.shadowBlur=40*gl;g.fillStyle=`rgba(210,160,255,.95)`;
  g.beginPath();g.moveTo(cx,topY-55);g.lineTo(cx-18,topY-8);g.lineTo(cx,topY+18);g.lineTo(cx+18,topY-8);g.closePath();g.fill();
  g.fillStyle=`rgba(255,255,255,${0.7*gl})`;g.beginPath();g.moveTo(cx,topY-48);g.lineTo(cx-7,topY-10);g.lineTo(cx+7,topY-10);g.closePath();g.fill();g.restore();
  // 光の粒
  g.globalCompositeOperation='lighter';
  for(let i=0;i<18;i++){const p=(now*0.3+i/18)%1;const px=cx+Math.sin(i*2+now)*40;const py=lerp(topY,baseY,p);
    g.fillStyle=`rgba(200,160,255,${(1-p)*0.6})`;g.beginPath();g.arc(px,py,2.2,0,6.28);g.fill();}
  g.globalCompositeOperation='source-over';
}

/* =====================================================================
   ループ
   ===================================================================== */
let last=performance.now();
function loop(t){
  const dt=Math.min(0.05,(t-last)/1000); last=t;
  updateTweens(dt);
  if(state==='title'){ renderTitle(t/1000); }
  else if(state==='field'){ updateField(dt); renderField(); }
  else if(state==='battle'){ updateFx(dt); renderBattle(); }
  else if(state==='event'){ // 背景は最後のフィールド/バトルを維持
    if(battle){ updateFx(dt); renderBattle(); } else { renderField(); }
  }
  requestAnimationFrame(loop);
}

/* =====================================================================
   イベントオーバーレイ
   ===================================================================== */
let eventCb=null;
function showEvent(kind,title,body,btn,cb){
  state='event';
  el('event-title').className=kind;
  el('event-title').textContent=title;
  el('event-body').innerHTML=body;
  el('event-btn').textContent=btn;
  eventScreen.classList.remove('hidden');
  eventCb=cb;
}
el('event-btn').addEventListener('click',()=>{ const c=eventCb; eventCb=null; if(c)c(); });

function showEnding(justWon){
  const body = `<div>影の王を倒し、勇者アルトは<br>クリスタルの光を取り戻した。</div>
    <div style="margin-top:14px">到達レベル <b class="g">Lv.${player.lv}</b><br>集めた財宝 <b class="g">${player.gold} ゴールド</b></div>
    <div style="margin-top:14px">森に 朝の光が さしこむ —</div>`;
  showEvent('win','クリア！',body,'もう一度 冒険する',()=>{ location.reload(); });
}

/* =====================================================================
   起動
   ===================================================================== */
function startGame(){
  titleScreen.classList.add('hidden');
  fieldHud.classList.remove('hidden');
  pad.classList.remove('hidden');
  player.gx=MAP.start.x; player.gy=MAP.start.y; player.fx=player.gx; player.fy=player.gy;
  player.facing='up';
  updateHUD();
  state='field';
  updateCamera();
}
el('start-btn').addEventListener('click',startGame);

function init(){
  resize();
  buildMap();
  spawnEnemies();
  updateHUD();
  requestAnimationFrame(loop);
}
init();
