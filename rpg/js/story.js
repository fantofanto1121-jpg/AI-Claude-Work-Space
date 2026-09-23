/* =====================================================================
 * story.js  :  物語・会話スクリプト・クエスト進行
 *
 * 会話は「ステップ配列」で表現する。
 *   テキスト:  { name: '話者' | null, text: '本文', face: 'lio'|... }
 *   アクション: { do: 'join'|'shop'|'give'|'flag'|'boss'|'heal'|'ending'|'warp'|'setDialogue', ... }
 *
 * Game.Story.getScript(key, state) が state(フラグ)に応じたステップ配列を返す。
 * ===================================================================== */

window.Game = window.Game || {};

Game.Story = (function () {
  'use strict';

  // 進行フラグの参照ヘルパ
  function has(state, flag) { return !!(state.flags && state.flags[flag]); }
  function party(state, id) { return state.party && state.party.some((m) => m.id === id); }

  // key -> function(state) -> steps[]
  const SCRIPTS = {

    /* ---------------- 星守村 ---------------- */
    elder: function (state) {
      if (!has(state, 'quest_started')) {
        return [
          { name: '長老', face: 'elder', text: 'おお、リオ。よく来てくれた。……見たか、空を。' },
          { name: '長老', face: 'elder', text: '夜ごとに星が一つ、また一つと消えてゆく。世界の灯（ともしび）である〈天の星〉が、弱っておるのだ。' },
          { name: 'リオ', face: 'lio', text: '星が……? だから最近、森から影のような魔物が湧いて出るんですね。' },
          { name: '長老', face: 'elder', text: 'さよう。星の光が絶えれば、この世は永遠の闇に沈む。だが、まだ間に合う。' },
          { name: '長老', face: 'elder', text: '〈星の尖塔〉の頂に、星を継ぐ者だけが灯せる祭壇がある。リオ、お前こそ星守の血を継ぐ者。頼めるか。' },
          { name: 'リオ', face: 'lio', text: '……はい。ぼくがやります。この村を、みんなを、闇になんて渡さない。' },
          { name: '長老', face: 'elder', text: 'よくぞ言うた。まずは村はずれのセナに声をかけよ。あの娘の魔法が、きっとお前を助けよう。' },
          { do: 'flag', flag: 'quest_started' }
        ];
      }
      if (has(state, 'boss_nox')) {
        return [
          { name: '長老', face: 'elder', text: 'よくぞ星を継いでくれた、リオ。空を見よ……星々が、あんなにも輝いておる。' },
          { name: '長老', face: 'elder', text: 'お前は星守の誇りだ。ありがとう。' }
        ];
      }
      return [
        { name: '長老', face: 'elder', text: '星の尖塔は〈囁きの森〉を抜け、〈古の遺跡〉の先にある。気をつけて行くのだぞ。' },
        { name: '長老', face: 'elder', text: 'セナに声をかけたか? 村はずれの、水辺の家におる。' }
      ];
    },

    sena_intro: function (state) {
      if (party(state, 'sena')) {
        return [{ name: 'セナ', face: 'sena', text: '準備はいい? 星の尖塔まで、わたしがついてる。心配ないわ。' }];
      }
      return [
        { name: 'セナ', face: 'sena', text: 'リオ! 長老から聞いたわ。星を継ぎに行くんでしょう?' },
        { name: 'リオ', face: 'lio', text: 'セナ……危ないよ。魔物もいるし——' },
        { name: 'セナ', face: 'sena', text: 'だからでしょ。あなた一人じゃ心配で見てられない。わたしの魔法、役に立つわよ。' },
        { name: 'セナ', face: 'sena', text: 'それに——この村は、わたしの故郷でもあるの。守りたいのは同じ。連れて行って。' },
        { name: 'リオ', face: 'lio', text: '……ありがとう、セナ。心強いよ。' },
        { do: 'join', who: 'sena' },
        { name: null, text: 'セナが仲間に加わった!' }
      ];
    },

    villager_shop: function () {
      return [
        { name: '村人', face: null, text: 'いらっしゃい。旅の支度かい? 何が要る?' },
        { do: 'shop', shop: 'village' }
      ];
    },

    child: function () {
      return [
        { name: '子ども', face: null, text: 'ねえ、夜になると星が消えるの。こわいよ……。' },
        { name: '子ども', face: null, text: 'お兄ちゃんが星を戻してくれるの? ……ほんとに?' }
      ];
    },

    fisher: function () {
      return [
        { name: '漁師', face: null, text: '川の水も、なんだか濁っちまってな。影の魔物が水を汚してるって噂だ。' },
        { name: '漁師', face: null, text: 'やくそうは多めに持っていきな。森の奥はおっかねえぞ。' }
      ];
    },

    /* ---------------- 囁きの森 ---------------- */
    traveler: function () {
      return [
        { name: '旅人', face: null, text: '遺跡の奥に〈守番〉がいるらしい。生半可な力じゃ通れんぞ。' },
        { name: '旅人', face: null, text: '仲間を集め、レベルを上げてから挑むんだな。' }
      ];
    },

    forest_omen: function () {
      return [
        { name: null, text: '——森が、ざわめいている。' },
        { name: 'セナ', face: 'sena', text: 'リオ、空を見て。星がまた一つ……。急がなきゃ。' },
        { name: 'リオ', face: 'lio', text: 'ああ。遺跡はこの先だ。行こう。' }
      ];
    },

    /* ---------------- 古の遺跡 ---------------- */
    gord_intro: function (state) {
      if (party(state, 'gord')) {
        return [{ name: 'ガード', face: 'gord', text: 'この盾、遠慮なく使え。守るのがおれの役目だ。' }];
      }
      return [
        { name: 'ガード', face: 'gord', text: '……星守の子か。こんな遺跡の奥まで、よく来たな。' },
        { name: 'リオ', face: 'lio', text: 'あなたは……騎士様?' },
        { name: 'ガード', face: 'gord', text: 'かつては、な。今はただの流れ者だ。守るべき国も、もうない。' },
        { name: 'ガード', face: 'gord', text: 'だが——星が消えるのを、指をくわえて見ている気にはなれん。おれの盾、貸してやろう。' },
        { do: 'join', who: 'gord' },
        { name: null, text: 'ガードが仲間に加わった!' },
        { name: 'ガード', face: 'gord', text: 'この奥の祭壇に〈守番〉がいる。星導の鍵を守っているはずだ。覚悟はいいな。' }
      ];
    },

    ruins_altar: function (state) {
      if (has(state, 'boss_warden')) {
        return [{ name: null, text: '砕けた祭壇が静かに佇んでいる。' }];
      }
      return [
        { name: null, text: '祭壇に近づくと、床の紋様が赤く光り出した——!' },
        { name: 'ガード', face: 'gord', text: '来るぞ! 遺跡の守番だ。散開しろ!' },
        { do: 'boss', enemy: 'warden', flag: 'boss_warden', reward: 'starKey',
          afterKey: 'ruins_altar_after' }
      ];
    },
    ruins_altar_after: function () {
      return [
        { name: null, text: '守番は崩れ落ち、祭壇の奥から一本の鍵が現れた。' },
        { do: 'give', item: 'starKey' },
        { name: 'セナ', face: 'sena', text: '〈星導の鍵〉……これで尖塔の扉が開くのね。' },
        { name: 'リオ', face: 'lio', text: 'いよいよだ。星を、取り戻しに行こう。' }
      ];
    },

    /* ---------------- 星の尖塔 ---------------- */
    spire_boss: function (state) {
      if (has(state, 'boss_nox')) {
        return [{ name: null, text: '祭壇は今、あたたかな星の光に満ちている。' }];
      }
      return [
        { name: null, text: '尖塔の頂——砕けた星の祭壇の前に、闇そのものが渦を巻いていた。' },
        { name: '???', face: null, text: '……星を、継ぐだと? 星など、私が喰らい尽くす為にあるのだ。' },
        { name: 'リオ', face: 'lio', text: 'お前が……星を喰らう者、ノクス。' },
        { name: 'ノクス', face: null, text: '光は必ず消える。ならば早いか遅いかの違いよ。さあ——お前たちも、闇に還れ。' },
        { name: 'ガード', face: 'gord', text: '減らず口を。……皆、ここが正念場だ!' },
        { name: 'セナ', face: 'sena', text: 'リオ、わたしたちがついてる。星を継ぐのはあなたよ!' },
        { name: 'リオ', face: 'lio', text: '——行くぞ! 星の光を、この手に!' },
        { do: 'boss', enemy: 'nox', flag: 'boss_nox', afterKey: 'ending' }
      ];
    },

    ending: function () {
      return [
        { name: null, text: 'ノクスは断末魔とともに霧散し、闇が晴れてゆく——。' },
        { name: 'リオ', face: 'lio', text: '祭壇が……呼んでいる。' },
        { name: null, text: 'リオが祭壇に手をかざすと、胸の奥から温かな光があふれ出した。' },
        { name: null, text: 'その光は天へと昇り、消えかけた星々に、一つ、また一つと灯をともしてゆく。' },
        { name: 'セナ', face: 'sena', text: 'すごい……空いちめんの、星。' },
        { name: 'ガード', face: 'gord', text: 'よくやった、星守の子。……いや、リオ。お前は立派な星守だ。' },
        { name: 'リオ', face: 'lio', text: 'みんなのおかげだ。ぼく一人じゃ、ここまで来られなかった。' },
        { name: null, text: '星の光は世界のすみずみまで届き、長い夜は明けた。' },
        { name: null, text: '——こうして、消えかけた星は継がれた。' },
        { name: null, text: '　　　星継ぎのエテルナ　　　\n　　　　  〜 完 〜' },
        { do: 'ending' }
      ];
    }
  };

  function getScript(key, state) {
    const fn = SCRIPTS[key];
    if (!fn) return [{ name: null, text: '……。' }];
    try { return fn(state) || []; }
    catch (e) { console.error('story error', key, e); return [{ name: null, text: '……。' }]; }
  }

  return { getScript, has };
})();
