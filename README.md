# Claude VOICEVOX Reader

主要な AI チャット（claude.ai / ChatGPT / Gemini）で応答が完了すると、ローカルの音声合成エンジン（VOICEVOX / COEIROINK）で自動読み上げする Chrome 拡張機能。

対応サイト:

- [claude.ai](https://claude.ai)
- [ChatGPT](https://chatgpt.com)
- [Gemini](https://gemini.google.com)

> **注意**: 各サービス非公式の個人用ツールです。各サイトの DOM 構造に依存しているため、サイトのアップデートで動かなくなる可能性があります。

## 機能

- 応答完了を検知して自動で読み上げ（文単位で分割し、先読み合成で切れ目なく再生）
- コードブロックは本体を読まず「〇〇のコードブロック」、テーブルは「表」とだけ読む
- 絵文字・URL は除去して読み上げ
- ポップアップから話者切り替え（VOICEVOX / COEIROINK の全キャラ・全スタイル、およびブラウザ標準音声を動的取得）
- 音量調整・「最後の返答を読む」ボタン・停止ボタン・読み上げ ON/OFF トグル
- 英単語のカタカナ読み辞書（例: `TypeScript` を「タイプスクリプト」と読ませる。詳細は[読み方辞書](#読み方辞書)）

## 必要なもの

- Google Chrome
- [VOICEVOX](https://voicevox.hiroshiba.jp/)（`http://localhost:50021` で起動していること）
- [COEIROINK](https://coeiroink.com/) v2（任意。`http://localhost:50032` で起動していれば話者として選択可能）
- Node.js（任意。[読み方辞書](#読み方辞書)の同期スクリプト・辞書エディタを使う場合のみ）

## 導入方法

1. このリポジトリをクローンする

   ```
   git clone https://github.com/ryu1-1uyr/yomiageClaudeWeb.git
   git clone git@github.com:ryu1-1uyr/yomiageClaudeWeb.git
   ```

2. Chrome で `chrome://extensions` を開く
3. 右上の「デベロッパー モード」を ON にする
4. 「パッケージ化されていない拡張機能を読み込む」からクローンしたフォルダを選択する
5. VOICEVOX を起動した状態で [claude.ai](https://claude.ai) を開き、Claude に質問する
6. 返答が完了すると読み上げが始まる

話者の変更や停止は、ツールバーの拡張アイコンから開くポップアップで行う。

## 読み方辞書

VOICEVOX / COEIROINK は辞書に無い英単語をアルファベット読み（`TypeScript` →「ティーワイピーイー…」）してしまう。これを避けるため、単語とカタカナ読みの対応を `words.json` に登録し、両エンジンへ同期する仕組みを用意している。

- 正本は `words.json`（`{ "surface": "TypeScript", "kana": "タイプスクリプト", "accent": 4 }` の配列。`accent` は任意で既定 0）
- 同期すると VOICEVOX のユーザー辞書へ差分登録（永続）、COEIROINK へプッシュ（起動中のみ・セッション限り）、`~/claude-code-hook/` 側へコピーを行う

### 登録方法

いずれの方法でも `words.json` が唯一の正本で、保存と同時に両エンジンへ同期される。

- **CLI**: `words.json` を直接編集して `node tools/sync-dict.js` を実行
- **辞書エディタ（GUI）**: `node tools/dict-server.js` で `http://127.0.0.1:50090` にエディタが開く。一覧編集・追加・削除・テスト再生ができる
- **拡張のポップアップ**: 辞書エディタのサーバー（`dict-server.js`）を起動していると、ポップアップに単語登録フォームが現れ、ブラウジング中にその場で登録できる

読みはカタカナ・ひらがなどちらで入力してもよい（保存時にカタカナへ正規化される）。

## トラブルシューティング

- **読み上げられない**: VOICEVOX が起動しているか確認。拡張のコンソール（`chrome://extensions` → 「ビュー: offscreen.html」や「Service Worker」）にエラーが出ていないか確認
- **拡張を更新・再読み込みした直後**: 開いている対応サイトのタブへは content script が自動で再注入されるが、うまく動かない場合はタブをリロードする
- **英単語がアルファベット読みされる**: `words.json` に単語を登録して同期する（[読み方辞書](#読み方辞書)）。COEIROINK は辞書がセッション限りのため、エンジン再起動後は同期し直すか、拡張側の初回読み上げ時の自動プッシュを待つ

## 生成音声の取り扱い

読み上げた音声を動画等で公開する場合は、各エンジン・キャラクターの利用規約に従ってください（例: VOICEVOX のキャラクターは「VOICEVOX:ずんだもん」のようなクレジット表記が必要です）。本拡張は音声・キャラクター素材を同梱していません。

## License

[MIT](LICENSE)
