# Claude VOICEVOX Reader

claude.ai（ブラウザ版）で Claude の返答が完了すると、ローカルの音声合成エンジン（VOICEVOX / COEIROINK）で自動読み上げする Chrome 拡張機能。

> **注意**: Anthropic 非公式の個人用ツールです。claude.ai の DOM 構造に依存しているため、サイトのアップデートで動かなくなる可能性があります。

## 機能

- Claude の返答完了を検知して自動で読み上げ（文単位で分割し、先読み合成で切れ目なく再生）
- コードブロックは本体を読まず「〇〇のコードブロック」、テーブルは「表」とだけ読む
- 絵文字・URL は除去して読み上げ
- ポップアップから話者切り替え（VOICEVOX / COEIROINK の全キャラ・全スタイルを動的取得）
- 「最後の返答を読む」ボタン・停止ボタン・読み上げ ON/OFF トグル

## 必要なもの

- Google Chrome
- [VOICEVOX](https://voicevox.hiroshiba.jp/)（`http://localhost:50021` で起動していること）
- [COEIROINK](https://coeiroink.com/) v2（任意。`http://localhost:50032` で起動していれば話者として選択可能）

## 導入方法

1. このリポジトリをクローンする

   ```
   git clone https://github.com/ryu1-1uyr/yomiageClaudeWeb.git
   ```

2. Chrome で `chrome://extensions` を開く
3. 右上の「デベロッパー モード」を ON にする
4. 「パッケージ化されていない拡張機能を読み込む」からクローンしたフォルダを選択する
5. VOICEVOX を起動した状態で [claude.ai](https://claude.ai) を開き、Claude に質問する
6. 返答が完了すると読み上げが始まる

話者の変更や停止は、ツールバーの拡張アイコンから開くポップアップで行う。

## トラブルシューティング

- **読み上げられない**: VOICEVOX が起動しているか確認。拡張のコンソール（`chrome://extensions` → 「ビュー: offscreen.html」や「Service Worker」）にエラーが出ていないか確認
- **拡張を更新・再読み込みした直後**: 開いている claude.ai タブへは content script が自動で再注入されるが、うまく動かない場合はタブをリロードする

## 生成音声の取り扱い

読み上げた音声を動画等で公開する場合は、各エンジン・キャラクターの利用規約に従ってください（例: VOICEVOX のキャラクターは「VOICEVOX:ずんだもん」のようなクレジット表記が必要です）。本拡張は音声・キャラクター素材を同梱していません。

## License

[MIT](LICENSE)
