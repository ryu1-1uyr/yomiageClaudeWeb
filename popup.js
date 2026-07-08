const checkbox = document.getElementById("enabled");
const stopButton = document.getElementById("stop");

chrome.storage.local.get({ enabled: true }).then(({ enabled }) => {
  checkbox.checked = enabled;
});

checkbox.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: checkbox.checked });
});

stopButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "STOP" });
});
