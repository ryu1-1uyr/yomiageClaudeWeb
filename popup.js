const COEIROINK_BASE = "http://localhost:50032";

// VOICEVOX 側は2キャラ固定のプロトタイプ。COEIROINK 側は起動中のエンジンから動的に取得する
const VOICEVOX_VOICES = [
  { label: "ずんだもん（あまあま）", voice: { engine: "voicevox", styleId: 1 } },
  { label: "四国めたん（ノーマル）", voice: { engine: "voicevox", styleId: 2 } },
];

const checkbox = document.getElementById("enabled");
const stopButton = document.getElementById("stop");
const readLastButton = document.getElementById("read-last");
const voicevoxList = document.getElementById("voicevox-voices");
const coeiroinkList = document.getElementById("coeiroink-voices");

function voiceKey(v) {
  return v.engine === "coeiroink"
    ? `coeiroink:${v.speakerUuid}:${v.styleId}`
    : `voicevox:${v.styleId}`;
}

function addVoiceRadio(container, label, v, selectedKey) {
  const el = document.createElement("label");
  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "voice";
  radio.checked = voiceKey(v) === selectedKey;
  radio.addEventListener("change", () => {
    if (radio.checked) chrome.storage.local.set({ voice: v });
  });
  el.append(radio, label);
  container.append(el);
}

async function init() {
  const { enabled, speaker, voice } = await chrome.storage.local.get({
    enabled: true,
    speaker: 1, // 旧形式からの引き継ぎ用
    voice: null,
  });
  checkbox.checked = enabled;
  const selectedKey = voiceKey(voice ?? { engine: "voicevox", styleId: speaker });

  for (const { label, voice: v } of VOICEVOX_VOICES) {
    addVoiceRadio(voicevoxList, label, v, selectedKey);
  }

  try {
    const res = await fetch(`${COEIROINK_BASE}/v1/speakers`);
    if (!res.ok) throw new Error(`speakers failed: ${res.status}`);
    const speakers = await res.json();
    coeiroinkList.textContent = "";
    for (const sp of speakers) {
      for (const style of sp.styles) {
        addVoiceRadio(
          coeiroinkList,
          `${sp.speakerName}（${style.styleName}）`,
          {
            engine: "coeiroink",
            speakerUuid: sp.speakerUuid,
            styleId: style.styleId,
          },
          selectedKey
        );
      }
    }
    if (speakers.length === 0) {
      coeiroinkList.innerHTML = '<span class="engine-note">キャラ未インストール</span>';
    }
  } catch {
    coeiroinkList.innerHTML = '<span class="engine-note">未起動（50032 に接続できない）</span>';
  }
}

checkbox.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: checkbox.checked });
});

readLastButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "READ_LAST" });
});

stopButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "STOP" });
});

init();
