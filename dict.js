// COEIROINK の辞書登録用データ変換ロジック。words.json（英単語読み辞書の正本）の
// 1エントリを COEIROINK の /v1/set_dictionary が受け取る dictionaryWords 形式に展開する。
// COEIROINK は表層形が全角でないと入力にマッチしないため、半角・小文字・大文字の
// 3バリアントをそれぞれ全角化して登録する。offscreen document 専用のグローバルスクリプト
// として読み込む（offscreen.js より前に評価される）。hook 側 lib/dict.js と同等の実装。

// 小書き文字は直前の文字と合成して1モーラになるためカウントしない
const SMALL_KANA = new Set(["ャ", "ュ", "ョ", "ァ", "ィ", "ゥ", "ェ", "ォ", "ヮ"]);

// カタカナの読みからモーラ数を数える（ー・ッ・ンは各1モーラ、小書き文字は直前と合成）
function countMoras(kana) {
  let count = 0;
  for (const ch of kana) {
    if (SMALL_KANA.has(ch)) continue;
    count++;
  }
  return count;
}

// ASCII の記号・英数字（0x21-0x7E）を全角に変換する
function toFullWidth(str) {
  return str.replace(/[\x21-\x7E]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
}

// words.json の1語を COEIROINK の dictionaryWords 複数エントリに展開する
function wordToDictionaryEntries(word) {
  const variants = Array.from(
    new Set([word.surface, word.surface.toLowerCase(), word.surface.toUpperCase()])
  );
  const numMoras = countMoras(word.kana);
  return variants.map((surface) => ({
    word: toFullWidth(surface),
    yomi: word.kana,
    accent: word.accent ?? 0,
    numMoras,
  }));
}

// words.json の words 配列全体を dictionaryWords（set_dictionary のボディ）に変換する
function buildDictionaryWords(words) {
  return words.flatMap(wordToDictionaryEntries);
}
