// 英単語読み辞書（words.json）を VOICEVOX / COEIROINK / claude-code-hook に同期する。
// 実行: node tools/sync-dict.js
//
// - VOICEVOX: 既存の /user_dict と差分を取り、未登録の語は POST、
//   pronunciation か accent_type が異なる語は PUT で更新する（差分・冪等。削除はしない）
// - COEIROINK: ユーザー辞書がセッション限りで消えるため、毎回 /v1/set_dictionary で全置換する
// - claude-code-hook 側にも words.json を配布する（hook は同じ辞書データを別リポジトリで参照するため）

const fs = require("fs");
const path = require("path");
const os = require("os");

// Node の fetch は localhost を IPv6 優先で解決してエンジンに繋がらないため 127.0.0.1 を使う
const VOICEVOX_BASE = "http://127.0.0.1:50021";
const COEIROINK_BASE = "http://127.0.0.1:50032";

const WORDS_FILE = path.join(__dirname, "..", "words.json");
const HOOK_WORDS_FILE = path.join(
  os.homedir(),
  "claude-code-hook",
  "words.json"
);
const HOOK_DICT_LIB = path.join(
  os.homedir(),
  "claude-code-hook",
  "lib",
  "dict.js"
);

const { toFullWidth, buildDictionaryWords } = require(HOOK_DICT_LIB);

// VOICEVOX の user_dict に1語を新規登録する
async function registerVoicevoxWord(surface, pronunciation, accentType) {
  const params = new URLSearchParams({
    surface,
    pronunciation,
    accent_type: String(accentType),
    word_type: "PROPER_NOUN",
  });
  const res = await fetch(`${VOICEVOX_BASE}/user_dict_word?${params}`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(
      `user_dict_word POST failed (${surface}): ${
        res.status
      } ${await res.text()}`
    );
  }
}

// VOICEVOX の user_dict の既存語を更新する
async function updateVoicevoxWord(uuid, surface, pronunciation, accentType) {
  const params = new URLSearchParams({
    surface,
    pronunciation,
    accent_type: String(accentType),
    word_type: "PROPER_NOUN",
  });
  const res = await fetch(`${VOICEVOX_BASE}/user_dict_word/${uuid}?${params}`, {
    method: "PUT",
  });
  if (!res.ok) {
    throw new Error(
      `user_dict_word PUT failed (${surface}): ${
        res.status
      } ${await res.text()}`
    );
  }
}

// words.json を VOICEVOX の user_dict と差分同期する
async function syncVoicevox(words) {
  const res = await fetch(`${VOICEVOX_BASE}/user_dict`);
  if (!res.ok) throw new Error(`user_dict GET failed: ${res.status}`);
  const existing = await res.json(); // { uuid: { surface, pronunciation, accent_type, ... } }

  // VOICEVOX は登録時に半角の surface を全角化して保持するため、比較も全角化して行う
  const bySurface = new Map();
  for (const [uuid, entry] of Object.entries(existing)) {
    bySurface.set(entry.surface, { uuid, entry });
  }

  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const word of words) {
    const accentType = word.accent ?? 0;
    const match = bySurface.get(toFullWidth(word.surface));
    if (!match) {
      await registerVoicevoxWord(word.surface, word.kana, accentType);
      added++;
    } else if (
      match.entry.pronunciation !== word.kana ||
      match.entry.accent_type !== accentType
    ) {
      await updateVoicevoxWord(match.uuid, word.surface, word.kana, accentType);
      updated++;
    } else {
      unchanged++;
    }
  }
  return { added, updated, unchanged };
}

// words.json 全体を COEIROINK に全置換でプッシュする。未起動なら null を返す
async function pushCoeiroink(words) {
  const dictionaryWords = buildDictionaryWords(words);
  let res;
  try {
    res = await fetch(`${COEIROINK_BASE}/v1/set_dictionary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dictionaryWords }),
    });
    await console.log("レスポンス", res);
  } catch (e) {
    console.log(`COEIROINK: エンジン未起動のためスキップ（${e.message}）`);
    return null;
  }
  if (!res.ok) {
    console.log(`COEIROINK: プッシュ失敗（${res.status} ${await res.text()}）`);
    return null;
  }
  return dictionaryWords.length;
}

// words.json を claude-code-hook 側にコピーする
function copyToHook() {
  fs.mkdirSync(path.dirname(HOOK_WORDS_FILE), { recursive: true });
  fs.copyFileSync(WORDS_FILE, HOOK_WORDS_FILE);
}

async function main() {
  const { words } = JSON.parse(fs.readFileSync(WORDS_FILE, "utf8"));

  const vv = await syncVoicevox(words);
  console.log(
    `VOICEVOX: 追加 ${vv.added} / 更新 ${vv.updated} / 変更なし ${vv.unchanged}`
  );

  const pushed = await pushCoeiroink(words);
  if (pushed != null) console.log(`COEIROINK: プッシュ ${pushed} 語`);

  copyToHook();
  console.log(`コピー: 完了（${HOOK_WORDS_FILE}）`);
}

main().catch((e) => {
  console.error("同期に失敗しました:", e);
  process.exit(1);
});
