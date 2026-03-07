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
  const el = byId("status");
  el.textContent = text;
  if (timeoutMs > 0) {
    setTimeout(() => {
      el.textContent = "";
    }, timeoutMs);
  }
}

function setRuntimeStatus(text) {
  const el = byId("runtimeStatus");
  el.textContent = text || "";
}

function setUsageSummary(text) {
  byId("usageSummary").textContent = text || "";
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
    byId("openAiApiKey").value = settings.openAiApiKey || "";
    byId("model").value = DEFAULT_SETTINGS.model;

    const topics = Array.isArray(settings.blockedTopics)
      ? settings.blockedTopics
      : parseTopics(settings.blockedTopics);

    byId("blockedTopics").value = topics.join(", ");
    byId("saveBtn").textContent = settings.openAiApiKey ? "Save" : "Save (No API key: titles stay hidden)";

    loadRuntimeStatus();
    loadUsageStats();
  });
}

function save() {
  const next = {
    mode: "block_only",
    openAiApiKey: byId("openAiApiKey").value.trim(),
    model: DEFAULT_SETTINGS.model,
    blockedTopics: parseTopics(byId("blockedTopics").value)
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

byId("saveBtn").addEventListener("click", save);
byId("refreshStatsBtn").addEventListener("click", loadUsageStats);
byId("resetStatsBtn").addEventListener("click", resetUsage);
load();
