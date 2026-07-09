// サイトアダプタ定義。claude.ai / ChatGPT / Gemini ごとに「完了検知」「最後の応答取得」「抽出設定」を提供する。
// content.js より先に読み込まれる（manifest.json の js 配列の順序で保証）。
// 拡張リロード時の再注入で二重評価されても壊れないよう var で宣言する。
//
// アダプタのインターフェース:
//   watch(onComplete, forget)
//     完了検知を開始する。完了時に onComplete(rootEl, dedupKey) を呼ぶ。
//     rootEl は応答本文を含むルート要素、dedupKey は二重読み防止用の一意キー。
//     forget(dedupKey) は再生成時の読み直しを許すためのフック（使うのは claude のみ）。
//   getLastResponse()
//     最後のアシスタント応答の rootEl を返す（READ_LAST 用）。無ければ null。
//   extract
//     bodySelector: rootEl 配下の本文ルート要素セレクタ
//     skipSelector: スクリーンリーダー用など読み飛ばす要素のセレクタ
//     codeBlockSelector: コードブロックと判定する要素のセレクタ
//     codeLabel(el): コードブロック要素から読み上げ用ラベル文字列を返す
//     wrapperSelector（任意）: depth 0 の1階層だけでは届かない中間ラッパー要素のセレクタ。
//       一致する要素は深さ制限つきで再帰的に潜る（例: Gemini の response-element）
var VV_ADAPTERS = (() => {
  // --- claude.ai ---
  const claude = (() => {
    const S = {
      streamingAttr: "data-is-streaming",
      messageIndex: "[data-index]",
      markdownBody: ".standard-markdown",
      userMessage: '[data-testid="user-message"]',
      srOnly: ".sr-only",
      codeLangClassPrefix: "language-",
      codeBlockLabel: 'div[class*="text-text-500"]',
    };

    function conversationId() {
      const m = location.pathname.match(/\/chat\/([^/]+)/);
      return m ? m[1] : location.pathname;
    }

    function messageKey(el) {
      const idx = el.closest(S.messageIndex)?.getAttribute("data-index");
      // data-index が取れない場合は二重読みを許容して読み逃しを防ぐ
      return `${conversationId()}:${idx ?? Date.now()}`;
    }

    function codeLabel(preEl) {
      let lang = "";
      const code = preEl.querySelector('code[class*="language-"]');
      if (code) {
        const cls = [...code.classList].find((c) =>
          c.startsWith(S.codeLangClassPrefix)
        );
        if (cls) lang = cls.slice(S.codeLangClassPrefix.length);
      }
      if (!lang) {
        const group = preEl.closest('[role="group"]');
        const label =
          preEl.querySelector(S.codeBlockLabel) ??
          group?.querySelector(S.codeBlockLabel);
        lang = label?.innerText.trim() ?? "";
      }
      if (!lang) {
        const aria =
          preEl.closest('[role="group"]')?.getAttribute("aria-label") ?? "";
        lang = aria.replace(/コード$/, "").trim();
      }
      return lang ? `${lang} のコードブロック` : "コードブロック";
    }

    return {
      extract: {
        bodySelector: S.markdownBody,
        skipSelector: S.srOnly,
        codeBlockSelector: "pre",
        codeLabel,
      },
      watch(onComplete, forget) {
        const observer = new MutationObserver((records) => {
          // 拡張リロードでこのスクリプトは孤児化し chrome.runtime が消える。
          // 新スクリプトが再注入されるので旧スクリプトは黙って停止する。
          if (!chrome.runtime?.id) {
            observer.disconnect();
            return;
          }
          for (const record of records) {
            if (
              record.type !== "attributes" ||
              record.attributeName !== S.streamingAttr
            ) {
              continue;
            }
            const el = record.target;
            const value = el.getAttribute(S.streamingAttr);
            if (value === "true") {
              // 生成開始（再生成含む）: 読み直せるように処理済みキーを消す
              forget(messageKey(el));
            } else if (value === "false" && record.oldValue === "true") {
              // true → false の遷移のみ完了とみなす。
              // 「最初から false」（初期ロード・SPA の会話切替）はここに来ない。
              if (el.closest(S.userMessage)) continue;
              onComplete(el, messageKey(el));
            }
          }
        });
        observer.observe(document.body, {
          attributes: true,
          subtree: true,
          attributeFilter: [S.streamingAttr],
          attributeOldValue: true,
        });
      },
      getLastResponse() {
        const done = document.querySelectorAll(`[${S.streamingAttr}="false"]`);
        const last = done[done.length - 1];
        if (!last || last.closest(S.userMessage)) return null;
        return last;
      },
    };
  })();

  // --- ChatGPT（chatgpt.com） ---
  const chatgpt = (() => {
    const ASSISTANT = '[data-message-author-role="assistant"]';

    function dedupKey(root) {
      const id =
        root.getAttribute("data-message-id") ??
        root.querySelector("[data-message-id]")?.getAttribute("data-message-id");
      return `chatgpt:${id ?? Date.now()}`;
    }

    function codeLabel(preEl) {
      // pre 内の .select-none div の先頭テキストが言語名（例: "TypeScript"）
      const label =
        preEl.querySelector(".select-none div") ??
        preEl.querySelector(".select-none");
      const lang = label?.textContent.trim() ?? "";
      return lang ? `${lang} のコードブロック` : "コードブロック";
    }

    return {
      extract: {
        bodySelector: ".markdown",
        skipSelector: ".sr-only",
        codeBlockSelector: "pre",
        codeLabel,
      },
      watch(onComplete) {
        const observer = new MutationObserver((records) => {
          if (!chrome.runtime?.id) {
            observer.disconnect();
            return;
          }
          for (const record of records) {
            if (
              record.type !== "attributes" ||
              record.attributeName !== "data-stream-active"
            ) {
              continue;
            }
            const el = record.target;
            // oldValue が非 null（＝以前は付いていた）かつ現在属性が無い場合のみ完了。
            // 属性の付与イベントや、履歴ロードで一度も付かなかった要素では発火しない。
            if (record.oldValue === null || el.hasAttribute("data-stream-active")) {
              continue;
            }
            const root = el.closest(ASSISTANT) ?? el.querySelector(ASSISTANT);
            if (!root) continue;
            onComplete(root, dedupKey(root));
          }
        });
        observer.observe(document.body, {
          attributes: true,
          subtree: true,
          attributeFilter: ["data-stream-active"],
          attributeOldValue: true,
        });
      },
      getLastResponse() {
        // data-stream-active を自身または子孫に持つ（＝生成中の）メッセージは除外し、
        // 最後の完了済みメッセージを返す。
        const msgs = [...document.querySelectorAll(ASSISTANT)];
        for (let i = msgs.length - 1; i >= 0; i--) {
          const msg = msgs[i];
          if (msg.hasAttribute("data-stream-active")) continue;
          if (msg.querySelector("[data-stream-active]")) continue;
          return msg;
        }
        return null;
      },
    };
  })();

  // --- Gemini（gemini.google.com） ---
  const gemini = (() => {
    // aria-busy はタイプライター表示演出ドリブンで、バックグラウンドタブでは false に落ちない。
    // テキスト本体はバックグラウンドでも DOM に到達するため、pending-response で武装するデバウンス方式を採る。
    // 注意: Chrome の intensive throttling により長時間バックグラウンドのタブでは
    // タイマーが最大1分遅延しうる。
    const DEBOUNCE_MS = 2500;

    function dedupKey(root) {
      const mcId = root.querySelector("message-content")?.id;
      const jslog = root.closest("response-container")?.getAttribute("jslog");
      let id = mcId || jslog;
      if (!id) {
        const all = document.querySelectorAll("model-response");
        const index = [...all].indexOf(root);
        id = `${location.pathname}:${index}`;
      }
      return `gemini:${id}`;
    }

    function codeLabel(el) {
      const label = el.querySelector(".code-block-decoration span");
      const lang = label?.textContent.trim() ?? "";
      return lang ? `${lang} のコードブロック` : "コードブロック";
    }

    return {
      extract: {
        bodySelector: "message-content",
        skipSelector: ".cdk-visually-hidden",
        codeBlockSelector: "code-block",
        // code-block は response-element というラッパーに包まれて出現するため、
        // depth 0 の1階層潜りだけでは届かない。wrapperSelector で深さ制限つきに潜る。
        wrapperSelector: "response-element",
        codeLabel,
      },
      watch(onComplete) {
        let timer = null;
        // 武装した時点で存在していた model-response の数。この数を超えて初めて
        // 「新しいターンの応答が現れた」とみなす（後述 complete 参照）。
        let baselineCount = 0;

        function disarm() {
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          if (subtreeObserver) {
            subtreeObserver.disconnect();
            subtreeObserver = null;
          }
        }

        let subtreeObserver = null;

        function complete() {
          // 拡張リロードで孤児化した旧インスタンスの timer 発火を無効化する。
          // 新スクリプトが再注入されるので旧スクリプトは黙って停止する。
          if (!chrome.runtime?.id) {
            disarm();
            return;
          }
          // pending-response の closest(".conversation-container") は送信直後の一時要素
          // （pending-request）を指すことがあり、応答完了時に DOM から削除されうる。
          // 監視コンテナのサブツリーではなく document 全体から最後の model-response を拾う。
          const responses = document.querySelectorAll("model-response");
          if (responses.length <= baselineCount) {
            // thinking 系モデル等で初回トークンまで DEBOUNCE_MS 以上かかると、
            // 新しい model-response がまだ生成されていない状態でタイマーが先に発火しうる。
            // ここで完了扱いにすると前ターンの応答（読了済み・dedup で no-op）を拾って
            // 武装解除してしまい、本来読むべき応答を取り逃す。武装を維持して再スケジュールする。
            timer = setTimeout(complete, DEBOUNCE_MS);
            return;
          }
          disarm();
          const root = responses[responses.length - 1];
          if (root) onComplete(root, dedupKey(root));
        }

        function arm(pendingNode) {
          if (subtreeObserver) return; // 武装済み
          baselineCount = document.querySelectorAll("model-response").length;
          // conversation-container の親である infinite-scroller を監視対象にする。
          // pending-response 自身の closest(".conversation-container") は一時要素
          // （pending-request）を指す可能性があるため使わない。
          const target =
            pendingNode.closest?.("infinite-scroller") ?? document.body;
          subtreeObserver = new MutationObserver(() => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(complete, DEBOUNCE_MS);
          });
          subtreeObserver.observe(target, {
            childList: true,
            characterData: true,
            subtree: true,
          });
          // 変異が来なくても完了判定できるよう初回タイマーを仕込む
          timer = setTimeout(complete, DEBOUNCE_MS);
        }

        const bodyObserver = new MutationObserver((records) => {
          if (!chrome.runtime?.id) {
            bodyObserver.disconnect();
            disarm();
            return;
          }
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (node.nodeType !== 1) continue;
              // pending-response の出現がユーザー送信の開始シグナル（履歴ロードでは出ない）
              const pending = node.matches?.("pending-response")
                ? node
                : node.querySelector?.("pending-response");
              if (pending) {
                arm(pending);
                return;
              }
            }
          }
        });
        bodyObserver.observe(document.body, { childList: true, subtree: true });
      },
      getLastResponse() {
        // pending-response が存在する＝生成中のターンがある場合、末尾の model-response は
        // まだ完了していない可能性があるため除外し、その1つ前（完了済み）を返す。
        const generating = document.querySelector("pending-response") !== null;
        const responses = document.querySelectorAll("model-response");
        if (responses.length === 0) return null;
        if (!generating) return responses[responses.length - 1];
        return responses.length >= 2 ? responses[responses.length - 2] : null;
      },
    };
  })();

  return {
    "claude.ai": claude,
    "chatgpt.com": chatgpt,
    "gemini.google.com": gemini,
  };
})();

function vvSelectAdapter(hostname) {
  if (hostname === "claude.ai" || hostname.endsWith(".claude.ai")) {
    return VV_ADAPTERS["claude.ai"];
  }
  if (hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com")) {
    return VV_ADAPTERS["chatgpt.com"];
  }
  if (hostname === "gemini.google.com") {
    return VV_ADAPTERS["gemini.google.com"];
  }
  return null;
}
