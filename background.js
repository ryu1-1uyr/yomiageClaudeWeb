// service worker: offscreen document の生成保証とメッセージ中継のみ。
// MV3 の service worker はアイドル約30秒で終了するため、状態（キュー等）は一切持たない。

let creating = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (contexts.length > 0) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "VOICEVOX で合成した音声の再生",
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target === "offscreen") return; // 自分が転送したメッセージは無視
  if (msg.type !== "READ" && msg.type !== "STOP") return;
  (async () => {
    try {
      await ensureOffscreen();
      chrome.runtime.sendMessage({ ...msg, target: "offscreen" });
    } catch (e) {
      console.error("[VV] offscreen への転送に失敗", e);
    }
  })();
});
