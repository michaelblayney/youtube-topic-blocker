const DEFAULT_SETTINGS = {
  mode: "block_only",
  blockedTopics: [],
  model: "gpt-4o-mini",
  openAiApiKey: ""
};

// Current official pricing used for estimate (USD per 1M tokens).
const GPT_4O_MINI_PRICING = {
  inputPerMillion: 0.15,
  outputPerMillion: 0.6
};
const ESTIMATE_ADJUSTMENT_FACTOR = 0.5;

function byId(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const el = byId(id);
  if (!el) return false;
  el.textContent = text || "";
  return true;
}

function parseTopics(raw) {
  return String(raw || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function formatInt(n) {
  return Number(n || 0).toLocaleString();
}

function formatUsd(n) {
  return `$${Number(n || 0).toFixed(4)}`;
}

function setStatus(text, timeoutMs = 1800) {
  if (!setText("status", text)) return;
  if (timeoutMs > 0) {
    setTimeout(() => {
      setText("status", "");
    }, timeoutMs);
  }
}

function setRuntimeStatus(text) {
  setText("runtimeStatus", text);
}

function setUsageSummary(text) {
  setText("usageSummary", text);
}

function estimateCostFromTokens(promptTokens, completionTokens) {
  const inCost = (Number(promptTokens || 0) / 1_000_000) * GPT_4O_MINI_PRICING.inputPerMillion;
  const outCost = (Number(completionTokens || 0) / 1_000_000) * GPT_4O_MINI_PRICING.outputPerMillion;
  return (inCost + outCost) * ESTIMATE_ADJUSTMENT_FACTOR;
}

async function loadRuntimeStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_RUNTIME_STATUS" });
    if (!response?.ok) {
      setRuntimeStatus("");
      return;
    }

    if (response.disabledUntil && response.now < response.disabledUntil) {
      const minutes = Math.max(1, Math.round((response.disabledUntil - response.now) / 60000));
      setRuntimeStatus(`OpenAI unavailable due to quota limits. Titles remain hidden (${minutes} min).`);
      return;
    }

    if (response.rateLimitUntil && response.now < response.rateLimitUntil) {
      const seconds = Math.max(1, Math.round((response.rateLimitUntil - response.now) / 1000));
      setRuntimeStatus(`OpenAI cooling down due to rate limits. Titles remain hidden (${seconds}s).`);
      return;
    }

    setRuntimeStatus("");
  } catch (_err) {
    setRuntimeStatus("");
  }
}

async function loadUsageStats() {
  try {
    const apiResponse = await chrome.runtime.sendMessage({ type: "GET_USAGE_STATS" });
    const stats = apiResponse?.apiStats || {};

    const totalTitles = Number(stats.totalTitles || 0);
    const llmCalls = Number(stats.llmCalls || 0);
    const llmTitles = Number(stats.llmTitles || 0);
    const blockedMatches = Number(stats.blockedMatches || 0);
    const unknownTitles = Number(stats.unknownTitles || 0);
    const cacheHits = Number(stats.cacheHits || 0);
    const promptTokens = Number(stats.promptTokens || 0);
    const completionTokens = Number(stats.completionTokens || 0);
    const estCost = estimateCostFromTokens(promptTokens, completionTokens);

    const summary = [
      `Titles checked: ${formatInt(totalTitles)} | Blocked: ${formatInt(blockedMatches)} | Unknown: ${formatInt(unknownTitles)}`,
      `LLM batch calls: ${formatInt(llmCalls)} | Titles checked by LLM: ${formatInt(llmTitles)} | Cache hits: ${formatInt(cacheHits)}`,
      `Prompt tokens: ${formatInt(promptTokens)} | Completion tokens: ${formatInt(completionTokens)}`,
      `Estimated spend (adjusted): ${formatUsd(estCost)}`
    ].join("\n");

    setUsageSummary(summary);
  } catch (_err) {
    setUsageSummary("Usage unavailable right now.");
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

    const topics = Array.isArray(settings.blockedTopics)
      ? settings.blockedTopics
      : parseTopics(settings.blockedTopics);

    topicsInput.value = topics.join(", ");
    saveBtn.textContent = settings.openAiApiKey ? "Save" : "Save (No API key: titles stay hidden)";

    loadRuntimeStatus();
    loadUsageStats();
  });
}

function save() {
  const keyInput = byId("openAiApiKey");
  const topicsInput = byId("blockedTopics");
  if (!keyInput || !topicsInput) return;

  const next = {
    mode: "block_only",
    openAiApiKey: keyInput.value.trim(),
    model: DEFAULT_SETTINGS.model,
    blockedTopics: parseTopics(topicsInput.value)
  };

  chrome.storage.sync.set(next, async () => {
    try {
      await chrome.runtime.sendMessage({ type: "RESET_RUNTIME_LOCKS" });
    } catch (_err) {
    }
    setStatus("Saved");
    load();
  });
}

async function resetUsage() {
  try {
    await chrome.runtime.sendMessage({ type: "RESET_USAGE_STATS" });
    setStatus("Usage reset");
    loadUsageStats();
  } catch (_err) {
    setStatus("Failed to reset usage", 2500);
  }
}

function init() {
  const saveBtn = byId("saveBtn");
  const refreshBtn = byId("refreshStatsBtn");
  const resetBtn = byId("resetStatsBtn");
  if (!saveBtn || !refreshBtn || !resetBtn) return;

  saveBtn.addEventListener("click", save);
  refreshBtn.addEventListener("click", loadUsageStats);
  resetBtn.addEventListener("click", resetUsage);
  load();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
