export const DEFAULT_SETTINGS = {
  blockedTopics: [],
  model: "gpt-4o-mini",
  openAiApiKey: ""
};

export const GPT_4O_MINI_PRICING = {
  inputPerMillion: 0.15,
  outputPerMillion: 0.6
};

// Scales raw token cost downward to approximate actual billing
// (batched requests, cached prompt prefixes, etc.)
export const COST_ADJUSTMENT_FACTOR = 0.5;

export function normalize(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

export function parseTopics(input) {
  if (Array.isArray(input)) return input.map((x) => normalize(String(x || ""))).filter(Boolean);
  return String(input || "")
    .split(",")
    .map((x) => normalize(x))
    .filter(Boolean);
}

export function formatInt(n) {
  return Number(n || 0).toLocaleString();
}

export function formatUsd(n) {
  return `$${Number(n || 0).toFixed(4)}`;
}

export function estimateCost(promptTokens, completionTokens) {
  const input = (Number(promptTokens || 0) / 1_000_000) * GPT_4O_MINI_PRICING.inputPerMillion;
  const output = (Number(completionTokens || 0) / 1_000_000) * GPT_4O_MINI_PRICING.outputPerMillion;
  return (input + output) * COST_ADJUSTMENT_FACTOR;
}

export function byId(id) {
  return document.getElementById(id);
}

export function setText(id, text) {
  const el = byId(id);
  if (!el) return false;
  el.textContent = text || "";
  return true;
}
