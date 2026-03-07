const DEFAULT_SETTINGS = {
  mode: "block_only",
  blockedTopics: [],
  model: "gpt-4o-mini",
  openAiApiKey: ""
};

const QUOTA_DISABLE_KEY = "ytrOpenAiDisabledUntil";
const QUOTA_REASON_KEY = "ytrOpenAiDisableReason";
const RATE_LIMIT_UNTIL_KEY = "ytrRateLimitUntil";
const RATE_LIMIT_REASON_KEY = "ytrRateLimitReason";
const API_STATS_KEY = "ytrApiStats";

const QUOTA_DISABLE_MS = 12 * 60 * 60 * 1000;
const DEFAULT_RATE_LIMIT_MS = 25 * 1000;
const MIN_API_GAP_MS = 300;

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

function normalize(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function normalizeTopics(input) {
  if (Array.isArray(input)) return input.map((x) => normalize(String(x || ""))).filter(Boolean);
  return String(input || "")
    .split(",")
    .map((x) => normalize(x))
    .filter(Boolean);
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
  const m = String(message || "");
  const match = m.match(/try again in\s*(\d+)\s*s/i);
  if (!match) return null;
  return Number(match[1]);
}

function mergeApiStats(base, delta) {
  const stats = { ...defaultApiStats(), ...(base || {}) };
  for (const [k, v] of Object.entries(delta || {})) {
    if (typeof v === "number") {
      stats[k] = Number(stats[k] || 0) + v;
    }
  }
  stats.lastUpdatedAt = Date.now();
  return stats;
}

function queueUsageDelta(delta) {
  pendingUsageDelta = mergeApiStats(pendingUsageDelta, delta);
  if (usageFlushTimer) return;

  usageFlushTimer = setTimeout(() => {
    flushUsageDelta();
  }, 700);
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
    await new Promise((resolve) => {
      chrome.storage.local.get([API_STATS_KEY], (items) => {
        const current = { ...defaultApiStats(), ...(items?.[API_STATS_KEY] || {}) };
        const next = mergeApiStats(current, delta);
        chrome.storage.local.set({ [API_STATS_KEY]: next }, () => resolve());
      });
    });
  } catch (_err) {
  }
}

async function getRuntimeState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [QUOTA_DISABLE_KEY, QUOTA_REASON_KEY, RATE_LIMIT_UNTIL_KEY, RATE_LIMIT_REASON_KEY],
      (items) => {
        resolve({
          disabledUntil: Number(items?.[QUOTA_DISABLE_KEY] || 0),
          disableReason: String(items?.[QUOTA_REASON_KEY] || ""),
          rateLimitUntil: Number(items?.[RATE_LIMIT_UNTIL_KEY] || 0),
          rateLimitReason: String(items?.[RATE_LIMIT_REASON_KEY] || "")
        });
      }
    );
  });
}

async function clearRuntimeLocks() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(
      [QUOTA_DISABLE_KEY, QUOTA_REASON_KEY, RATE_LIMIT_UNTIL_KEY, RATE_LIMIT_REASON_KEY],
      () => {
        nextAllowedRequestAt = 0;
        resolve();
      }
    );
  });
}

async function resetUsageStats() {
  pendingUsageDelta = null;
  if (usageFlushTimer) {
    clearTimeout(usageFlushTimer);
    usageFlushTimer = null;
  }

  return new Promise((resolve) => {
    chrome.storage.local.set({ [API_STATS_KEY]: defaultApiStats() }, () => resolve());
  });
}

async function setQuotaDisabled(reason) {
  const disabledUntil = Date.now() + QUOTA_DISABLE_MS;
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [QUOTA_DISABLE_KEY]: disabledUntil,
        [QUOTA_REASON_KEY]: reason || "quota"
      },
      () => resolve(disabledUntil)
    );
  });
}

async function setRateLimited(ms, reason) {
  const rateLimitUntil = Date.now() + Math.max(1000, ms || DEFAULT_RATE_LIMIT_MS);
  nextAllowedRequestAt = Math.max(nextAllowedRequestAt, rateLimitUntil);
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [RATE_LIMIT_UNTIL_KEY]: rateLimitUntil,
        [RATE_LIMIT_REASON_KEY]: reason || "rate_limit"
      },
      () => resolve(rateLimitUntil)
    );
  });
}

async function clearExpiredRuntimeLocks() {
  const state = await getRuntimeState();
  const now = Date.now();
  const removeKeys = [];

  if (state.disabledUntil && now >= state.disabledUntil) {
    removeKeys.push(QUOTA_DISABLE_KEY, QUOTA_REASON_KEY);
    state.disabledUntil = 0;
    state.disableReason = "";
  }

  if (state.rateLimitUntil && now >= state.rateLimitUntil) {
    removeKeys.push(RATE_LIMIT_UNTIL_KEY, RATE_LIMIT_REASON_KEY);
    state.rateLimitUntil = 0;
    state.rateLimitReason = "";
  }

  if (removeKeys.length > 0) {
    await new Promise((resolve) => chrome.storage.local.remove(removeKeys, () => resolve()));
  }

  return state;
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      latestSettings = {
        ...DEFAULT_SETTINGS,
        ...items,
        mode: "block_only",
        blockedTopics: normalizeTopics(items.blockedTopics)
      };
      settingsReady = true;
      resolve(latestSettings);
    });
  });
}

function buildClassifyPrompt({ blockedTopics, titles }) {
  const payload = titles.map((title, i) => ({ i, t: title }));

  return [
    "Classify YouTube titles against blocked topics.",
    "If a title relates to any blocked topic, mark blocked=true.",
    "Be strict. If uncertain, mark blocked=true.",
    `Blocked topics: ${JSON.stringify(blockedTopics)}`,
    "Return ONLY JSON object: {\"items\":[{\"i\":0,\"blocked\":true}]} with same item count and indexes.",
    `Input: ${JSON.stringify(payload)}`
  ].join("\n");
}

function parseJsonObject(content) {
  const text = normalize(content);
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_err) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (_err2) {
      }
    }
    return null;
  }
}

async function callOpenAIClassifyBatch({ apiKey, model, prompt }) {
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
        {
          role: "system",
          content: "You classify titles for safety filtering. Return strict JSON only."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = await response.json();
  const content = normalize(data?.choices?.[0]?.message?.content || "");
  const parsed = parseJsonObject(content);
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error("Invalid classifier JSON response");
  }

  return {
    items: parsed.items,
    promptTokens: Number(data?.usage?.prompt_tokens || 0),
    completionTokens: Number(data?.usage?.completion_tokens || 0)
  };
}

function cacheKey({ title, blockedTopics, model }) {
  return JSON.stringify({ title, blockedTopics, model });
}

async function runThrottledOpenAI(task) {
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
    if (s === "blocked") blockedMatches += 1;
    if (s === "unknown") unknownTitles += 1;
  }
  return { blockedMatches, unknownTitles };
}

async function handleBatchClassify(payload) {
  const titles = toStringArray(payload?.titles || []);
  if (!titles.length) {
    return { ok: true, statuses: [] };
  }

  queueUsageDelta({ totalRequests: 1, totalTitles: titles.length });

  const settings = settingsReady ? latestSettings : await getSettings();
  const model = payload.model || settings.model;
  const topics = normalizeTopics(payload.blockedTopics?.length ? payload.blockedTopics : settings.blockedTopics);

  const statuses = new Array(titles.length).fill("unknown");
  const pending = [];

  for (let i = 0; i < titles.length; i += 1) {
    const key = cacheKey({ title: titles[i], blockedTopics: topics, model });
    const cached = classificationCache.get(key);
    if (cached === "safe" || cached === "blocked") {
      statuses[i] = cached;
      queueUsageDelta({ cacheHits: 1 });
    } else {
      pending.push({ i, title: titles[i], key });
    }
  }

  if (!pending.length) {
    const counts = summarizeStatuses(statuses);
    queueUsageDelta(counts);
    return { ok: true, statuses, source: "cache" };
  }

  const runtimeState = await clearExpiredRuntimeLocks();
  const apiKey = settings.openAiApiKey;

  if (runtimeState.disabledUntil && Date.now() < runtimeState.disabledUntil) {
    const counts = summarizeStatuses(statuses);
    queueUsageDelta(counts);
    return { ok: true, statuses, source: "quota-cooldown" };
  }

  if (runtimeState.rateLimitUntil && Date.now() < runtimeState.rateLimitUntil) {
    const counts = summarizeStatuses(statuses);
    queueUsageDelta(counts);
    return { ok: true, statuses, source: "rate-limit-cooldown" };
  }

  if (!apiKey) {
    const counts = summarizeStatuses(statuses);
    queueUsageDelta(counts);
    return { ok: true, statuses, source: "no-key" };
  }


  const pendingTitles = pending.map((p) => p.title);
  const prompt = buildClassifyPrompt({ blockedTopics: topics, titles: pendingTitles });

  try {
    const result = await runThrottledOpenAI(() =>
      callOpenAIClassifyBatch({
        apiKey,
        model,
        prompt
      })
    );

    let llmTitleCount = 0;
    const mapped = new Map();
    for (const item of result.items || []) {
      const idx = Number(item?.i);
      if (!Number.isInteger(idx)) continue;
      if (idx < 0 || idx >= pendingTitles.length) continue;
      mapped.set(idx, item?.blocked === true ? "blocked" : "safe");
    }

    for (let j = 0; j < pending.length; j += 1) {
      const p = pending[j];
      const status = mapped.get(j);
      if (status === "safe" || status === "blocked") {
        statuses[p.i] = status;
        classificationCache.set(p.key, status);
        llmTitleCount += 1;
      } else {
        statuses[p.i] = "unknown";
      }
    }

    const counts = summarizeStatuses(statuses);
    queueUsageDelta({
      llmCalls: 1,
      llmTitles: llmTitleCount,
      promptTokens: Number(result?.promptTokens || 0),
      completionTokens: Number(result?.completionTokens || 0),
      ...counts
    });

    return { ok: true, statuses, source: "llm" };
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

    const counts = summarizeStatuses(statuses);
    queueUsageDelta(counts);
    return { ok: true, statuses, source: "error", error: errorText };
  }
}


chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;

  if (changes.blockedTopics) {
    latestSettings.blockedTopics = normalizeTopics(changes.blockedTopics.newValue);
  }
  if (changes.model) {
    latestSettings.model = String(changes.model.newValue || DEFAULT_SETTINGS.model);
  }
  if (changes.openAiApiKey) {
    latestSettings.openAiApiKey = String(changes.openAiApiKey.newValue || "");
  }
  if (changes.mode) {
    latestSettings.mode = "block_only";
  }
  settingsReady = true;
});

getSettings().catch(() => {
  settingsReady = false;
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_RUNTIME_STATUS") {
    (async () => {
      const state = await clearExpiredRuntimeLocks();
      sendResponse({ ok: true, ...state, now: Date.now() });
    })();
    return true;
  }

  if (message?.type === "RESET_RUNTIME_LOCKS") {
    (async () => {
      await clearRuntimeLocks();
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === "GET_USAGE_STATS") {
    (async () => {
      await flushUsageDelta();
      chrome.storage.local.get([API_STATS_KEY], (items) => {
        sendResponse({ ok: true, apiStats: { ...defaultApiStats(), ...(items?.[API_STATS_KEY] || {}) } });
      });
    })();
    return true;
  }

  if (message?.type === "RESET_USAGE_STATS") {
    (async () => {
      await resetUsageStats();
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === "BATCH_CLASSIFY_TITLES") {
    (async () => {
      const response = await handleBatchClassify(message.payload || {});
      sendResponse(response);
    })();
    return true;
  }
});



