// offscreen document: VOICEVOX 合成・FIFO キュー・先読みパイプライン・Audio 再生の実体。
// バイナリ（wav）と再生状態はすべてこのコンテキストに閉じる（service worker には持たせない）。

const VOICEVOX_BASE = "http://localhost:50021";
const COEIROINK_BASE = "http://localhost:50032";
const DEFAULT_VOICE = { engine: "voicevox", styleId: 1 };

// voice: { engine: "voicevox", styleId } | { engine: "coeiroink", speakerUuid, styleId }
// 注意: offscreen document では chrome.storage 等の拡張 API は使えない（chrome.runtime のみ）。
// 話者は background が READ への同梱と SET_VOICE メッセージで届けてくる。
let voice = DEFAULT_VOICE;
let volume = 1.0;

const queue = [];
let playing = false;
let currentAudio = null;
let prefetched = null; // { text, promise }
let generation = 0; // STOP 世代カウンタ。古い再生ループを await 明けに止めるために使う

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== "offscreen") return;
  if (msg.type === "READ" && Array.isArray(msg.chunks)) {
    if (msg.voice) voice = msg.voice;
    if (msg.volume != null) volume = msg.volume;
    queue.push(...msg.chunks);
    if (!playing) playLoop();
  } else if (msg.type === "SET_VOLUME") {
    volume = msg.volume;
    if (currentAudio) currentAudio.volume = volume;
  } else if (msg.type === "SET_VOICE") {
    voice = msg.voice;
    prefetched = null; // 旧話者で先読み済みの wav は捨てて次チャンクから新話者にする
  } else if (msg.type === "STOP") {
    stop();
  }
});

function stop() {
  generation++;
  queue.length = 0;
  prefetched = null;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  speechSynthesis.cancel();
}

async function synthesize(text) {
  const v = voice; // 合成中に話者が切り替わっても1チャンク内では同じ声になるよう固定する
  return v.engine === "coeiroink"
    ? synthesizeCoeiroink(text, v)
    : synthesizeVoicevox(text, v);
}

async function synthesizeVoicevox(text, v) {
  const params = new URLSearchParams({ text, speaker: String(v.styleId) });
  const queryRes = await fetch(`${VOICEVOX_BASE}/audio_query?${params}`, {
    method: "POST",
  });
  if (!queryRes.ok) throw new Error(`audio_query failed: ${queryRes.status}`);
  const audioQuery = await queryRes.json();

  const synthRes = await fetch(`${VOICEVOX_BASE}/synthesis?speaker=${v.styleId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(audioQuery),
  });
  if (!synthRes.ok) throw new Error(`synthesis failed: ${synthRes.status}`);
  return synthRes.blob();
}

async function synthesizeCoeiroink(text, v) {
  // COEIROINK v2 の独自 API。/v1/predict は1リクエストで wav が返る
  const res = await fetch(`${COEIROINK_BASE}/v1/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      speakerUuid: v.speakerUuid,
      styleId: v.styleId,
      text,
      speedScale: 1.0,
    }),
  });
  if (!res.ok) throw new Error(`coeiroink predict failed: ${res.status}`);
  return res.blob();
}

function speakBrowser(text) {
  return new Promise((resolve) => {
    const utt = new SpeechSynthesisUtterance(text);
    const v = voice;
    if (v.voiceName) {
      const found = speechSynthesis.getVoices().find((x) => x.name === v.voiceName);
      if (found) utt.voice = found;
    }
    utt.volume = volume;
    utt.addEventListener("end", resolve, { once: true });
    utt.addEventListener("error", resolve, { once: true });
    speechSynthesis.speak(utt);
  });
}

function play(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = volume;
    currentAudio = audio;
    const finish = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.addEventListener("ended", finish, { once: true });
    audio.addEventListener("error", finish, { once: true });
    // STOP の pause でも Promise を解決させる（ended 直前の pause と重複しても resolve は冪等）
    audio.addEventListener("pause", finish, { once: true });
    audio.play().catch(finish);
  });
}

async function playLoop() {
  playing = true;
  const myGen = generation;
  while (queue.length > 0 && myGen === generation) {
    const text = queue.shift();

    if (voice.engine === "browser") {
      try {
        await speakBrowser(text);
      } catch (e) {
        console.error("[VV] ブラウザ読み上げに失敗:", text, e);
      }
      continue;
    }

    let blob;
    try {
      if (prefetched && prefetched.text === text) {
        const p = prefetched.promise;
        prefetched = null;
        blob = await p;
      } else {
        blob = await synthesize(text);
      }
    } catch (e) {
      console.error("[VV] 合成に失敗（このチャンクはスキップ）:", text, e);
      continue;
    }
    if (myGen !== generation) break;

    if (queue.length > 0 && !prefetched) {
      const nextText = queue[0];
      const promise = synthesize(nextText);
      promise.catch(() => {});
      prefetched = { text: nextText, promise };
    }

    await play(blob);
  }
  playing = false;
  // STOP 直後に届いた READ の取りこぼし防止（古いループが生きている間は新ループが起動しないため）
  if (queue.length > 0) playLoop();
}
