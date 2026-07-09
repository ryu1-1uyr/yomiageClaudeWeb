// service worker: offscreen document の生成保証とメッセージ中継のみ。
// MV3 の service worker はアイドル約30秒で終了するため、状態（キュー等）は一切持たない。

// 拡張の再読み込みで既存タブの content script は孤児化する（chrome.runtime が死ぬ）ため、
// 開いている claude.ai タブへ新しい content script を再注入して自動回復する。
// 孤児化した旧スクリプトは content.js 側の chrome.runtime.id チェックで自ら停止する。
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
  for (const tab of tabs) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["selectors.js", "content.js"],
      });
    } catch (e) {
      console.warn("[VV] content script の再注入に失敗:", tab.id, e);
    }
  }
});

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

  // popup の「最後の返答を読む」: claude.ai タブの content script に抽出を依頼する
  if (msg.type === "READ_LAST") {
    (async () => {
      const tabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
      const tab = tabs.find((t) => t.active) ?? tabs[0];
      if (!tab) {
        console.warn("[VV] claude.ai のタブが見つからないため READ_LAST を無視");
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: "READ_LAST" });
    })();
    return;
  }

  if (msg.type !== "READ" && msg.type !== "STOP") return;
  (async () => {
    try {
      await ensureOffscreen();
      // offscreen では chrome.storage が使えないため、READ に現在の話者・音量を同梱して渡す
      let voice, volume;
      if (msg.type === "READ") {
        [voice, volume] = await Promise.all([currentVoice(), currentVolume()]);
      }
      chrome.runtime.sendMessage({ ...msg, voice, volume, target: "offscreen" });
    } catch (e) {
      console.error("[VV] offscreen への転送に失敗", e);
    }
  })();
});

async function currentVoice() {
  const { speaker, voice } = await chrome.storage.local.get({
    speaker: 1,
    voice: null,
  });
  return voice ?? { engine: "voicevox", styleId: speaker };
}

async function currentVolume() {
  const { volume } = await chrome.storage.local.get({ volume: 100 });
  return volume / 100;
}

// 再生中の話者切り替えを offscreen に即時反映する（offscreen 未生成なら次の READ で渡るので何もしない）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!changes.voice && !changes.volume) return;
  (async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    if (contexts.length === 0) return;
    if (changes.voice) {
      chrome.runtime.sendMessage({
        target: "offscreen",
        type: "SET_VOICE",
        voice: changes.voice.newValue,
      });
    }
    if (changes.volume) {
      chrome.runtime.sendMessage({
        target: "offscreen",
        type: "SET_VOLUME",
        volume: changes.volume.newValue / 100,
      });
    }
  })();
});
