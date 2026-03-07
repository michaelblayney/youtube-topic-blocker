const DEFAULT_SETTINGS = {
  mode: "block_only",
  blockedTopics: [],
  model: "gpt-4o-mini",
  openAiApiKey: ""
};

const TITLE_SELECTORS = [
  "a#video-title",
  "a#video-title-link",
  "yt-formatted-string#video-title",
  "#video-title",
  "h3 a[href*='/watch']",
  "a.yt-simple-endpoint[href*='/watch']",
  "a.yt-lockup-view-model__title[href*='/watch']"
];

const CARD_SELECTORS = [
  "ytd-rich-item-renderer",
  "ytd-rich-grid-media",
  "ytd-rich-grid-slim-media",
  "ytd-video-renderer",
  "ytd-grid-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-compact-radio-renderer",
  "ytd-compact-station-renderer",
  "ytd-compact-playlist-renderer",
  "ytd-compact-movie-renderer",
  "ytd-compact-promoted-video-renderer",
  "ytd-compact-autoplay-renderer",
  "ytd-reel-item-renderer",
  "ytd-lockup-view-model",
  "div.yt-lockup-view-model",
  "yt-lockup-view-model",
  "yt-lockup-view-model-view-model"
];

const CARD_SELECTOR = CARD_SELECTORS.join(", ");
const PRIMARY_CARD_SELECTORS = [
  "ytd-rich-item-renderer",
  "ytd-video-renderer",
  "ytd-grid-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-compact-radio-renderer",
  "ytd-compact-station-renderer",
  "ytd-compact-playlist-renderer",
  "ytd-compact-movie-renderer",
  "ytd-compact-promoted-video-renderer",
  "ytd-compact-autoplay-renderer",
  "ytd-reel-item-renderer"
];
const PENDING_STYLE_ID = "ytr-pending-style";
const END_SCREEN_SELECTOR = ".ytp-fullscreen-grid-main-content, .ytp-modern-videowall-still.ytp-suggestion-set";
const UNKNOWN_RETRY_MS = 1400;
const VIEWPORT_TOP_BUFFER_PX = 120;
const VIEWPORT_BOTTOM_BUFFER_PX = 520;
const MAX_UNIQUE_TITLES_PER_PASS = 180;

const processed = new WeakMap();

let observer = null;
let flushTimer = null;
let heartbeatTimer = null;
let immediateMaskTimer = null;
let stopped = false;
let processing = false;
let rerunRequested = false;
let latestSettings = { ...DEFAULT_SETTINGS };

function normalize(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}


function isExtensionContextValid() {
  try {
    return Boolean(chrome?.runtime?.id);
  } catch (_err) {
    return false;
  }
}

function isTargetPage() {
  const path = window.location.pathname || "";
  return path === "/" || path.startsWith("/watch");
}

function settingsSignature(settings) {
  return JSON.stringify({
    mode: settings.mode,
    blockedTopics: settings.blockedTopics,
    model: settings.model
  });
}

function parseTopics(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      const blockedTopics = Array.isArray(items.blockedTopics) ? items.blockedTopics : parseTopics(items.blockedTopics);
      const settings = {
        ...DEFAULT_SETTINGS,
        ...items,
        mode: "block_only",
        blockedTopics
      };
      latestSettings = settings;
      resolve(settings);
    });
  });
}

function ensurePendingStyles() {
  if (document.getElementById(PENDING_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PENDING_STYLE_ID;
  style.textContent = `
    .ytr-hidden-title {
      position: relative;
      color: transparent !important;
    }
    .ytr-hidden-title::after {
      content: "Checking Video...";
      position: absolute;
      left: 0;
      top: 0;
      color: #9ca3af;
      background: linear-gradient(90deg, #94a3b8 0%, #e2e8f0 50%, #94a3b8 100%);
      background-size: 180% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: ytrPulse 1.1s linear infinite;
      pointer-events: none;
      white-space: nowrap;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ytr-checked-title {
      position: relative;
      font-style: italic !important;
      padding-left: 0.55em;
    }
    .ytr-checked-title::before {
      content: "*";
      position: absolute;
      left: 0;
      top: 0;
      color: #f59e0b;
      font-style: normal;
      font-weight: 700;
      line-height: 1.05;
    }
    .ytr-hidden-title.ytr-checked-title::before {
      content: "";
    }
    .ytr-pending-card ytd-thumbnail,
    .ytr-pending-card a#thumbnail,
    .ytr-pending-card #thumbnail,
    .ytr-pending-card ytd-playlist-thumbnail,
    .ytr-pending-card yt-image,
    .ytr-pending-card img,
    .ytr-pending-card .yt-lockup-view-model__content-image,
    .ytr-pending-card a.yt-lockup-view-model__content-image {
      visibility: hidden !important;
    }
    @keyframes ytrPulse {
      from { background-position: 100% 0; }
      to { background-position: -100% 0; }
    }
  `;
  const styleTarget = document.head || document.documentElement;
  if (styleTarget) styleTarget.appendChild(style);
}

function stopProcessing() {
  stopped = true;

  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (immediateMaskTimer) {
    clearTimeout(immediateMaskTimer);
    immediateMaskTimer = null;
  }
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

function removeEndScreenRecommendations() {
  const nodes = document.querySelectorAll(END_SCREEN_SELECTOR);
  for (const node of nodes) {
    if (node instanceof Element) {
      node.remove();
    }
  }
}

function setTitleHidden(node, hidden) {
  if (!node) return;

  if (hidden) {
    node.classList.add("ytr-hidden-title");
  } else {
    node.classList.remove("ytr-hidden-title");
  }

  const ytFormatted = node.querySelector?.("yt-formatted-string");
  if (ytFormatted) {
    if (hidden) {
      ytFormatted.classList.add("ytr-hidden-title");
    } else {
      ytFormatted.classList.remove("ytr-hidden-title");
    }
  }
}

function setTitleChecked(node, checked) {
  if (!node) return;

  node.classList.remove("ytr-checked-title");

  const ytFormatted = node.querySelector?.("yt-formatted-string");
  if (ytFormatted) {
    ytFormatted.classList.remove("ytr-checked-title");
  }

  if (!checked) return;

  if (ytFormatted) {
    ytFormatted.classList.add("ytr-checked-title");
  } else {
    node.classList.add("ytr-checked-title");
  }
}

function restoreOriginalTitle(node, original) {
  if (!node) return;
  const value = normalize(original);
  if (!value) return;

  if (normalize(node.textContent) !== value) {
    node.textContent = value;
    node.setAttribute("title", value);
    node.setAttribute("aria-label", value);

    const ytFormatted = node.querySelector?.("yt-formatted-string");
    if (ytFormatted) {
      ytFormatted.textContent = value;
      ytFormatted.setAttribute("title", value);
      ytFormatted.setAttribute("aria-label", value);
    }
  }
}

function findCard(node) {
  const cards = getCardAncestors(node);
  if (!cards.length) return null;

  for (const selector of PRIMARY_CARD_SELECTORS) {
    const match = cards.find((card) => card.matches?.(selector));
    if (match) return match;
  }

  return cards[0] || null;
}
function getCardAncestors(node) {
  const cards = [];
  let current = node;

  while (current && current instanceof Element) {
    const card = current.closest?.(CARD_SELECTOR);
    if (!card) break;
    if (!cards.includes(card)) {
      cards.push(card);
    }
    current = card.parentElement;
  }

  return cards;
}

function setCardVisible(node, visible) {
  const card = findCard(node);
  if (!card) return;

  if (!visible) {
    if (!card.hasAttribute("data-ytr-prev-display")) {
      card.setAttribute("data-ytr-prev-display", card.style.display || "");
    }
    card.setAttribute("data-ytr-filter-hidden", "1");
    card.style.setProperty("display", "none", "important");
    return;
  }

  if (card.hasAttribute("data-ytr-filter-hidden")) {
    const prev = card.getAttribute("data-ytr-prev-display") || "";
    card.style.display = prev;
    card.removeAttribute("data-ytr-prev-display");
    card.removeAttribute("data-ytr-filter-hidden");
  }
}

function setCardPending(node, pending) {
  const cards = getCardAncestors(node);
  if (!cards.length) return;

  const primary = findCard(node) || cards[0];

  // Clear stale pending state from wrapper ancestors so one card cannot mask siblings.
  for (const card of cards) {
    if (card !== primary) {
      card.classList.remove("ytr-pending-card");
    }
  }

  if (pending) {
    primary.classList.add("ytr-pending-card");
  } else {
    primary.classList.remove("ytr-pending-card");
  }
}

function isLikelyVideoTitleNode(node) {
  if (!node || !(node instanceof Element)) return false;

  const text = normalize(node.textContent);
  if (!text) return false;

  if (node.closest("ytd-guide-renderer, ytd-mini-guide-renderer, ytd-masthead")) return false;

  const videoContainer = node.closest(CARD_SELECTOR);
  if (videoContainer) return true;

  const link = node.tagName === "A" ? node : node.closest("a");
  if (link && link.getAttribute("href")?.includes("/watch")) return true;

  return false;
}

function getTitleNodes() {
  const nodes = [];
  const seen = new Set();

  for (const selector of TITLE_SELECTORS) {
    const found = document.querySelectorAll(selector);
    for (const el of found) {
      if (seen.has(el)) continue;
      if (!isLikelyVideoTitleNode(el)) continue;
      seen.add(el);
      nodes.push(el);
    }
  }

  return nodes;
}

function findLikelyTitleNodeInCard(card) {
  if (!card || !(card instanceof Element)) return null;

  for (const selector of TITLE_SELECTORS) {
    const candidate = card.querySelector(selector);
    if (candidate && isLikelyVideoTitleNode(candidate)) {
      return candidate;
    }
  }

  return null;
}
function maskWatchSidebarCardsImmediately() {
  if (!window.location.pathname.startsWith("/watch")) return;

  const scopedSelectors = [];
  for (const parent of ["ytd-watch-next-secondary-results-renderer", "#related"]) {
    for (const cardSelector of CARD_SELECTORS) {
      scopedSelectors.push(`${parent} ${cardSelector}`);
    }
  }

  if (!scopedSelectors.length) return;

  const cards = document.querySelectorAll(scopedSelectors.join(", "));
  for (const card of cards) {
    if (!(card instanceof Element)) continue;
    if (card.hasAttribute("data-ytr-filter-hidden")) continue;
    const titleNode = findLikelyTitleNodeInCard(card);
    if (!titleNode) {
      card.classList.remove("ytr-pending-card");
      continue;
    }
    if (card.querySelector(".ytr-checked-title")) continue;
    card.classList.add("ytr-pending-card");
  }
}

function isNearViewport(node) {
  if (!node?.getBoundingClientRect) return true;
  const rect = node.getBoundingClientRect();
  const minY = 0 - VIEWPORT_TOP_BUFFER_PX;
  const maxY = window.innerHeight + VIEWPORT_BOTTOM_BUFFER_PX;
  return rect.bottom >= minY && rect.top <= maxY;
}

function orderNodesForClassification(nodes) {
  const near = [];
  const far = [];

  for (const node of nodes) {
    if (isNearViewport(node)) {
      near.push(node);
    } else {
      far.push(node);
    }
  }

  return near.concat(far);
}

function applyStatus(node, original, status) {
  if (status === "blocked") {
    setCardPending(node, false);
    setCardVisible(node, false);
    setTitleHidden(node, true);
    setTitleChecked(node, false);
    return;
  }

  if (status === "safe") {
    setCardVisible(node, true);
    setCardPending(node, false);
    restoreOriginalTitle(node, original);
    setTitleHidden(node, false);
    setTitleChecked(node, true);
    return;
  }

  // Unknown while waiting on LLM: keep card space but hide title and thumbnail media.
  setCardVisible(node, true);
  setCardPending(node, true);
  setTitleHidden(node, true);
  setTitleChecked(node, false);
}

function markTitlePendingIfNeeded(node, signature) {
  if (!node || !isLikelyVideoTitleNode(node)) return { shouldClassify: false, original: "" };

  const storedOriginal = normalize(node.getAttribute("data-ytr-original-title"));
  const liveText = normalize(node.textContent);
  const liveLower = liveText.toLowerCase();
  const liveLooksLikePlaceholder = liveLower === "checking..." || liveLower === "not relevant";

  let original = storedOriginal || liveText;
  if (liveText && !liveLooksLikePlaceholder && liveText !== storedOriginal) {
    // YouTube frequently reuses renderer nodes while scrolling; reclassify when the live title changes.
    original = liveText;
    node.setAttribute("data-ytr-original-title", original);
    processed.delete(node);
  }

  if (!original) return { shouldClassify: false, original: "" };

  if (!storedOriginal) {
    node.setAttribute("data-ytr-original-title", original);
  }

  const already = processed.get(node);
  if (already && already.original === original && already.signature === signature) {
    applyStatus(node, original, already.status);

    if (already.status === "unknown") {
      const retryAt = Number(already.nextRetryAt || 0);
      if (Date.now() >= retryAt) {
        return { shouldClassify: true, original };
      }
    }

    return { shouldClassify: false, original };
  }

  applyStatus(node, original, "unknown");
  return { shouldClassify: true, original };
}

function maskVisibleTitlesImmediately() {
  if (stopped || !isExtensionContextValid() || !isTargetPage()) return;
  ensurePendingStyles();
  removeEndScreenRecommendations();
  maskWatchSidebarCardsImmediately();

  const signature = settingsSignature(latestSettings);
  const nodes = getTitleNodes();

  for (const node of nodes) {
    markTitlePendingIfNeeded(node, signature);
  }
}

function scheduleImmediateMask() {
  if (stopped) return;
  if (immediateMaskTimer) return;

  immediateMaskTimer = setTimeout(() => {
    immediateMaskTimer = null;
    maskVisibleTitlesImmediately();
  }, 0);
}

async function classifyBatchTitles(titles, settings) {
  if (!titles.length) return [];

  try {
    const response = await chrome.runtime.sendMessage({
      type: "BATCH_CLASSIFY_TITLES",
      payload: {
        titles,
        blockedTopics: settings.blockedTopics,
        model: settings.model
      }
    });

    if (!response?.ok || !Array.isArray(response?.statuses)) {
      return titles.map(() => "unknown");
    }

    return response.statuses.map((s) => (s === "safe" || s === "blocked" ? s : "unknown"));
  } catch (_err) {
    return titles.map(() => "unknown");
  }
}

async function processVisibleTitlesOnce() {
  if (stopped || !isExtensionContextValid()) {
    stopProcessing();
    return;
  }

  if (!isTargetPage()) return;

  ensurePendingStyles();

  const settings = await getSettings();
  const signature = settingsSignature(settings);
  const nodes = orderNodesForClassification(getTitleNodes());

  const candidates = [];
  const titlesInBatch = new Set();

  for (const node of nodes) {
    const result = markTitlePendingIfNeeded(node, signature);
    if (!result.shouldClassify || !result.original) continue;

    const hasTitle = titlesInBatch.has(result.original);
    if (!hasTitle && titlesInBatch.size >= MAX_UNIQUE_TITLES_PER_PASS) {
      continue;
    }

    titlesInBatch.add(result.original);
    candidates.push({ node, original: result.original });
  }

  if (!candidates.length) return;

  const uniqueTitles = Array.from(titlesInBatch);
  const statuses = await classifyBatchTitles(uniqueTitles, settings);

  const statusByTitle = new Map();
  for (let i = 0; i < uniqueTitles.length; i += 1) {
    statusByTitle.set(uniqueTitles[i], statuses[i] || "unknown");
  }

  for (const item of candidates) {
    const status = statusByTitle.get(item.original) || "unknown";
    applyStatus(item.node, item.original, status);

    processed.set(item.node, {
      original: item.original,
      signature,
      status,
      nextRetryAt: status === "unknown" ? Date.now() + UNKNOWN_RETRY_MS : 0
    });
  }
}

async function processVisibleTitles() {
  if (processing) {
    rerunRequested = true;
    return;
  }

  processing = true;
  do {
    rerunRequested = false;
    try {
      await processVisibleTitlesOnce();
    } catch (_err) {
      if (!isExtensionContextValid()) {
        stopProcessing();
      }
    }
  } while (rerunRequested && !stopped);
  processing = false;
}

function scheduleRefresh() {
  if (stopped) return;
  maskVisibleTitlesImmediately();
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    processVisibleTitles();
  }, 70);
}

observer = new MutationObserver(() => {
  try {
    removeEndScreenRecommendations();
    scheduleImmediateMask();
    scheduleRefresh();
  } catch (_err) {
    stopProcessing();
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("beforeunload", stopProcessing, { once: true });
window.addEventListener("pagehide", stopProcessing, { once: true });
window.addEventListener("yt-navigate-finish", scheduleRefresh);
document.addEventListener("yt-page-data-updated", scheduleRefresh);

heartbeatTimer = setInterval(() => {
  if (!stopped && isTargetPage()) {
    removeEndScreenRecommendations();
    scheduleImmediateMask();
    scheduleRefresh();
  }
}, 1200);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;

  if (changes.blockedTopics) {
    latestSettings.blockedTopics = Array.isArray(changes.blockedTopics.newValue)
      ? changes.blockedTopics.newValue
      : parseTopics(changes.blockedTopics.newValue);
  }
  if (changes.model) {
    latestSettings.model = String(changes.model.newValue || DEFAULT_SETTINGS.model);
  }
  if (changes.openAiApiKey) {
    latestSettings.openAiApiKey = String(changes.openAiApiKey.newValue || "");
  }
  if (changes.blockedTopics || changes.model || changes.openAiApiKey || changes.mode) {
    scheduleRefresh();
  }
});

getSettings().finally(() => {
  maskVisibleTitlesImmediately();
  processVisibleTitles();
  scheduleRefresh();
});







