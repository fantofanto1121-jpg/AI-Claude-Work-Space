# QA ツール（ゲーム本体には含まれない）

夜間改善キャンペーン用の自動長時間プレイ・テストハーネス。

- `campaign.js` — Playwright(chromium)でゲームを起動し、全機体を解放して指定機体を選択、
  回避+強化選択ボットで長時間プレイし、所見をJSON1行で出力する。
  死亡検出はgameover画面を各反復の先頭で確認（誤検出なし）。Spaceダッシュは使わない
  （gameover画面でstartRun()を呼び再スタートしてしまうため）。
  aggroモードはボスへ接近して撃破可否を検証する。

使い方（scratchのハーネスディレクトリに複製し、index.html/style.css/game.jsを並べ、
game.jsに `window.__SF` 計測フックを注入した上で実行）:
  node campaign.js "<機体JP名>" <capMs> <normal|hard|inferno> <dodge|aggro>

これはテスト専用でゲーム(index.html/game.js/style.css)からは参照されない。
