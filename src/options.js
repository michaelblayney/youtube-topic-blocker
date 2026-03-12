import {
  DEFAULT_SETTINGS, parseTopics, formatInt, formatUsd,
  estimateCost, byId, setText
} from "./shared.js";

function setStatus(text, timeoutMs = 1800) {
  if (!setText("status", text)) return;
  if (timeoutMs > 0) setTimeout(() => setText("status", ""), timeoutMs);
}

async function loadRuntimeStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_RUNTIME_STATUS" });
    if (!response?.ok) {
      setText("runtimeStatus", "");
      return;
    }

    if (response.disabledUntil && response.now < response.disabledUntil) {
      const minutes = Math.max(1, Math.round((response.disabledUntil - response.now) / 60000));
      setText("runtimeStatus", `OpenAI unavailable due to quota limits. Titles remain hidden (${minutes} min).`);
      return;
    }

    if (response.rateLimitUntil && response.now < response.rateLimitUntil) {
      const seconds = Math.max(1, Math.round((response.rateLimitUntil - response.now) / 1000));
      setText("runtimeStatus", `OpenAI cooling down due to rate limits. Titles remain hidden (${seconds}s).`);
      return;
    }

    setText("runtimeStatus", "");
  } catch {
    setText("runtimeStatus", "");
  }
}

async function loadUsageStats() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_USAGE_STATS" });
    const stats = response?.apiStats || {};
    const promptTokens = Number(stats.promptTokens || 0);
    const completionTokens = Number(stats.completionTokens || 0);

    const summary = [
      `Titles checked: ${formatInt(stats.totalTitles)} | Blocked: ${formatInt(stats.blockedMatches)} | Unknown: ${formatInt(stats.unknownTitles)}`,
      `LLM calls: ${formatInt(stats.llmCalls)} | LLM titles: ${formatInt(stats.llmTitles)} | Cache hits: ${formatInt(stats.cacheHits)}`,
      `Prompt tokens: ${formatInt(promptTokens)} | Completion tokens: ${formatInt(completionTokens)}`,
      `Estimated spend: ${formatUsd(estimateCost(promptTokens, completionTokens))}`
    ].join("\n");

    setText("usageSummary", summary);
  } catch {
    setText("usageSummary", "Usage unavailable right now.");
  }
}

function load() {
  chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
    const keyInput = byId("openAiApiKey");
    const modelInput = byId("model");
    const topicsInput = byId("blockedTopics");
    const saveBtn = byId("saveBtn");
    if (!keyInput || !modelInput || !topicsInput || !saveBtn) return;

    keyInput.value = settings.openAiApiKey || "";
    modelInput.value = DEFAULT_SETTINGS.model;
    topicsInput.value = parseTopics(settings.blockedTopics).join(", ");
    saveBtn.textContent = settings.openAiApiKey ? "Save" : "Save (No API key: titles stay hidden)";

    loadRuntimeStatus();
    loadUsageStats();
  });
}

function save() {
  const keyInput = byId("openAiApiKey");
  const topicsInput = byId("blockedTopics");
  if (!keyInput || !topicsInput) return;

  chrome.storage.sync.set({
    openAiApiKey: keyInput.value.trim(),
    model: DEFAULT_SETTINGS.model,
    blockedTopics: parseTopics(topicsInput.value)
  }, async () => {
    try { await chrome.runtime.sendMessage({ type: "RESET_RUNTIME_LOCKS" }); } catch {}
    setStatus("Saved");
    load();
  });
}

async function resetUsage() {
  try {
    await chrome.runtime.sendMessage({ type: "RESET_USAGE_STATS" });
    setStatus("Usage reset");
    loadUsageStats();
  } catch {
    setStatus("Failed to reset usage", 2500);
  }
}

function init() {
  byId("saveBtn")?.addEventListener("click", save);
  byId("refreshStatsBtn")?.addEventListener("click", loadUsageStats);
  byId("resetStatsBtn")?.addEventListener("click", resetUsage);
  load();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
