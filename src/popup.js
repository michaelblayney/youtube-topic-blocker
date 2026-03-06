const GPT_4O_MINI_PRICING = {
  inputPerMillion: 0.15,
  outputPerMillion: 0.6
};
const ESTIMATE_ADJUSTMENT_FACTOR = 0.5;

function byId(id) {
  return document.getElementById(id);
}

function formatInt(n) {
  return Number(n || 0).toLocaleString();
}

function formatUsd(n) {
  return `$${Number(n || 0).toFixed(4)}`;
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
      byId("runtimeStatus").textContent = "";
      return;
    }

    if (response.disabledUntil && response.now < response.disabledUntil) {
      const minutes = Math.max(1, Math.round((response.disabledUntil - response.now) / 60000));
      byId("runtimeStatus").textContent = `Quota cooldown (${minutes} min)`;
      return;
    }

    if (response.rateLimitUntil && response.now < response.rateLimitUntil) {
      const seconds = Math.max(1, Math.round((response.rateLimitUntil - response.now) / 1000));
      byId("runtimeStatus").textContent = `Rate limit cooldown (${seconds}s)`;
      return;
    }

    byId("runtimeStatus").textContent = "";
  } catch (_err) {
    byId("runtimeStatus").textContent = "";
  }
}

async function loadUsage() {
  try {
    const apiResponse = await chrome.runtime.sendMessage({ type: "GET_USAGE_STATS" });
    const stats = apiResponse?.apiStats || {};

    const totalTitles = Number(stats.totalTitles || 0);
    const llmCalls = Number(stats.llmCalls || 0);
    const promptTokens = Number(stats.promptTokens || 0);
    const completionTokens = Number(stats.completionTokens || 0);

    const estCost = estimateCostFromTokens(promptTokens, completionTokens);
    byId("estSpend").textContent = formatUsd(estCost);
    byId("usageLine").textContent = `${formatInt(totalTitles)} titles | ${formatInt(llmCalls)} LLM calls`;
  } catch (_err) {
    byId("estSpend").textContent = "$0.0000";
    byId("usageLine").textContent = "Usage unavailable";
  }
}

async function refresh() {
  await Promise.all([loadRuntimeStatus(), loadUsage()]);
}

byId("refreshBtn").addEventListener("click", refresh);
refresh();