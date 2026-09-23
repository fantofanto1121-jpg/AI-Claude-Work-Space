/* =====================================================================
 * story.js  :  物語・会話スクリプト・クエスト進行
 *
 * 会話は「ステップ配列」で表現する。
 *   テキスト:  { name: '話者' | null, text: '本文', face: 'lio'|... }
 *   アクション: { do: 'join'|'shop'|'give'|'flag'|'boss'|'heal'|'ending'|'warp', ... }
 *
 * Game.Story.getScript(key, state) が state(フラグ)に応じたステップ配列を返す。
 *
 * ── 物語の縦糸（伏線）──
 *  ・リオの父もかつて星守として尖塔へ発ち、還らなかった（elder で提示→endingで回収）
 *  ・忍び寄る闇＝ノクスの仕業。ガードの故国もそれに呑まれた（gord_intro→spire_boss）
 *  ・遺跡は深い闇に閉ざされている（fisher/traveler/elderが灯りを示唆）
 *  ・濁った川（fisher）は星が戻ると澄む（endingで回収）
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
      // 初回：クエスト受諾（最後に quest_started を必ず立てる）
      if (!has(state, 'quest_started')) {
        return [
          { name: '長老', face: 'elder', text: 'おお、リオ。よく来てくれた。……そこに立つお前を見ると、亡き父御（ちちご）を思い出すよ。' },
          { name: 'リオ', face: 'lio', text: '父さんを……? ぼく、顔もよく覚えていないのに。' },
          { name: '長老', face: 'elder', text: 'お前の父も星守だった。十数年前、消えかけた星を継ぐため尖塔へ発ち——そして、還らなんだ。' },
          { name: 'リオ', face: 'lio', text: '……! 父さんは、その旅の途中で。' },
          { name: '長老', face: 'elder', text: 'すまぬ。ずっと言えなんだ。だが今また、星が翳（かげ）りはじめた。……見たか、あの空を。' },
          { name: '長老', face: 'elder', text: '夜ごとに星が一つ、また一つと消えてゆく。世界の灯（ともしび）〈天の星〉が、弱っておるのだ。' },
          { name: 'リオ', face: 'lio', text: '星が……。だから最近、森から影のような魔物が湧いて出るんですね。' },
          { name: '長老', face: 'elder', text: 'さよう。星の光が絶えれば、この世は永遠の闇に沈む。かつて父御が退けた闇——〈星喰い〉が、また目を覚ましたのだ。' },
          { name: '長老', face: 'elder', text: '〈星の尖塔〉の頂に、星を継ぐ者だけが灯せる祭壇がある。リオ、お前こそ星守の血を継ぐ者。……頼めるか。' },
          { name: 'リオ', face: 'lio', text: '……父さんが、果たせなかった旅。' },
          { name: 'リオ', face: 'lio', text: 'はい。ぼくがやります。この村を、みんなを、闇になんて渡さない。' },
          { name: '長老', face: 'elder', text: 'よくぞ言うた。まずは村はずれのセナに声をかけよ。あの娘の魔法が、きっとお前を助けよう。' },
          { do: 'flag', flag: 'quest_started' }
        ];
      }
      // 討伐後
      if (has(state, 'boss_nox')) {
        return [
          { name: '長老', face: 'elder', text: 'よくぞ星を継いでくれた、リオ。空を見よ……星々が、あんなにも輝いておる。' },
          { name: '長老', face: 'elder', text: 'お前の父も、きっと同じ空の下で、この日をずっと待っておった。' },
          { name: 'リオ', face: 'lio', text: '……うん。今なら、父さんに胸を張れる気がするよ。' },
          { name: '長老', face: 'elder', text: 'お前は星守の誇りだ。ありがとう、リオ。' }
        ];
      }
      // 進行中：状況に応じた助言
      if (has(state, 'boss_warden')) {
        return [
          { name: '長老', face: 'elder', text: '〈星導の鍵〉を手にしたか。あとは尖塔の頂へ登るのみ。……父御の分まで、頼んだぞ。' },
          { name: '長老', face: 'elder', text: '案ずるな。お前はもう、一人ではない。傍らの仲間を信じよ。' }
        ];
      }
      const out = [
        { name: '長老', face: 'elder', text: '星の尖塔は〈囁きの森〉を抜け、〈古の遺跡〉の先にある。' },
        { name: '長老', face: 'elder', text: '遺跡は深い闇に閉ざされておる。〈星灯りのランタン〉があれば、道を照らせようが……気をつけて行くのだぞ。' }
      ];
      if (party(state, 'sena')) {
        out.push({ name: '長老', face: 'elder', text: 'セナが共にいるのだな。ならば心強い。あの娘を頼りなされ。' });
      } else {
        out.push({ name: '長老', face: 'elder', text: 'セナには声をかけたか? 村はずれの、水辺の家におる。' });
      }
      return out;
    },

    sena_intro: function (state) {
      if (party(state, 'sena')) {
        return [
          { name: 'セナ', face: 'sena', text: '準備はいい? 星の尖塔まで、わたしがついてる。心配ないわ。' },
          { name: 'セナ', face: 'sena', text: '……あなたのお父さんのこと、長老から聞いた。でも今度は、一人になんてさせない。' }
        ];
      }
      return [
        { name: 'セナ', face: 'sena', text: 'リオ! 長老から聞いたわ。星を継ぎに行くんでしょう?' },
        { name: 'リオ', face: 'lio', text: 'セナ……危ないよ。魔物もいるし——' },
        { name: 'セナ', face: 'sena', text: 'だからでしょ。あなた一人じゃ心配で、見てられないの。わたしの魔法、役に立つわよ。' },
        { name: 'リオ', face: 'lio', text: 'でも、もしセナに何かあったら——' },
        { name: 'セナ', face: 'sena', text: 'あのね。わたし、身寄りをなくしてこの村に拾われたの。ここが、わたしの帰る場所なのよ。' },
        { name: 'セナ', face: 'sena', text: 'その帰る場所が闇に呑まれるのを、黙って見てろって? ……できるわけ、ないでしょ。' },
        { name: 'リオ', face: 'lio', text: '……ありがとう、セナ。やっぱり、心強いよ。' },
        { do: 'join', who: 'sena' },
        { name: null, text: 'セナが仲間に加わった!' },
        { name: 'セナ', face: 'sena', text: 'よし、決まり。はぐれないでよ、リオ。' }
      ];
    },

    villager_shop: function (state) {
      const out = [
        { name: '村人', face: 'villager1', text: 'いらっしゃい。旅の支度かい? ……ずいぶん思いつめた顔だねえ。あんたも、星のことで?' },
        { name: '村人', face: 'villager1', text: '夜が長くなるにつれ、客足も遠のいてなあ。だが、あんたが行ってくれるってんなら、いい物を回すよ。' },
        { do: 'shop', shop: 'village' }
      ];
      if (has(state, 'boss_nox')) {
        out.push({ name: '村人', face: 'villager1', text: '星が戻ってから、村もすっかり活気づいた。全部あんたのおかげさ。まいどあり!' });
      } else {
        out.push({ name: '村人', face: 'villager1', text: '……星が戻る日を、ここで待ってるからな。生きて帰っとくれよ。' });
      }
      return out;
    },

    child: function (state) {
      if (has(state, 'boss_nox')) {
        return [
          { name: '子ども', face: 'villager2', text: 'お兄ちゃん、星が戻ったよ! すごい、すごい!' },
          { name: '子ども', face: 'villager2', text: 'ぼくもね、大きくなったら星守になるんだ。お兄ちゃんみたいに!' }
        ];
      }
      if (has(state, 'quest_started')) {
        return [
          { name: '子ども', face: 'villager2', text: 'お兄ちゃん、まだ星は戻せてないの……?' },
          { name: '子ども', face: 'villager2', text: 'ぼく、まいばんお祈りしてるよ。お兄ちゃんが、ぶじで帰ってきますようにって。' }
        ];
      }
      return [
        { name: '子ども', face: 'villager2', text: 'ねえ、夜になると星が消えるの。こわいよ……。' },
        { name: '子ども', face: 'villager2', text: 'お兄ちゃんが星を戻してくれるの? ……ほんとに?' },
        { name: 'リオ', face: 'lio', text: 'ああ、約束する。だから、いい子で待っててくれ。' }
      ];
    },

    fisher: function (state) {
      if (has(state, 'boss_nox')) {
        return [
          { name: '漁師', face: 'villager1', text: '見ろよ、川がまた澄んできた! 魚も戻ってくる。' },
          { name: '漁師', face: 'villager1', text: 'あんたのおかげだ。……ありがとよ、星守様。' }
        ];
      }
      return [
        { name: '漁師', face: 'villager1', text: '川の水も、なんだか濁っちまってな。影の魔物が水を汚してるって噂だ。' },
        { name: '漁師', face: 'villager1', text: 'やくそうは多めに持っていきな。森の奥はおっかねえぞ。' },
        { name: '漁師', face: 'villager1', text: 'おれの親父も昔、星守様の旅を手伝ったって自慢してたっけ。……あんたも、がんばりな。' }
      ];
    },

    /* ---------------- 囁きの森 ---------------- */
    traveler: function (state) {
      if (has(state, 'boss_warden')) {
        return [
          { name: '旅人', face: 'villager2', text: '守番を倒したのか! ……大したもんだ。あんた、ただの子どもじゃないな。' },
          { name: '旅人', face: 'villager2', text: 'この先はいよいよ尖塔だ。気を引き締めていけよ。' }
        ];
      }
      return [
        { name: '旅人', face: 'villager2', text: '遺跡の奥に〈守番〉がいるらしい。生半可な力じゃ通れんぞ。' },
        { name: '旅人', face: 'villager2', text: '仲間を集め、レベルを上げてから挑むんだな。' },
        { name: '旅人', face: 'villager2', text: 'それと——遺跡の中は、墨を流したような闇だ。灯りなしじゃ、一歩も進めんぞ。' }
      ];
    },

    forest_omen: function () {
      return [
        { name: null, text: '——森が、ざわめいている。木々の囁きが、まるで警告のようだ。' },
        { name: 'セナ', face: 'sena', text: 'リオ、空を見て。星がまた一つ……消えた。' },
        { name: 'リオ', face: 'lio', text: '……っ。こうしている間にも、闇は広がってるんだ。' },
        { name: 'セナ', face: 'sena', text: '焦らないで。でも、止まってもいられない。……行きましょう。遺跡はこの先よ。' },
        { name: 'リオ', face: 'lio', text: 'ああ。行こう。' }
      ];
    },

    /* ---------------- 古の遺跡 ---------------- */
    gord_intro: function (state) {
      if (party(state, 'gord')) {
        return [
          { name: 'ガード', face: 'gord', text: 'この盾、遠慮なく使え。守るのが、おれの役目だ。' },
          { name: 'ガード', face: 'gord', text: '……お前を見ていると、守れなかったものを思い出す。だから今度こそ、守り抜く。' }
        ];
      }
      const out = [
        { name: 'ガード', face: 'gord', text: '……星守の子か。こんな遺跡の奥まで、よく来たな。' },
        { name: 'リオ', face: 'lio', text: 'あなたは……騎士様?' },
        { name: 'ガード', face: 'gord', text: 'かつては、な。今はただの流れ者だ。守るべき国も、もうない。' },
        { name: 'リオ', face: 'lio', text: '国が……なくなった?' },
        { name: 'ガード', face: 'gord', text: '忍び寄る闇に、たった一夜で呑まれた。剣も盾も、間に合わなんだ。' }
      ];
      if (party(state, 'sena')) {
        out.push({ name: 'ガード', face: 'gord', text: 'あれが〈星喰い〉の仕業だと知ったのは、後のことだ。……星が消えれば、次はどこの国も同じ運命よ。' });
        out.push({ name: 'セナ', face: 'sena', text: 'それって……わたしたちの村や、世界中で起きていること。' });
      } else {
        out.push({ name: 'ガード', face: 'gord', text: 'あれが〈星喰い〉の仕業だと知ったのは、後のことだ。星が消えれば、次はどこの国も同じ運命よ。' });
      }
      out.push({ name: 'ガード', face: 'gord', text: 'だが——同じ闇に、二度も膝は折らん。星が消えるのを、指をくわえて見ている気にはなれん。' });
      out.push({ name: 'ガード', face: 'gord', text: 'おれの盾、貸してやろう。少年、お前の背中は、おれが守る。' });
      out.push({ do: 'join', who: 'gord' });
      out.push({ name: null, text: 'ガードが仲間に加わった!' });
      out.push({ name: 'ガード', face: 'gord', text: 'この奥の祭壇に〈守番〉がいる。星導の鍵を守っているはずだ。……覚悟はいいな。' });
      return out;
    },

    ruins_altar: function (state) {
      if (has(state, 'boss_warden')) {
        return [{ name: null, text: '砕けた祭壇が静かに佇んでいる。星導の鍵は、確かにこの手にある。' }];
      }
      return [
        { name: null, text: '祭壇に近づくと、床の紋様が赤く光り出した——!' },
        { name: 'ガード', face: 'gord', text: '来るぞ! 遺跡の守番だ。散開しろ!' },
        { name: 'リオ', face: 'lio', text: 'こいつを退ければ、星導の鍵が……! ——ひるむな!' },
        { do: 'boss', enemy: 'warden', flag: 'boss_warden', reward: 'starKey',
          afterKey: 'ruins_altar_after' }
      ];
    },
    ruins_altar_after: function (state) {
      const out = [
        { name: null, text: '守番は崩れ落ち、祭壇の奥から一本の鍵が——静かに光を放って現れた。' },
        { do: 'give', item: 'starKey' },
        { name: 'セナ', face: 'sena', text: '〈星導の鍵〉……これで、尖塔の扉が開くのね。' }
      ];
      if (party(state, 'gord')) {
        out.push({ name: 'ガード', face: 'gord', text: '星の尖塔——最後の階（きざはし）だ。ここまで来たら、もう退けん。' });
      }
      out.push({ name: 'リオ', face: 'lio', text: '父さんも、この鍵に手を伸ばしたのかな。……ううん、きっと届いたはずだ。' });
      out.push({ name: 'リオ', face: 'lio', text: 'いよいよだ。星を、取り戻しに行こう。' });
      return out;
    },

    /* ---------------- 星の尖塔 ---------------- */
    spire_boss: function (state) {
      if (has(state, 'boss_nox')) {
        return [{ name: null, text: '祭壇は今、あたたかな星の光に満ちている。' }];
      }
      const out = [
        { name: null, text: '尖塔の頂——砕けた星の祭壇の前に、闇そのものが渦を巻いていた。' },
        { name: '???', face: null, text: '……星を、継ぐだと? 星など、私が喰らい尽くす為にあるのだ。' },
        { name: 'リオ', face: 'lio', text: 'お前が……星を喰らう者、ノクス。父さんの旅を阻んだ、あの闇。' },
        { name: 'ノクス', face: null, text: '星守の父か。あれもよく足掻いた。だが灯は消えた——貴様も、同じ道を辿るがいい。' },
        { name: 'リオ', face: 'lio', text: '……っ。' },
        { name: 'リオ', face: 'lio', text: 'いいや——違う。父さんは、この星を守り抜いたんだ。だからぼくが、今ここに立っている。' },
        { name: 'ノクス', face: null, text: '光は必ず消える。ならば早いか遅いかの違いよ。さあ——お前たちも、闇に還れ。' }
      ];
      if (party(state, 'gord')) {
        out.push({ name: 'ガード', face: 'gord', text: '減らず口を。……皆、ここが正念場だ! おれの盾は、伊達じゃない。' });
      }
      if (party(state, 'sena')) {
        out.push({ name: 'セナ', face: 'sena', text: 'リオ、わたしたちがついてる。星を継ぐのは、あなたよ!' });
      }
      out.push({ name: 'リオ', face: 'lio', text: '——みんな、ありがとう。行くぞ! 星の光を、この手に!' });
      out.push({ do: 'boss', enemy: 'nox', flag: 'boss_nox', afterKey: 'ending' });
      return out;
    },

    ending: function (state) {
      const out = [
        { name: null, text: 'ノクスは断末魔とともに霧散し、闇が晴れてゆく——。' },
        { name: 'リオ', face: 'lio', text: '祭壇が……呼んでいる。' },
        { name: null, text: 'リオが祭壇に手をかざすと、胸の奥から温かな光があふれ出した。' },
        { name: null, text: 'それは遠い日、父が遺していった光。星守の血に、確かに受け継がれていた小さな灯火だった。' },
        { name: null, text: 'その光は天へと昇り、消えかけた星々に、一つ、また一つと灯をともしてゆく。' },
        { name: 'セナ', face: 'sena', text: 'すごい……空いちめんの、星。' }
      ];
      if (party(state, 'gord')) {
        out.push({ name: 'ガード', face: 'gord', text: 'よくやった、星守の子。……いや、リオ。お前はもう、立派な星守だ。' });
      }
      out.push({ name: 'リオ', face: 'lio', text: 'みんなのおかげだ。ぼく一人じゃ、ここまで来られなかった。' });
      out.push({ name: 'リオ', face: 'lio', text: '父さん、見てる……? 星は、ちゃんと継いだよ。' });
      out.push({ name: null, text: '星の光は世界のすみずみまで届き、長い夜は明けた。' });
      out.push({ name: null, text: '濁った川は澄み、闇に呑まれた国々にも、いつか朝が訪れるだろう。' });
      out.push({ name: null, text: '——こうして、消えかけた星は継がれた。少年の名は、星守リオ。' });
      out.push({ name: null, text: '　　　星継ぎのエテルナ　　　\n　　　　  〜 完 〜' });
      out.push({ do: 'ending' });
      return out;
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
