import { DEFAULT_SETTINGS, normalize, parseTopics } from "./shared.js";

const STORAGE_KEYS = {
  quotaDisabledUntil: "ytrOpenAiDisabledUntil",
  quotaDisableReason: "ytrOpenAiDisableReason",
  rateLimitUntil: "ytrRateLimitUntil",
  rateLimitReason: "ytrRateLimitReason",
  apiStats: "ytrApiStats"
};

const LOCK_KEYS = [
  STORAGE_KEYS.quotaDisabledUntil,
  STORAGE_KEYS.quotaDisableReason,
  STORAGE_KEYS.rateLimitUntil,
  STORAGE_KEYS.rateLimitReason
];

const QUOTA_DISABLE_MS = 12 * 60 * 60 * 1000;
const DEFAULT_RATE_LIMIT_MS = 25_000;
const MIN_API_GAP_MS = 300;
const USAGE_FLUSH_DELAY_MS = 700;

const classificationCache = new Map();
let apiChain = Promise.resolve();
let nextAllowedRequestAt = 0;
let usageFlushTimer = null;
let pendingUsageDelta = null;
let latestSettings = { ...DEFAULT_SETTINGS };
let settingsReady = false;

function defaultApiStats() {
  return {
    totalRequests: 0,
    totalTitles: 0,
    llmCalls: 0,
    llmTitles: 0,
    cacheHits: 0,
    blockedMatches: 0,
    unknownTitles: 0,
    promptTokens: 0,
    completionTokens: 0,
    quotaErrors: 0,
    rateLimitErrors: 0,
    lastUpdatedAt: 0
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function isQuotaError(message) {
  const m = String(message || "").toLowerCase();
  return m.includes("insufficient_quota") || (m.includes("openai error 429") && m.includes("quota"));
}

function isRateLimitError(message) {
  const m = String(message || "").toLowerCase();
  return m.includes("rate limit") || m.includes("requests per min") || m.includes("rpm");
}

function extractRetrySeconds(message) {
  const match = String(message || "").match(/try again in\s*(\d+)\s*s/i);
  return match ? Number(match[1]) : null;
}

// --- Usage stats ---

function mergeApiStats(base, delta) {
  const stats = { ...defaultApiStats(), ...(base || {}) };
  for (const [k, v] of Object.entries(delta || {})) {
    if (typeof v === "number") {
      stats[k] = (Number(stats[k]) || 0) + v;
    }
  }
  stats.lastUpdatedAt = Date.now();
  return stats;
}

function queueUsageDelta(delta) {
  pendingUsageDelta = mergeApiStats(pendingUsageDelta, delta);
  if (usageFlushTimer) return;
  usageFlushTimer = setTimeout(flushUsageDelta, USAGE_FLUSH_DELAY_MS);
}

async function flushUsageDelta() {
  if (!pendingUsageDelta) return;
  const delta = pendingUsageDelta;
  pendingUsageDelta = null;
  if (usageFlushTimer) {
    clearTimeout(usageFlushTimer);
    usageFlushTimer = null;
  }
  try {
    const items = await chrome.storage.local.get([STORAGE_KEYS.apiStats]);
    const current = { ...defaultApiStats(), ...(items?.[STORAGE_KEYS.apiStats] || {}) };
    await chrome.storage.local.set({ [STORAGE_KEYS.apiStats]: mergeApiStats(current, delta) });
  } catch {
    // Storage write failed; delta is lost but non-critical.
  }
}

// --- Runtime locks (quota / rate-limit) ---

async function getRuntimeState() {
  const items = await chrome.storage.local.get(LOCK_KEYS);
  return {
    disabledUntil: Number(items?.[STORAGE_KEYS.quotaDisabledUntil] || 0),
    disableReason: String(items?.[STORAGE_KEYS.quotaDisableReason] || ""),
    rateLimitUntil: Number(items?.[STORAGE_KEYS.rateLimitUntil] || 0),
    rateLimitReason: String(items?.[STORAGE_KEYS.rateLimitReason] || "")
  };
}

async function clearRuntimeLocks() {
  await chrome.storage.local.remove(LOCK_KEYS);
  nextAllowedRequestAt = 0;
}

async function resetUsageStats() {
  pendingUsageDelta = null;
  if (usageFlushTimer) {
    clearTimeout(usageFlushTimer);
    usageFlushTimer = null;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.apiStats]: defaultApiStats() });
}

async function setQuotaDisabled(reason) {
  const disabledUntil = Date.now() + QUOTA_DISABLE_MS;
  await chrome.storage.local.set({
    [STORAGE_KEYS.quotaDisabledUntil]: disabledUntil,
    [STORAGE_KEYS.quotaDisableReason]: reason || "quota"
  });
  return disabledUntil;
}

async function setRateLimited(ms, reason) {
  const rateLimitUntil = Date.now() + Math.max(1000, ms || DEFAULT_RATE_LIMIT_MS);
  nextAllowedRequestAt = Math.max(nextAllowedRequestAt, rateLimitUntil);
  await chrome.storage.local.set({
    [STORAGE_KEYS.rateLimitUntil]: rateLimitUntil,
    [STORAGE_KEYS.rateLimitReason]: reason || "rate_limit"
  });
  return rateLimitUntil;
}

async function clearExpiredRuntimeLocks() {
  const state = await getRuntimeState();
  const now = Date.now();
  const removeKeys = [];

  if (state.disabledUntil && now >= state.disabledUntil) {
    removeKeys.push(STORAGE_KEYS.quotaDisabledUntil, STORAGE_KEYS.quotaDisableReason);
    state.disabledUntil = 0;
    state.disableReason = "";
  }

  if (state.rateLimitUntil && now >= state.rateLimitUntil) {
    removeKeys.push(STORAGE_KEYS.rateLimitUntil, STORAGE_KEYS.rateLimitReason);
    state.rateLimitUntil = 0;
    state.rateLimitReason = "";
  }

  if (removeKeys.length) {
    await chrome.storage.local.remove(removeKeys);
  }

  return state;
}

// --- Settings ---

async function getSettings() {
  const items = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  latestSettings = {
    ...DEFAULT_SETTINGS,
    ...items,
    blockedTopics: parseTopics(items.blockedTopics)
  };
  settingsReady = true;
  return latestSettings;
}

// --- OpenAI classification ---

function buildClassifyPrompt({ blockedTopics, titles }) {
  const payload = titles.map((title, i) => ({ i, t: title }));
  return [
    "Classify YouTube titles against blocked topics.",
    "If a title relates to any blocked topic, mark blocked=true.",
    "Be strict. If uncertain, mark blocked=true.",
    `Blocked topics: ${JSON.stringify(blockedTopics)}`,
    'Return ONLY JSON: {"items":[{"i":0,"blocked":true}]} with same item count and indexes.',
    `Input: ${JSON.stringify(payload)}`
  ].join("\n");
}

function parseJsonObject(content) {
  const text = normalize(content);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
    }
    return null;
  }
}

async function callOpenAI({ apiKey, model, prompt }) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You classify titles for safety filtering. Return strict JSON only." },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = await response.json();
  const parsed = parseJsonObject(data?.choices?.[0]?.message?.content);
  if (!parsed?.items || !Array.isArray(parsed.items)) {
    throw new Error("Invalid classifier JSON response");
  }

  return {
    items: parsed.items,
    promptTokens: Number(data?.usage?.prompt_tokens || 0),
    completionTokens: Number(data?.usage?.completion_tokens || 0)
  };
}

function cacheKey(title, blockedTopics, model) {
  return JSON.stringify({ title, blockedTopics, model });
}

async function runThrottled(task) {
  const run = apiChain.then(async () => {
    const now = Date.now();
    if (now < nextAllowedRequestAt) {
      await sleep(nextAllowedRequestAt - now);
    }
    try {
      return await task();
    } finally {
      nextAllowedRequestAt = Date.now() + MIN_API_GAP_MS;
    }
  });
  apiChain = run.catch(() => undefined);
  return run;
}

function toStringArray(input) {
  if (!Array.isArray(input)) return [];
  return input.map((v) => normalize(String(v || ""))).filter(Boolean);
}

function summarizeStatuses(statuses) {
  let blockedMatches = 0;
  let unknownTitles = 0;
  for (const s of statuses) {
    if (s === "blocked") blockedMatches++;
    if (s === "unknown") unknownTitles++;
  }
  return { blockedMatches, unknownTitles };
}

function buildResult(statuses, source, extra = {}) {
  queueUsageDelta(summarizeStatuses(statuses));
  return { ok: true, statuses, source, ...extra };
}

async function handleBatchClassify(payload) {
  const titles = toStringArray(payload?.titles);
  if (!titles.length) return { ok: true, statuses: [] };

  queueUsageDelta({ totalRequests: 1, totalTitles: titles.length });

  const settings = settingsReady ? latestSettings : await getSettings();
  const model = payload.model || settings.model;
  const topics = parseTopics(payload.blockedTopics?.length ? payload.blockedTopics : settings.blockedTopics);

  const statuses = new Array(titles.length).fill("unknown");
  const pending = [];

  for (let i = 0; i < titles.length; i++) {
    const key = cacheKey(titles[i], topics, model);
    const cached = classificationCache.get(key);
    if (cached === "safe" || cached === "blocked") {
      statuses[i] = cached;
      queueUsageDelta({ cacheHits: 1 });
    } else {
      pending.push({ i, title: titles[i], key });
    }
  }

  if (!pending.length) return buildResult(statuses, "cache");

  const runtimeState = await clearExpiredRuntimeLocks();
  const now = Date.now();

  if (runtimeState.disabledUntil && now < runtimeState.disabledUntil) {
    return buildResult(statuses, "quota-cooldown");
  }
  if (runtimeState.rateLimitUntil && now < runtimeState.rateLimitUntil) {
    return buildResult(statuses, "rate-limit-cooldown");
  }
  if (!settings.openAiApiKey) {
    return buildResult(statuses, "no-key");
  }

  const pendingTitles = pending.map((p) => p.title);
  const prompt = buildClassifyPrompt({ blockedTopics: topics, titles: pendingTitles });

  try {
    const result = await runThrottled(() =>
      callOpenAI({ apiKey: settings.openAiApiKey, model, prompt })
    );

    let llmTitleCount = 0;
    const mapped = new Map();
    for (const item of result.items) {
      const idx = Number(item?.i);
      if (Number.isInteger(idx) && idx >= 0 && idx < pendingTitles.length) {
        mapped.set(idx, item.blocked === true ? "blocked" : "safe");
      }
    }

    for (let j = 0; j < pending.length; j++) {
      const p = pending[j];
      const status = mapped.get(j);
      if (status) {
        statuses[p.i] = status;
        classificationCache.set(p.key, status);
        llmTitleCount++;
      }
    }

    queueUsageDelta({
      llmCalls: 1,
      llmTitles: llmTitleCount,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens
    });

    return buildResult(statuses, "llm");
  } catch (err) {
    const errorText = String(err?.message || err);
    if (isQuotaError(errorText)) {
      await setQuotaDisabled("quota");
      queueUsageDelta({ quotaErrors: 1 });
    } else if (isRateLimitError(errorText)) {
      const retrySec = extractRetrySeconds(errorText);
      await setRateLimited((retrySec ? retrySec + 2 : 25) * 1000, "rpm");
      queueUsageDelta({ rateLimitErrors: 1 });
    }
    return buildResult(statuses, "error", { error: errorText });
  }
}

// --- Message handling ---

const messageHandlers = {
  async GET_RUNTIME_STATUS() {
    const state = await clearExpiredRuntimeLocks();
    return { ok: true, ...state, now: Date.now() };
  },

  async RESET_RUNTIME_LOCKS() {
    await clearRuntimeLocks();
    return { ok: true };
  },

  async GET_USAGE_STATS() {
    await flushUsageDelta();
    const items = await chrome.storage.local.get([STORAGE_KEYS.apiStats]);
    return {
      ok: true,
      apiStats: { ...defaultApiStats(), ...(items?.[STORAGE_KEYS.apiStats] || {}) }
    };
  },

  async RESET_USAGE_STATS() {
    await resetUsageStats();
    return { ok: true };
  },

  async BATCH_CLASSIFY_TITLES(message) {
    return handleBatchClassify(message.payload || {});
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = messageHandlers[message?.type];
  if (!handler) return;
  handler(message).then(sendResponse);
  return true;
});

// --- Settings sync ---

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.blockedTopics) latestSettings.blockedTopics = parseTopics(changes.blockedTopics.newValue);
  if (changes.model) latestSettings.model = String(changes.model.newValue || DEFAULT_SETTINGS.model);
  if (changes.openAiApiKey) latestSettings.openAiApiKey = String(changes.openAiApiKey.newValue || "");
  settingsReady = true;
});

getSettings().catch(() => { settingsReady = false; });
