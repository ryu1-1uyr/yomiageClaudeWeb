// content script: 返答完了の検知 → テキスト抽出・整形 → 文単位チャンク分割 → background へ送信
//
// 通常はページ読み込み時に manifest 経由で注入されるが、拡張リロード時には
// background の onInstalled から再注入される。同一ロード内での二重実行を
// globalThis のフラグで防ぐ（拡張リロード後は isolated world ごと新しくなるので再注入は素通りする）。
if (!globalThis.__vvReaderLoaded) {
  globalThis.__vvReaderLoaded = true;

  const MIN_CHUNK = 30;
  const MAX_CHUNK = 200;

  let enabled = true;
  // 処理済みメッセージのキー（会話ID:data-index）。DOM 属性は React の再レンダーで消えるため JS メモリで持つ。
  const readKeys = new Set();

  chrome.storage.local.get({ enabled: true }).then((v) => {
    enabled = v.enabled;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.enabled) enabled = changes.enabled.newValue;
  });

  function conversationId() {
    const m = location.pathname.match(/\/chat\/([^/]+)/);
    return m ? m[1] : location.pathname;
  }

  function messageKey(el) {
    const idx = el.closest(VV_SELECTORS.messageIndex)?.getAttribute("data-index");
    // data-index が取れない場合は二重読みを許容して読み逃しを防ぐ
    return `${conversationId()}:${idx ?? Date.now()}`;
  }

  // --- テキスト抽出 ---

  function extractBlocks(responseEl) {
    const blocks = [];
    for (const md of responseEl.querySelectorAll(VV_SELECTORS.markdownBody)) {
      collectBlocks(md, blocks, 0);
    }
    return blocks;
  }

  function collectBlocks(el, blocks, depth) {
    for (const child of el.children) {
      if (child.matches(VV_SELECTORS.srOnly)) continue;
      const tag = child.tagName;
      if (tag === "P" || /^H[1-6]$/.test(tag)) {
        blocks.push(child.innerText);
      } else if (tag === "UL" || tag === "OL") {
        for (const li of child.querySelectorAll(":scope > li")) {
          blocks.push(li.innerText);
        }
      } else if (tag === "PRE") {
        blocks.push(codeBlockLabel(child));
      } else if (tag === "TABLE") {
        blocks.push("表");
      } else if (tag === "HR") {
        // 無視
      } else if (depth === 0) {
        // div 等のラッパーは1階層だけ潜って同じ分岐を適用
        collectBlocks(child, blocks, 1);
      }
    }
  }

  function codeBlockLabel(preEl) {
    let lang = "";
    const code = preEl.querySelector('code[class*="language-"]');
    if (code) {
      const cls = [...code.classList].find((c) =>
        c.startsWith(VV_SELECTORS.codeLangClassPrefix)
      );
      if (cls) lang = cls.slice(VV_SELECTORS.codeLangClassPrefix.length);
    }
    if (!lang) {
      const group = preEl.closest('[role="group"]');
      const label =
        preEl.querySelector(VV_SELECTORS.codeBlockLabel) ??
        group?.querySelector(VV_SELECTORS.codeBlockLabel);
      lang = label?.innerText.trim() ?? "";
    }
    if (!lang) {
      const aria = preEl.closest('[role="group"]')?.getAttribute("aria-label") ?? "";
      lang = aria.replace(/コード$/, "").trim();
    }
    return lang ? `${lang} のコードブロック` : "コードブロック";
  }

  // --- 整形・チャンク分割 ---

  function sanitize(text) {
    return text
      // \p{Emoji} は数字にもマッチするため使わない
      .replace(/[\p{Extended_Pictographic}‍️]/gu, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\*{1,2}|`{1,3}/g, "")
      .replace(/[ \t　]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  function splitIntoChunks(blocks) {
    const chunks = [];
    for (const block of blocks) {
      const text = sanitize(block);
      if (!text) continue;
      const parts = text
        .split(/(?<=[。！？!?])|\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      // 短い文は次の文と結合する（ブロック境界はまたがない）
      const merged = [];
      for (const part of parts) {
        const last = merged[merged.length - 1];
        if (
          last !== undefined &&
          last.length < MIN_CHUNK &&
          last.length + part.length <= MAX_CHUNK
        ) {
          // 半角文字で終わる片（英文等）は trim で消えたスペースを補って結合する
          const sep = /[\x21-\x7E]$/.test(last) ? " " : "";
          merged[merged.length - 1] = last + sep + part;
        } else {
          merged.push(part);
        }
      }
      chunks.push(...merged);
    }
    return chunks;
  }

  // --- 完了検知 ---

  function onResponseComplete(el) {
    if (!enabled) return;
    if (el.closest(VV_SELECTORS.userMessage)) return;
    const key = messageKey(el);
    if (readKeys.has(key)) return;
    readKeys.add(key);
    const chunks = splitIntoChunks(extractBlocks(el));
    if (chunks.length === 0) return;
    chrome.runtime.sendMessage({ type: "READ", chunks });
  }

  const observer = new MutationObserver((records) => {
    // 拡張がリロードされるとこのスクリプトは孤児化し chrome.runtime が消える。
    // 新しいスクリプトが background から再注入されるので、旧スクリプトは黙って停止する。
    if (!chrome.runtime?.id) {
      observer.disconnect();
      return;
    }
    for (const record of records) {
      if (
        record.type !== "attributes" ||
        record.attributeName !== VV_SELECTORS.streamingAttr
      ) {
        continue;
      }
      const el = record.target;
      const value = el.getAttribute(VV_SELECTORS.streamingAttr);
      if (value === "true") {
        // 生成開始（再生成含む）: 読み直せるように処理済みキーを消す
        readKeys.delete(messageKey(el));
      } else if (value === "false" && record.oldValue === "true") {
        // true → false の遷移のみ完了とみなす。
        // 「最初から false」（初期ロード・SPA の会話切替）はここに来ない。
        onResponseComplete(el);
      }
    }
  });

  observer.observe(document.body, {
    attributes: true,
    subtree: true,
    attributeFilter: [VV_SELECTORS.streamingAttr],
    attributeOldValue: true,
  });

  // popup の「最後の返答を読む」（background 経由の tabs.sendMessage で届く）。
  // 手動操作なので enabled トグルと処理済みガードは無視して読む。
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== "READ_LAST") return;
    const done = document.querySelectorAll(`[${VV_SELECTORS.streamingAttr}="false"]`);
    const last = done[done.length - 1];
    if (!last || last.closest(VV_SELECTORS.userMessage)) return;
    const chunks = splitIntoChunks(extractBlocks(last));
    if (chunks.length > 0) chrome.runtime.sendMessage({ type: "READ", chunks });
  });
}
