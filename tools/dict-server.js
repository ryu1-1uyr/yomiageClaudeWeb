// 読み上げ辞書（words.json）編集用のローカル GUI サーバー。`node tools/dict-server.js` で起動する。
// 標準モジュールのみ（http / fs / path / child_process）。npm 依存なし。
// 127.0.0.1:50090 でのみ待ち受け、起動時に既定ブラウザで編集画面を開く。

const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { syncVoicevox, pushCoeiroink, copyToHook } = require("./sync-dict.js");

// Node の fetch は localhost を IPv6 優先で解決してエンジンに繋がらないため 127.0.0.1 を使う
const VOICEVOX_BASE = "http://127.0.0.1:50021";

const PORT = 50090;
const HOST = "127.0.0.1";
const WORDS_PATH = path.join(__dirname, "..", "words.json");
const UI_PATH = path.join(__dirname, "dict-ui.html");

const KANA_RE = /^[ァ-ヴー]+$/;

// ひらがなをカタカナに変換する（エンジンはカタカナ必須のため、入力はひらがなも受け付けて正規化する）
function toKatakana(str) {
  return str.replace(/[ぁ-ゖ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + 0x60)
  );
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// words 配列を検証し、不正なら理由文字列を返す（正常なら null）
function validateWords(words) {
  if (!Array.isArray(words)) return "words is not an array";
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word || typeof word !== "object") return `${i}番目: 不正なエントリです`;
    if (typeof word.surface !== "string" || word.surface.length === 0) {
      return `${i}番目: surfaceが空です`;
    }
    if (typeof word.kana !== "string" || word.kana.length === 0) {
      return `${i}番目: kanaが空です`;
    }
    if (!KANA_RE.test(word.kana)) {
      return `${i}番目: kanaがカタカナではありません`;
    }
    if (word.accent !== undefined) {
      if (
        typeof word.accent !== "number" ||
        !Number.isInteger(word.accent) ||
        word.accent < 0
      ) {
        return `${i}番目: accentが不正です`;
      }
    }
  }
  return null;
}

function readWords() {
  const { words } = JSON.parse(fs.readFileSync(WORDS_PATH, "utf8"));
  return words;
}

function handleGetWords(res) {
  try {
    const words = readWords();
    sendJson(res, 200, { words });
  } catch {
    sendJson(res, 500, { error: "failed to load words" });
  }
}

async function handlePutWords(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "invalid words data", details: "invalid json" });
    return;
  }

  // ひらがな読みはカタカナに正規化してから検証する
  const rawWords = body && body.words;
  const words = Array.isArray(rawWords)
    ? rawWords.map((word) =>
        word && typeof word === "object" && typeof word.kana === "string"
          ? { ...word, kana: toKatakana(word.kana) }
          : word
      )
    : rawWords;
  const invalidReason = validateWords(words);
  if (invalidReason) {
    sendJson(res, 400, { error: "invalid words data", details: invalidReason });
    return;
  }

  // accent 未指定の語には 0 を補完してから保存する
  const normalized = words.map((word) => ({
    surface: word.surface,
    kana: word.kana,
    accent: word.accent ?? 0,
  }));

  try {
    fs.writeFileSync(WORDS_PATH, JSON.stringify({ words: normalized }, null, 2) + "\n");
  } catch {
    sendJson(res, 500, { error: "failed to save words" });
    return;
  }

  const sync = { voicevox: null, coeiroink: null, hookCopy: false };
  try {
    sync.voicevox = await syncVoicevox(normalized);
  } catch (e) {
    console.error("VOICEVOX 同期に失敗しました:", e);
  }
  try {
    sync.coeiroink = await pushCoeiroink(normalized);
  } catch (e) {
    console.error("COEIROINK 同期に失敗しました:", e);
  }
  try {
    copyToHook();
    sync.hookCopy = true;
  } catch (e) {
    console.error("hook へのコピーに失敗しました:", e);
  }

  sendJson(res, 200, { saved: true, sync });
}

async function handlePostWord(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "invalid json" });
    return;
  }
  if (!body || typeof body !== "object") {
    sendJson(res, 400, { error: "invalid word" });
    return;
  }
  const { surface } = body;
  const accent = body.accent ?? 0;
  if (typeof surface !== "string" || surface.length === 0) {
    sendJson(res, 400, { error: "surfaceが空です" });
    return;
  }
  const kana = typeof body.kana === "string" ? toKatakana(body.kana) : "";
  if (!KANA_RE.test(kana)) {
    sendJson(res, 400, { error: "読みがカナではありません" });
    return;
  }

  let words;
  try {
    words = readWords();
  } catch {
    sendJson(res, 500, { error: "words.json の読み込みに失敗しました" });
    return;
  }

  const entry = { surface, kana, accent };
  const existing = words.findIndex((w) => w.surface === surface);
  if (existing >= 0) {
    words[existing] = entry;
  } else {
    words.push(entry);
  }

  try {
    fs.writeFileSync(WORDS_PATH, JSON.stringify({ words }, null, 2) + "\n");
  } catch {
    sendJson(res, 500, { error: "保存に失敗しました" });
    return;
  }

  const sync = { voicevox: null, coeiroink: null, hookCopy: false };
  try {
    sync.voicevox = await syncVoicevox(words);
  } catch {}
  try {
    sync.coeiroink = await pushCoeiroink(words);
  } catch {}
  try {
    copyToHook();
    sync.hookCopy = true;
  } catch {}

  sendJson(res, 200, { added: existing < 0, updated: existing >= 0, sync });
}

async function handlePostTest(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    sendJson(res, 400, { error: "invalid json" });
    return;
  }
  const text = body && body.text;
  if (typeof text !== "string" || text.length === 0) {
    sendJson(res, 400, { error: "text is required" });
    return;
  }

  try {
    const params = new URLSearchParams({ text, speaker: "1" });
    const qRes = await fetch(`${VOICEVOX_BASE}/audio_query?${params}`, { method: "POST" });
    if (!qRes.ok) throw new Error(`audio_query failed: ${qRes.status}`);
    const audioQuery = await qRes.json();

    const sRes = await fetch(`${VOICEVOX_BASE}/synthesis?speaker=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(audioQuery),
    });
    if (!sRes.ok) throw new Error(`synthesis failed: ${sRes.status}`);

    res.writeHead(200, { "Content-Type": "audio/wav" });
    const buffer = Buffer.from(await sRes.arrayBuffer());
    res.end(buffer);
  } catch (e) {
    sendJson(res, 502, { error: "VOICEVOX is not running" });
  }
}

function serveUi(res) {
  fs.readFile(UI_PATH, "utf8", (err, content) => {
    if (err) {
      sendJson(res, 500, { error: "failed to load ui" });
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(content);
  });
}

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

// Host ヘッダ検証（CSRF / DNS リバインディング対策）。
// ブラウザが付与する Host ヘッダが自分自身宛てでない場合は拒否する。
function isAllowedHost(req) {
  return ALLOWED_HOSTS.has(req.headers.host);
}

const server = http.createServer((req, res) => {
  if (!isAllowedHost(req)) {
    sendJson(res, 403, { error: "forbidden host" });
    return;
  }

  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  Promise.resolve()
    .then(() => {
      if (req.method === "GET" && pathname === "/") return serveUi(res);
      if (req.method === "GET" && pathname === "/api/words") return handleGetWords(res);
      if (req.method === "PUT" && pathname === "/api/words") return handlePutWords(req, res);
      if (req.method === "POST" && pathname === "/api/words") return handlePostWord(req, res);
      if (req.method === "POST" && pathname === "/api/test") return handlePostTest(req, res);
      sendJson(res, 404, { error: "not found" });
    })
    .catch(() => {
      sendJson(res, 500, { error: "internal error" });
    });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    const url = `http://${HOST}:${PORT}`;
    console.log(`辞書編集 GUI サーバーを起動: ${url}`);
    exec(`open ${url}`, () => {
      // ブラウザを開けなくても URL をコンソールに出しているので致命的ではない
    });
  });
}

module.exports = server;
