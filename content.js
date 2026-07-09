// content script: 返答完了の検知 → テキスト抽出・整形 → 文単位チャンク分割 → background へ送信
//
// サイトごとの差分（完了検知・最後の応答取得・抽出設定）は adapters.js のアダプタに閉じ込め、
// このファイルは location.hostname でアダプタを選ぶ汎用実装にする。
//
// 通常はページ読み込み時に manifest 経由で注入されるが、拡張リロード時には
// background の onInstalled から再注入される。同一ロード内での二重実行を
// globalThis のフラグで防ぐ（拡張リロード後は isolated world ごと新しくなるので再注入は素通りする）。
if (!globalThis.__vvReaderLoaded) {
  globalThis.__vvReaderLoaded = true;

  const adapter = vvSelectAdapter(location.hostname);

  if (adapter) {
    const MIN_CHUNK = 30;
    const MAX_CHUNK = 200;

    let enabled = true;
    // 処理済みメッセージのキー（アダプタが払い出す dedupKey）。
    // DOM 属性は React 等の再レンダーで消えるため JS メモリで持つ。
    const readKeys = new Set();

    chrome.storage.local.get({ enabled: true }).then((v) => {
      enabled = v.enabled;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.enabled) enabled = changes.enabled.newValue;
    });

    // --- テキスト抽出 ---

    function extractBlocks(rootEl) {
      const blocks = [];
      for (const md of rootEl.querySelectorAll(adapter.extract.bodySelector)) {
        collectBlocks(md, blocks, 0);
      }
      return blocks;
    }

    // ラッパーへの再帰的な潜り込みが無限に続かないようにする上限
    const MAX_WRAPPER_DEPTH = 4;

    function collectBlocks(el, blocks, depth) {
      const { skipSelector, codeBlockSelector, codeLabel, wrapperSelector } =
        adapter.extract;
      for (const child of el.children) {
        if (skipSelector && child.matches(skipSelector)) continue;
        if (child.matches(codeBlockSelector)) {
          // コードブロックは本体を読まずラベルへ置換（内部の UI ヘッダー等も読まない）
          blocks.push(codeLabel(child));
          continue;
        }
        const tag = child.tagName;
        if (tag === "TABLE") {
          blocks.push("表");
        } else if (tag === "P" || /^H[1-6]$/.test(tag)) {
          blocks.push(child.innerText);
        } else if (tag === "UL" || tag === "OL") {
          for (const li of child.querySelectorAll(":scope > li")) {
            blocks.push(li.innerText);
          }
        } else if (tag === "HR") {
          // 無視
        } else if (depth === 0) {
          // div 等のラッパーは1階層だけ潜って同じ分岐を適用
          collectBlocks(child, blocks, 1);
        } else if (
          wrapperSelector &&
          depth < MAX_WRAPPER_DEPTH &&
          child.matches(wrapperSelector)
        ) {
          // サイト固有の中間ラッパー（例: Gemini の response-element）は深さに関わらず潜る
          collectBlocks(child, blocks, depth + 1);
        }
      }
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

    // --- 完了検知（アダプタ経由） ---

    function onComplete(rootEl, dedupKey) {
      if (!enabled) return;
      if (readKeys.has(dedupKey)) return;
      readKeys.add(dedupKey);
      const chunks = splitIntoChunks(extractBlocks(rootEl));
      if (chunks.length === 0) return;
      chrome.runtime.sendMessage({ type: "READ", chunks });
    }

    // 再生成時に読み直せるよう処理済みキーを消す（アダプタが必要に応じて呼ぶ）
    const forget = (dedupKey) => readKeys.delete(dedupKey);

    adapter.watch(onComplete, forget);

    // popup の「最後の返答を読む」（background 経由の tabs.sendMessage で届く）。
    // 手動操作なので enabled トグルと処理済みガードは無視して読む。
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== "READ_LAST") return;
      const root = adapter.getLastResponse();
      if (!root) return;
      const chunks = splitIntoChunks(extractBlocks(root));
      if (chunks.length > 0) chrome.runtime.sendMessage({ type: "READ", chunks });
    });
  }
}
