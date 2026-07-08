// offscreen document: VOICEVOX 合成・FIFO キュー・先読みパイプライン・Audio 再生の実体。
// バイナリ（wav）と再生状態はすべてこのコンテキストに閉じる（service worker には持たせない）。

const VOICEVOX_BASE = "http://localhost:50021";
const SPEAKER = 1;

const queue = [];
let playing = false;
let currentAudio = null;
let prefetched = null; // { text, promise }
let generation = 0; // STOP 世代カウンタ。古い再生ループを await 明けに止めるために使う

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== "offscreen") return;
  if (msg.type === "READ" && Array.isArray(msg.chunks)) {
    queue.push(...msg.chunks);
    if (!playing) playLoop();
  } else if (msg.type === "STOP") {
    stop();
  }
});

function stop() {
  generation++;
  queue.length = 0;
  prefetched = null;
  if (currentAudio) {
    currentAudio.pause(); // pause イベントで play() の Promise が解決してループが抜ける
    currentAudio = null;
  }
}

async function synthesize(text) {
  const params = new URLSearchParams({ text, speaker: String(SPEAKER) });
  const queryRes = await fetch(`${VOICEVOX_BASE}/audio_query?${params}`, {
    method: "POST",
  });
  if (!queryRes.ok) throw new Error(`audio_query failed: ${queryRes.status}`);
  const audioQuery = await queryRes.json();

  const synthRes = await fetch(`${VOICEVOX_BASE}/synthesis?speaker=${SPEAKER}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(audioQuery),
  });
  if (!synthRes.ok) throw new Error(`synthesis failed: ${synthRes.status}`);
  return synthRes.blob();
}

function play(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
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

    // 次チャンクの合成を先行実行（常に1件だけ）。再生の切れ目の無音を防ぐ
    if (queue.length > 0 && !prefetched) {
      const nextText = queue[0];
      const promise = synthesize(nextText);
      promise.catch(() => {}); // unhandled rejection 防止。失敗は本番取得時に再検出される
      prefetched = { text: nextText, promise };
    }

    await play(blob);
  }
  playing = false;
  // STOP 直後に届いた READ の取りこぼし防止（古いループが生きている間は新ループが起動しないため）
  if (queue.length > 0) playLoop();
}
