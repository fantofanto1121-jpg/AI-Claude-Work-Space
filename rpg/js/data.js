/* =====================================================================
 * 星継ぎのエテルナ  ―  Hoshitsugi no Eterna
 * data.js  :  ゲーム全体の静的データ（契約の中核）
 *
 * すべてのモジュールはグローバル名前空間 `Game` にぶら下がる。
 * data.js が最初に読み込まれ、`Game` を初期化する。
 * ===================================================================== */

window.Game = window.Game || {};

Game.Data = (function () {
  'use strict';

  /* --- 基本定数 ------------------------------------------------------ */
  const TILE = 16;            // 1タイルの論理ピクセル
  const VIEW_TILES_X = 15;    // 画面に見えるタイル数（横）
  const VIEW_TILES_Y = 21;    // 画面に見えるタイル数（縦, portrait）

  /* --- スキル -------------------------------------------------------- */
  // type: phys(物理) / magic(魔法) / heal / buff / revive
  // target: enemy / all-enemy / ally / all-ally / self
  const SKILLS = {
    slash2: { id: 'slash2', name: '二段斬り', cost: 3, type: 'phys', power: 1.7,
      target: 'enemy', element: 'none', anim: 'slash',
      desc: '素早く二度斬りつける。' },
    guardAll: { id: 'guardAll', name: '守りの号令', cost: 4, type: 'buff', power: 0,
      target: 'all-ally', element: 'none', anim: 'buff', buff: { def: 0.4, turns: 3 },
      desc: '味方全体の守備を高める。' },
    braveEdge: { id: 'braveEdge', name: '星閃斬', cost: 8, type: 'phys', power: 2.6,
      target: 'enemy', element: 'light', anim: 'starslash',
      desc: '星の光をまとった渾身の一撃。' },

    fire: { id: 'fire', name: 'ファイア', cost: 4, type: 'magic', power: 1.6,
      target: 'enemy', element: 'fire', anim: 'fire',
      desc: '敵一体を炎で焼く。' },
    firaga: { id: 'firaga', name: 'フレア', cost: 12, type: 'magic', power: 2.2,
      target: 'all-enemy', element: 'fire', anim: 'fireAll',
      desc: '敵全体を業火で包む。' },
    thunder: { id: 'thunder', name: 'サンダー', cost: 6, type: 'magic', power: 2.0,
      target: 'enemy', element: 'thunder', anim: 'thunder',
      desc: '敵一体に雷を落とす。' },
    heal: { id: 'heal', name: 'ヒール', cost: 4, type: 'heal', power: 40,
      target: 'ally', element: 'light', anim: 'heal',
      desc: '味方一体のHPを回復する。' },
    healAll: { id: 'healAll', name: 'ハイヒール', cost: 10, type: 'heal', power: 55,
      target: 'all-ally', element: 'light', anim: 'healAll',
      desc: '味方全体のHPを回復する。' },
    revive: { id: 'revive', name: 'リレイズ', cost: 14, type: 'revive', power: 0.5,
      target: 'ally', element: 'light', anim: 'heal',
      desc: '倒れた味方を復活させる。' },

    shieldBash: { id: 'shieldBash', name: 'シールドバッシュ', cost: 3, type: 'phys', power: 1.4,
      target: 'enemy', element: 'none', anim: 'bash',
      desc: '盾で殴りつけ、稀にひるませる。', stun: 0.3 },
    taunt: { id: 'taunt', name: '挑発', cost: 2, type: 'buff', power: 0,
      target: 'self', element: 'none', anim: 'buff', taunt: 3,
      desc: '敵の攻撃を自分に引きつける。' },
    protect: { id: 'protect', name: 'プロテクト', cost: 6, type: 'buff', power: 0,
      target: 'ally', element: 'none', anim: 'buff', buff: { def: 0.6, turns: 3 },
      desc: '味方一体の守備を大きく高める。' },
    quake: { id: 'quake', name: 'アースクエイク', cost: 10, type: 'phys', power: 1.8,
      target: 'all-enemy', element: 'earth', anim: 'quake',
      desc: '大地を揺らし敵全体を攻撃する。' },

    // 敵専用
    e_bite: { id: 'e_bite', name: 'かみつく', cost: 0, type: 'phys', power: 1.3,
      target: 'enemy', element: 'none', anim: 'bite', desc: '' },
    e_darkball: { id: 'e_darkball', name: '闇弾', cost: 0, type: 'magic', power: 1.5,
      target: 'enemy', element: 'dark', anim: 'dark', desc: '' },
    e_shriek: { id: 'e_shriek', name: '威圧の咆哮', cost: 0, type: 'buff', power: 0,
      target: 'self', element: 'none', anim: 'buff', selfBuff: { atk: 0.4, turns: 3 }, desc: '' },
    e_drain: { id: 'e_drain', name: 'ドレイン', cost: 0, type: 'magic', power: 1.4,
      target: 'enemy', element: 'dark', anim: 'dark', drain: true, desc: '' },
    e_starfall: { id: 'e_starfall', name: '星喰いの奔流', cost: 0, type: 'magic', power: 1.6,
      target: 'all-enemy', element: 'dark', anim: 'darkAll', desc: '' },
    e_devour: { id: 'e_devour', name: '喰らう闇', cost: 0, type: 'magic', power: 2.2,
      target: 'enemy', element: 'dark', anim: 'dark', drain: true, desc: '' }
  };

  /* --- アイテム ------------------------------------------------------ */
  const ITEMS = {
    herb: { id: 'herb', name: 'やくそう', type: 'heal', power: 50, target: 'ally',
      price: 20, desc: 'HPを50回復する。' },
    hiherb: { id: 'hiherb', name: '上やくそう', type: 'heal', power: 150, target: 'ally',
      price: 80, desc: 'HPを150回復する。' },
    ether: { id: 'ether', name: 'マナの雫', type: 'mpheal', power: 30, target: 'ally',
      price: 60, desc: 'MPを30回復する。' },
    phoenix: { id: 'phoenix', name: '再生の羽', type: 'revive', power: 0.5, target: 'ally',
      price: 120, desc: '倒れた仲間をHP半分で復活。' },
    bomb: { id: 'bomb', name: '火炎弾', type: 'offense', power: 80, target: 'enemy',
      element: 'fire', price: 40, desc: '敵一体に炎ダメージ80。' },
    // キーアイテム
    lantern: { id: 'lantern', name: '星灯りのランタン', type: 'key', power: 0,
      price: 0, desc: '古の遺跡の闇を照らす灯り。' },
    starKey: { id: 'starKey', name: '星導の鍵', type: 'key', power: 0,
      price: 0, desc: '星の尖塔の最奥へ続く扉の鍵。' }
  };

  /* --- 敵 ------------------------------------------------------------ */
  const ENEMIES = {
    slime: { id: 'slime', name: 'かげスライム', hp: 32, mp: 0, atk: 12, def: 6, mag: 4,
      spd: 6, exp: 6, gold: 8, sprite: 'slime', skills: [], drops: [{ item: 'herb', rate: 0.2 }] },
    bat: { id: 'bat', name: 'よいのコウモリ', hp: 24, mp: 4, atk: 14, def: 4, mag: 6,
      spd: 14, exp: 7, gold: 10, sprite: 'bat', skills: ['e_bite'], drops: [] },
    wolf: { id: 'wolf', name: 'かげオオカミ', hp: 48, mp: 0, atk: 20, def: 8, mag: 4,
      spd: 12, exp: 12, gold: 15, sprite: 'wolf', skills: ['e_bite', 'e_shriek'],
      drops: [{ item: 'herb', rate: 0.25 }] },
    wisp: { id: 'wisp', name: 'まどわし火', hp: 40, mp: 20, atk: 10, def: 6, mag: 18,
      spd: 15, exp: 14, gold: 18, sprite: 'wisp', skills: ['e_darkball'],
      drops: [{ item: 'ether', rate: 0.2 }] },
    golem: { id: 'golem', name: '遺跡のゴーレム', hp: 120, mp: 0, atk: 24, def: 20, mag: 2,
      spd: 4, exp: 30, gold: 40, sprite: 'golem', skills: ['e_bite'],
      drops: [{ item: 'hiherb', rate: 0.3 }] },
    shade: { id: 'shade', name: '影の使い', hp: 70, mp: 30, atk: 22, def: 12, mag: 20,
      spd: 16, exp: 22, gold: 28, sprite: 'shade', skills: ['e_darkball', 'e_drain'],
      drops: [{ item: 'ether', rate: 0.3 }] },
    revenant: { id: 'revenant', name: 'なげきの亡霊', hp: 90, mp: 24, atk: 26, def: 14, mag: 22,
      spd: 13, exp: 28, gold: 34, sprite: 'shade', skills: ['e_darkball', 'e_shriek'],
      drops: [{ item: 'hiherb', rate: 0.25 }] },

    // ボス
    warden: { id: 'warden', name: '遺跡の守番', hp: 320, mp: 40, atk: 30, def: 22, mag: 14,
      spd: 8, exp: 120, gold: 200, sprite: 'warden', boss: true,
      skills: ['e_bite', 'e_shriek'], drops: [] },
    nox: { id: 'nox', name: '星喰い ノクス', hp: 900, mp: 200, atk: 40, def: 26, mag: 34,
      spd: 18, exp: 0, gold: 0, sprite: 'nox', boss: true,
      skills: ['e_darkball', 'e_starfall', 'e_devour', 'e_drain'], drops: [] }
  };

  /* --- パーティキャラの基礎データと成長 ------------------------------ */
  // baseStats はレベル1の値。growth はレベルアップ毎の増分。
  // learn: { level: skillId } で習得。
  const HEROES = {
    lio: {
      id: 'lio', name: 'リオ', sprite: 'lio', battler: 'lio_b',
      base: { maxhp: 60, maxmp: 12, atk: 16, def: 10, mag: 6, spd: 12 },
      growth: { maxhp: 9, maxmp: 2, atk: 3.2, def: 2, mag: 1.2, spd: 1.4 },
      learn: { 1: 'slash2', 5: 'guardAll', 10: 'braveEdge' }
    },
    sena: {
      id: 'sena', name: 'セナ', sprite: 'sena', battler: 'sena_b',
      base: { maxhp: 42, maxmp: 30, atk: 9, def: 7, mag: 16, spd: 11 },
      growth: { maxhp: 6, maxmp: 5, atk: 1.4, def: 1.4, mag: 3.4, spd: 1.3 },
      learn: { 1: 'fire', 1: 'heal', 4: 'thunder', 7: 'healAll', 9: 'firaga', 12: 'revive' }
    },
    gord: {
      id: 'gord', name: 'ガード', sprite: 'gord', battler: 'gord_b',
      base: { maxhp: 84, maxmp: 10, atk: 15, def: 16, mag: 3, spd: 7 },
      growth: { maxhp: 12, maxmp: 1.5, atk: 2.6, def: 3, mag: 0.6, spd: 0.9 },
      learn: { 1: 'shieldBash', 1: 'taunt', 6: 'protect', 11: 'quake' }
    }
  };
  // 注: オブジェクトキー重複で learn の一部が上書きされるため、初期スキルは
  // getStartingSkills() で補完する。
  const STARTING_SKILLS = {
    lio: ['slash2'],
    sena: ['fire', 'heal'],
    gord: ['shieldBash', 'taunt']
  };
  const LEARN_TABLE = {
    lio: [{ lv: 5, skill: 'guardAll' }, { lv: 10, skill: 'braveEdge' }],
    sena: [{ lv: 4, skill: 'thunder' }, { lv: 7, skill: 'healAll' },
           { lv: 9, skill: 'firaga' }, { lv: 12, skill: 'revive' }],
    gord: [{ lv: 6, skill: 'protect' }, { lv: 11, skill: 'quake' }]
  };

  /* --- 経験値テーブル ------------------------------------------------ */
  // 次のレベルに必要な累計経験値
  function expForLevel(lv) {
    // そのレベルに到達するのに必要な累計経験値（Lv1 = 0）
    if (lv <= 1) return 0;
    return Math.floor(15 * Math.pow(lv - 1, 1.95));
  }

  /* --- ショップ品揃え ------------------------------------------------ */
  const SHOPS = {
    village: ['herb', 'ether', 'phoenix', 'bomb'],
    ruins: ['herb', 'hiherb', 'ether', 'phoenix', 'bomb']
  };

  /* --- マップ --------------------------------------------------------
   * legend 文字:
   *  '.' 草地        ',' 花草        'T' 木(壁)      'W' 水(壁)
   *  '#' 岩/壁       'P' 土の道      'H' 家の壁(壁)  'D' 扉(exit)
   *  'B' 橋          'F' 床(室内)    'S' 階段/出口   'r' 遺跡床
   *  'x' 尖塔床      'A' 祭壇        '~' 深淵(壁)    '=' 柵(壁)
   *  '%' 茂み(壁)    '*' 星石(壁)    'o' 円柱(壁)    '+' 花壇(壁)
   * ------------------------------------------------------------------ */
  const SOLID = new Set(['T', 'W', '#', 'H', '~', '=', '%', '*', 'o', '+']);

  const MAPS = {
    village: {
      id: 'village', name: '星守村',
      bgm: 'town',
      spawn: { x: 9, y: 15 },
      rows: [
        'TTTTTTTTTTTTTTTTTT',
        'T................T',
        'T..HHHH....HHHH..T',
        'T..HDHH....HDHH..T',
        'T..HHHH....HHHH..T',
        'T.......PP.......T',
        'T.,.....PP.....,.T',
        'T.......PP.......T',
        'T..HHHH.PP.......T',
        'T..HDHH.PP..++...T',
        'T..HHHH.PP..++...T',
        'T.......PP.......T',
        'T.WWW...PP.......T',
        'T.WWW...PP....,..T',
        'T.WWW...PP.......T',
        'T.......PP.......T',
        'T.,.....PP.....,.T',
        'T.......PP.......T',
        'TTTTTTTTSSTTTTTTTT',
        'TTTTTTTTTTTTTTTTTT'
      ],
      exits: [
        { x: 8, y: 18, to: 'forest', tx: 8, ty: 1 },
        { x: 9, y: 18, to: 'forest', tx: 9, ty: 1 }
      ],
      npcs: [
        { x: 5, y: 5, sprite: 'elder', dir: 'down', name: '長老', story: 'elder' },
        { x: 14, y: 9, sprite: 'villager1', dir: 'left', name: '村人', story: 'villager_shop', shop: 'village' },
        { x: 6, y: 11, sprite: 'sena', dir: 'down', name: 'セナ', story: 'sena_intro', joinable: 'sena' },
        { x: 13, y: 6, sprite: 'villager2', dir: 'down', name: '子ども', story: 'child' },
        { x: 5, y: 15, sprite: 'villager1', dir: 'left', name: '漁師', story: 'fisher' }
      ],
      events: []
    },

    forest: {
      id: 'forest', name: '囁きの森',
      bgm: 'field',
      spawn: { x: 9, y: 1 },
      encounter: { rate: 0.11, table: [
        { enemy: 'slime', weight: 3 }, { enemy: 'bat', weight: 3 },
        { enemy: 'wolf', weight: 2 }, { enemy: 'wisp', weight: 1 } ],
        maxGroup: 3 },
      rows: [
        'TTTTTTTTSSTTTTTTTT',
        'TT.....PPPP.....TT',
        'T......PPPP......T',
        'T..%...PPPP...%..T',
        'T......PPPP......T',
        'T...%..PPPP..%...T',
        'T......PPPP......T',
        'T..%...PPPP...%..T',
        'T......PPPP......T',
        'T....%.PPPP.%....T',
        'T......PPPP......T',
        'T..%...PPPP...%..T',
        'T......PPPP......T',
        'T...%..PPPP..%...T',
        'T......PPPP......T',
        'T..%...PPPP...%..T',
        'T......PPPP......T',
        'T......PPPP......T',
        'TT.....PPPP.....TT',
        'TTTTTTTTSSTTTTTTTT'
      ],
      exits: [
        { x: 8, y: 0, to: 'village', tx: 8, ty: 17 },
        { x: 9, y: 0, to: 'village', tx: 9, ty: 17 },
        { x: 8, y: 19, to: 'ruins', tx: 8, ty: 1 },
        { x: 9, y: 19, to: 'ruins', tx: 9, ty: 1 }
      ],
      npcs: [
        { x: 11, y: 6, sprite: 'villager2', dir: 'left', name: '旅人', story: 'traveler' }
      ],
      events: [
        { x: 9, y: 5, id: 'forest_omen', once: true, story: 'forest_omen' }
      ]
    },

    ruins: {
      id: 'ruins', name: '古の遺跡',
      bgm: 'dungeon',
      spawn: { x: 9, y: 1 },
      dark: true,
      encounter: { rate: 0.12, table: [
        { enemy: 'wisp', weight: 2 }, { enemy: 'shade', weight: 3 },
        { enemy: 'golem', weight: 1 }, { enemy: 'revenant', weight: 2 } ],
        maxGroup: 3 },
      rows: [
        '########SS########',
        '#rrrrrrrrrrrrrrrr#',
        '#rrrrrrrrrrrrrrrr#',
        '#rroorrrrrrrroorr#',
        '#rrrrrrrrrrrrrrrr#',
        '#rCrrrrrrrrrrrrCr#',
        '#rrrrrrrrrrrrrrrr#',
        '#rrrr######rrrrrr#',
        '#rrrr#rrrr#rrrrrr#',
        '#rrrr#rrrr#rrrrrr#',
        '#rrrr######rrrrrr#',
        '#rrrrrrrrrrrrrrrr#',
        '#rroorrrrrrrroorr#',
        '#rrrrrrrrrrrrrrrr#',
        '#rrrrrrrrrrrrrrrr#',
        '#rrrrrrrrrrrrrrrr#',
        '#rrrrrrrAArrrrrrr#',
        '#rrrrrrrrrrrrrrrr#',
        '########SS########',
        '##################'
      ],
      exits: [
        { x: 8, y: 0, to: 'forest', tx: 8, ty: 18 },
        { x: 9, y: 0, to: 'forest', tx: 9, ty: 18 },
        { x: 8, y: 18, to: 'spire', tx: 8, ty: 1, need: 'starKey' },
        { x: 9, y: 18, to: 'spire', tx: 9, ty: 1, need: 'starKey' }
      ],
      npcs: [
        { x: 3, y: 8, sprite: 'gord', dir: 'right', name: 'ガード', story: 'gord_intro', joinable: 'gord' }
      ],
      events: [
        { x: 2, y: 5, id: 'chest_ruins1', once: true, type: 'chest', item: 'hiherb', tile: 'C' },
        { x: 15, y: 5, id: 'chest_ruins2', once: true, type: 'chest', item: 'ether', tile: 'C' },
        { x: 9, y: 16, id: 'ruins_altar', once: true, story: 'ruins_altar', type: 'boss',
          enemy: 'warden', reward: 'starKey' }
      ]
    },

    spire: {
      id: 'spire', name: '星の尖塔',
      bgm: 'dungeon',
      spawn: { x: 9, y: 1 },
      dark: true,
      encounter: { rate: 0.13, table: [
        { enemy: 'shade', weight: 3 }, { enemy: 'revenant', weight: 3 },
        { enemy: 'wisp', weight: 2 }, { enemy: 'golem', weight: 1 } ],
        maxGroup: 3 },
      rows: [
        '~~~~~~~~SS~~~~~~~~',
        '~xxxxxxxxxxxxxxxx~',
        '~xx*xxxxxxxxxx*xx~',
        '~xxxxxxxxxxxxxxxx~',
        '~xxxxx*xxxx*xxxxx~',
        '~xxxxxxxxxxxxxxxx~',
        '~xx*xxxxxxxxxx*xx~',
        '~xxxxxxxxxxxxxxxx~',
        '~xxxxx*xxxx*xxxxx~',
        '~xxxxxxxxxxxxxxxx~',
        '~xx*xxxxxxxxxx*xx~',
        '~xxxxxxxxxxxxxxxx~',
        '~xxxxx*xxxx*xxxxx~',
        '~xxxxxxxxxxxxxxxx~',
        '~xx*xxxxxxxxxx*xx~',
        '~xxxxxxxxxxxxxxxx~',
        '~xxxxxxxxxxxxxxxx~',
        '~xxxxxxxAAxxxxxxx~',
        '~xxxxxxxxxxxxxxxx~',
        '~~~~~~~~~~~~~~~~~~'
      ],
      exits: [
        { x: 8, y: 0, to: 'ruins', tx: 8, ty: 17 },
        { x: 9, y: 0, to: 'ruins', tx: 9, ty: 17 }
      ],
      npcs: [],
      events: [
        { x: 9, y: 17, id: 'spire_boss', once: true, story: 'spire_boss', type: 'boss',
          enemy: 'nox', ending: true }
      ]
    }
  };

  /* --- 公開API ------------------------------------------------------- */
  function getStartingSkills(heroId) {
    return (STARTING_SKILLS[heroId] || []).slice();
  }
  function learnedAt(heroId, level) {
    // level ちょうどで覚えるスキルの配列
    const out = [];
    (LEARN_TABLE[heroId] || []).forEach((e) => { if (e.lv === level) out.push(e.skill); });
    return out;
  }
  function allLearnedUpTo(heroId, level) {
    const out = getStartingSkills(heroId);
    (LEARN_TABLE[heroId] || []).forEach((e) => { if (e.lv <= level) out.push(e.skill); });
    return out;
  }

  return {
    TILE, VIEW_TILES_X, VIEW_TILES_Y, SOLID,
    SKILLS, ITEMS, ENEMIES, HEROES, SHOPS, MAPS,
    STARTING_SKILLS, LEARN_TABLE,
    expForLevel, getStartingSkills, learnedAt, allLearnedUpTo
  };
})();
