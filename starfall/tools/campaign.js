// Long-play campaign tester. Usage: node campaign.js <costumeJP> <capMs> <difficulty> <mode>
// mode: "dodge" (default, flee+survive) | "aggro" (seek boss/nearest to test boss combat).
// Unlocks all costumes, selects the named one, runs a bot + auto level-up picker,
// prints ONE JSON line of findings. Death detection is robust (checks #gameover-screen
// every iteration BEFORE any null short-circuit).
const { chromium } = require('/tmp/claude-0/scratchpad/node_modules/playwright-core');
const path=require('path'); const OUT=__dirname;
(async()=>{
  const costume=process.argv[2]||'ヴァンガード';
  const capMs=parseInt(process.argv[3]||'240000',10);
  const diff=process.argv[4]||'normal';
  const mode=process.argv[5]||'dodge';
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox','--disable-gpu','--use-gl=swiftshader']});
  const p=await b.newPage({viewport:{width:1280,height:800}});
  const errs=[];p.on('pageerror',e=>errs.push('P:'+e.message));p.on('console',m=>{if(m.type()==='error')errs.push('C:'+m.text());});
  await p.goto('file://'+path.resolve(OUT,'index.html'));
  await p.evaluate(()=>{ try{localStorage.setItem('starfall-arena-progress',JSON.stringify({kills:99999,bosses:99,maxLevel:99,bestScore:9999999,bestTime:{easy:9999,normal:9999,hard:9999,inferno:9999}}));}catch(e){} });
  await p.reload(); await p.waitForTimeout(300);
  await p.evaluate(()=>{ window.__fps={frames:0,last:performance.now(),val:0}; (function loop(){ const n=performance.now(); window.__fps.frames++; if(n-window.__fps.last>=1000){window.__fps.val=window.__fps.frames*1000/(n-window.__fps.last);window.__fps.frames=0;window.__fps.last=n;} requestAnimationFrame(loop);})(); });
  await p.click('#open-costume'); await p.waitForTimeout(200);
  const picked=await p.evaluate((c)=>{ const cs=[...document.querySelectorAll('#costume-list .cos-card')]; const t=cs.find(x=>x.textContent.includes(c)); if(t&&!t.className.includes('locked')){t.click();return true;} return false; }, costume);
  await p.click('#costume-confirm').catch(()=>{}); await p.waitForTimeout(150);
  await p.click(`.diff-btn[data-diff="${diff}"]`).catch(()=>{});
  await p.click('#start-btn');
  const priority=['命中','貫通','生命','再生','リジェネ','最大HP','ヴァイタ','体力','装甲','ブルワーク','移動','スピード','モメンタム','連射','ダメージ','クリティカル','マルチ','射程','シールド','回復','スウォーム','アドレナリン'];
  const held=new Set();
  async function setKeys(want){ for(const k of [...held]) if(!want.has(k)){await p.keyboard.up(k);held.delete(k);} for(const k of want) if(!held.has(k)){await p.keyboard.down(k);held.add(k);} }
  async function isGameover(){ return await p.$eval('#gameover-screen',s=>!s.classList.contains('hidden')).catch(()=>false); }
  async function lvl(){ const shown=await p.$eval('#levelup-screen',s=>!s.classList.contains('hidden')).catch(()=>false); if(!shown)return false;
    const names=await p.$$eval('#upgrade-cards .card .card-name',els=>els.map(e=>e.textContent)).catch(()=>[]);
    let best=0,bs=-1; names.forEach((t,i)=>{let s=0;priority.forEach((pp,pi)=>{if(t&&t.includes(pp))s=Math.max(s,priority.length-pi);});if(s>bs){bs=s;best=i;}});
    await p.keyboard.press(String(best+1)); return true; }
  const samples=[]; const start=Date.now(); let dead=false; let tick=0; let bossSeen=false;
  while(Date.now()-start<capMs){ tick++;
    if(await isGameover()){ dead=true; break; }              // robust death check FIRST
    if(await lvl()){ await p.waitForTimeout(50); continue; }
    const st=await p.evaluate((mode)=>{ const S=window.__SF; if(!S||!S.player)return null; const pl=S.player,es=S.enemies||[],W=S.WORLD;
      let fx=0,fy=0,near=1e9,boss=null; for(const e of es){if(e.dead)continue;const dx=pl.x-e.x,dy=pl.y-e.y,d=Math.hypot(dx,dy)||1;if(d<near)near=d;if(e.boss&&(!boss||d<boss.d))boss={x:e.x,y:e.y,d};if(d<440){const w=(e.boss?1.7:1)*(1/(d*d))*1e4;fx+=dx/d*w;fy+=dy/d*w;}}
      let ax,ay;
      if(mode==='aggro'&&boss){ // steer toward the boss but hold ~150px so autofire lands
        const tx=boss.x-pl.x,ty=boss.y-pl.y,td=Math.hypot(tx,ty)||1; const want=(boss.d>170?1:-0.3);
        ax=tx/td*want; ay=ty/td*want;
      } else { fx+=(W.w/2-pl.x)/W.w*1.2; fy+=(W.h/2-pl.y)/W.h*1.2; const m=Math.hypot(fx,fy)||1; ax=fx/m; ay=fy/m; }
      return {dx:ax,dy:ay,near,hasBoss:!!boss,t:S.game.time,kills:S.game.kills,boss:S.game.bossKills,lvl:pl.level,score:pl.score,hp:pl.hp,maxHp:pl.maxHp,ne:es.filter(e=>!e.dead).length,fps:Math.round(window.__fps.val)}; }, mode);
    if(!st){ if(await isGameover()){dead=true;break;} await p.waitForTimeout(70); continue; }
    if(st.hasBoss)bossSeen=true;
    const want=new Set(); const th=0.35;
    if(st.dx>th)want.add('ArrowRight');else if(st.dx<-th)want.add('ArrowLeft');
    if(st.dy>th)want.add('ArrowDown');else if(st.dy<-th)want.add('ArrowUp');
    if(want.size===0)want.add('ArrowUp'); await setKeys(want);
    if(tick%3===0)samples.push(st);
    await p.waitForTimeout(70);
    if(await isGameover()){dead=true;break;}
  }
  await setKeys(new Set());
  const last=samples[samples.length-1]||{}; const fpsArr=samples.map(s=>s.fps).filter(x=>x>0); const neArr=samples.map(s=>s.ne);
  const fpsAvg=fpsArr.length?Math.round(fpsArr.reduce((a,b)=>a+b,0)/fpsArr.length):0; const fpsMin=fpsArr.length?Math.min(...fpsArr):0;
  console.log(JSON.stringify({costume,picked,diff,mode,died:dead,survivedSec:Math.round(last.t||0),level:last.lvl||0,kills:last.kills||0,bossKills:last.boss||0,bossSeen,score:last.score||0,fpsAvg,fpsMin,maxEnemies:neArr.length?Math.max(...neArr):0,errors:errs.slice(0,4)}));
  await b.close();
})().catch(e=>{console.error(JSON.stringify({fatal:String(e)}));process.exit(1)});
