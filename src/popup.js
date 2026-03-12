import { DEFAULT_SETTINGS, formatInt, formatUsd, estimateCost, byId, setText } from "./shared.js";

async function loadUsage() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_USAGE_STATS" });
    const stats = response?.apiStats || {};
    const promptTokens = Number(stats.promptTokens || 0);
    const completionTokens = Number(stats.completionTokens || 0);

    setText("estSpend", formatUsd(estimateCost(promptTokens, completionTokens)));
    setText("usageLine", `${formatInt(stats.totalTitles)} titles checked | ${formatInt(stats.llmCalls)} LLM calls`);
  } catch {
    setText("estSpend", "$0.0000");
    setText("usageLine", "Usage unavailable");
  }
}

async function loadModelLabel() {
  try {
    const items = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    setText("spendLabel", `Estimated Spend | ${items.model || DEFAULT_SETTINGS.model}`);
  } catch {
    setText("spendLabel", `Estimated Spend | ${DEFAULT_SETTINGS.model}`);
  }
}

async function refresh() {
  await Promise.all([loadUsage(), loadModelLabel()]);
}

function init() {
  byId("refreshBtn")?.addEventListener("click", refresh);
  byId("openOptionsBtn")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  refresh();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
