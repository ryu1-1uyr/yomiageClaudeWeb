function getBrowserVoices() {
  return new Promise((resolve) => {
    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) return resolve(voices);
    speechSynthesis.addEventListener(
      "voiceschanged",
      () => resolve(speechSynthesis.getVoices()),
      { once: true }
    );
  });
}

const ENGINES = [
  {
    name: "VOICEVOX",
    async fetchVoices() {
      const res = await fetch("http://localhost:50021/speakers");
      if (!res.ok) throw new Error(`speakers failed: ${res.status}`);
      const speakers = await res.json();
      return speakers.flatMap((sp) =>
        sp.styles
          .filter((st) => !st.type || st.type === "talk")
          .map((st) => ({
            label: `${sp.name}（${st.name}）`,
            voice: { engine: "voicevox", styleId: st.id },
          }))
      );
    },
  },
  {
    name: "COEIROINK",
    async fetchVoices() {
      const res = await fetch("http://localhost:50032/v1/speakers");
      if (!res.ok) throw new Error(`speakers failed: ${res.status}`);
      const speakers = await res.json();
      return speakers.flatMap((sp) =>
        sp.styles.map((st) => ({
          label: `${sp.speakerName}（${st.styleName}）`,
          voice: {
            engine: "coeiroink",
            speakerUuid: sp.speakerUuid,
            styleId: st.styleId,
          },
        }))
      );
    },
  },
  {
    name: "ブラウザ標準",
    async fetchVoices() {
      const voices = await getBrowserVoices();
      return voices.map((v) => ({
        label: `${v.name} (${v.lang})`,
        voice: { engine: "browser", voiceName: v.name },
      }));
    },
  },
];

const checkbox = document.getElementById("enabled");
const stopButton = document.getElementById("stop");
const readLastButton = document.getElementById("read-last");
const select = document.getElementById("voice-select");
const notesEl = document.getElementById("engine-notes");
const volumeSlider = document.getElementById("volume");
const volumeValue = document.getElementById("volume-value");

// select の value（voiceKey）→ voice オブジェクトの引き当て用
const voiceMap = new Map();

function voiceKey(v) {
  if (v.engine === "browser") return `browser:${v.voiceName}`;
  return v.engine === "coeiroink"
    ? `coeiroink:${v.speakerUuid}:${v.styleId}`
    : `voicevox:${v.styleId}`;
}

async function init() {
  const { enabled, speaker, voice, volume } = await chrome.storage.local.get({
    enabled: true,
    speaker: 1,
    voice: null,
    volume: 100,
  });
  checkbox.checked = enabled;
  volumeSlider.value = volume;
  volumeValue.textContent = `${volume}%`;
  const current = voice ?? { engine: "voicevox", styleId: speaker };
  const currentKey = voiceKey(current);

  const results = await Promise.allSettled(
    ENGINES.map((engine) => engine.fetchVoices())
  );
  const notes = [];
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      notes.push(`${ENGINES[i].name}: 未起動`);
      return;
    }
    const group = document.createElement("optgroup");
    group.label = ENGINES[i].name;
    for (const { label, voice: v } of result.value) {
      const opt = document.createElement("option");
      opt.value = voiceKey(v);
      opt.textContent = label;
      voiceMap.set(opt.value, v);
      group.append(opt);
    }
    select.append(group);
  });

  // 保存中の話者がリストにない（そのエンジンが未起動等）場合は、仮の項目を出して選択状態を保つ
  if (!voiceMap.has(currentKey)) {
    const opt = document.createElement("option");
    opt.value = currentKey;
    opt.textContent = "（現在の設定・エンジン未起動）";
    voiceMap.set(currentKey, current);
    select.prepend(opt);
  }
  select.value = currentKey;
  notesEl.textContent = notes.join(" / ");
}

select.addEventListener("change", () => {
  const v = voiceMap.get(select.value);
  if (v) chrome.storage.local.set({ voice: v });
});

volumeSlider.addEventListener("input", () => {
  const v = Number(volumeSlider.value);
  volumeValue.textContent = `${v}%`;
  chrome.storage.local.set({ volume: v });
});

checkbox.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: checkbox.checked });
});

readLastButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "READ_LAST" });
});

stopButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "STOP" });
});

const dictSection = document.getElementById("dict-section");
const dictSurface = document.getElementById("dict-surface");
const dictKana = document.getElementById("dict-kana");
const dictRegister = document.getElementById("dict-register");
const dictStatus = document.getElementById("dict-status");

fetch("http://127.0.0.1:50090/api/words")
  .then((r) => {
    if (r.ok) dictSection.classList.add("visible");
  })
  .catch(() => {});

dictRegister.addEventListener("click", async () => {
  const surface = dictSurface.value.trim();
  const kana = dictKana.value.trim();
  if (!surface || !kana) {
    dictStatus.textContent = "表層形と読みを入力してください";
    dictStatus.className = "error";
    return;
  }
  dictRegister.disabled = true;
  try {
    const res = await fetch("http://127.0.0.1:50090/api/words", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ surface, kana }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "登録に失敗しました");
    }
    const data = await res.json();
    dictStatus.textContent = data.updated ? "更新しました" : "登録しました";
    dictStatus.className = "ok";
    dictSurface.value = "";
    dictKana.value = "";
  } catch (e) {
    dictStatus.textContent =
      e.message === "Failed to fetch" ? "辞書サーバー未起動" : e.message;
    dictStatus.className = "error";
  } finally {
    dictRegister.disabled = false;
  }
});

init();
