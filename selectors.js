// claude.ai の DOM セレクタ定数。UI 変更で壊れたらこのファイルだけ直す。
// content.js より先に読み込まれる（manifest.json の js 配列の順序で保証）。
// 拡張リロード時の再注入で二重評価されても壊れないよう var で宣言する。
var VV_SELECTORS = {
  streamingAttr: "data-is-streaming",
  messageIndex: "[data-index]",
  responseContainer: ".font-claude-response",
  markdownBody: ".standard-markdown",
  userMessage: '[data-testid="user-message"]',
  srOnly: ".sr-only",
  codeLangClassPrefix: "language-",
  codeBlockLabel: 'div[class*="text-text-500"]',
};
