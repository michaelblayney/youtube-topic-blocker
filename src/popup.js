const GPT_4O_MINI_PRICING = {
  inputPerMillion: 0.15,
  outputPerMillion: 0.6
};
const ESTIMATE_ADJUSTMENT_FACTOR = 0.5;
const DEFAULT_MODEL = "gpt-4o-mini";

function byId(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const el = byId(id);
  if (!el) return false;
  el.textContent = text || "";
  return true;
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

function loadModelLabel() {
  setText("spendLabel", `Estimated Spend | ${DEFAULT_MODEL}`);
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
      setText("runtimeStatus", `Quota cooldown (${minutes} min)`);
      return;
    }

    if (response.rateLimitUntil && response.now < response.rateLimitUntil) {
      const seconds = Math.max(1, Math.round((response.rateLimitUntil - response.now) / 1000));
      setText("runtimeStatus", `Rate limit cooldown (${seconds}s)`);
      return;
    }

    setText("runtimeStatus", "");
  } catch (_err) {
    setText("runtimeStatus", "");
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
    setText("estSpend", formatUsd(estCost));
    setText("usageLine", `${formatInt(totalTitles)} titles checked | ${formatInt(llmCalls)} LLM calls`);
  } catch (_err) {
    setText("estSpend", "$0.0000");
    setText("usageLine", "Usage unavailable");
  }
}

async function refresh() {
  await Promise.all([loadRuntimeStatus(), loadUsage()]);
  loadModelLabel();
}

function openOptionsPage() {
  chrome.runtime.openOptionsPage();
}

function init() {
  const refreshBtn = byId("refreshBtn");
  const openOptionsBtn = byId("openOptionsBtn");
  if (!refreshBtn || !openOptionsBtn) return;

  refreshBtn.addEventListener("click", refresh);
  openOptionsBtn.addEventListener("click", openOptionsPage);
  refresh();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
