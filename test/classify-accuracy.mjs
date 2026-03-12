#!/usr/bin/env node

// Classification accuracy test for YouTube Content Filter.
//
// Usage:
//   OPENAI_API_KEY=sk-... node test/classify-accuracy.mjs "topic1, topic2, ..."
//
// Options:
//   --unsafe        Show full blocked titles instead of redacting them
//   MODEL env var   Override the model (default: gpt-4o-mini)
//
// By default blocked test titles are redacted in output.

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.MODEL || "gpt-4o-mini";

const args = process.argv.slice(2);
const SHOW_BLOCKED = args.includes("--unsafe");
const positional = args.filter((a) => !a.startsWith("--"));
const topicsArg = positional[0];

if (!API_KEY) {
  console.error("Error: Set OPENAI_API_KEY environment variable.");
  process.exit(1);
}
if (!topicsArg) {
  console.error("Usage: OPENAI_API_KEY=sk-... node test/classify-accuracy.mjs \"topic1, topic2, ...\" [--unsafe]");
  process.exit(1);
}

const blockedTopics = topicsArg.split(",").map((s) => s.trim()).filter(Boolean);

// --- Known-safe titles (should all classify as "safe") ---

const SAFE_TITLES = [
  "How to Make Perfect Sourdough Bread at Home",
  "10 Best Hiking Trails in Colorado",
  "Learn Python in 30 Minutes - Beginner Tutorial",
  "Morning Yoga Routine for Flexibility",
  "NASA's Latest Mars Rover Discovery",
  "Easy Budget Meal Prep for the Week",
  "The History of Ancient Rome - Full Documentary",
  "How to Train Your Dog: Basic Commands",
  "Top 5 Camera Settings Every Photographer Should Know",
  "Relaxing Rain Sounds for Sleep - 10 Hours",
  "Building a Bookshelf from Scratch - DIY Woodworking",
  "Understanding Climate Change in 10 Minutes",
];

// --- Templates for generating blocked titles (topic substituted at runtime) ---

const BLOCKED_TEMPLATES = [
  "The Complete {Topic} Guide for 2026",
  "{Topic} Explained: Everything You Need to Know",
  "Why {Topic} Is Bigger Than Ever",
  "My Honest {Topic} Experience - Full Story",
  "{Topic} Tips That Actually Work",
];

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function generateBlockedTitles(topics) {
  const results = [];
  for (const topic of topics) {
    for (const template of BLOCKED_TEMPLATES) {
      results.push({
        title: template.replace(/\{Topic\}/g, capitalize(topic)),
        topic,
      });
    }
  }
  return results;
}

// --- OpenAI call (mirrors extension's prompt exactly) ---

function buildPrompt(blockedTopics, titles) {
  const payload = titles.map((title, i) => ({ i, t: title }));
  return [
    "Classify YouTube titles against blocked topics.",
    "If a title relates to any blocked topic, mark blocked=true.",
    "Be strict. If uncertain, mark blocked=true.",
    `Blocked topics: ${JSON.stringify(blockedTopics)}`,
    'Return ONLY JSON: {"items":[{"i":0,"blocked":true}]} with same item count and indexes.',
    `Input: ${JSON.stringify(payload)}`,
  ].join("\n");
}

async function classify(titles) {
  const prompt = buildPrompt(blockedTopics, titles);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You classify titles for safety filtering. Return strict JSON only." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API error ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || "";

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) {
      parsed = JSON.parse(content.slice(start, end + 1));
    } else {
      throw new Error("Failed to parse classifier response");
    }
  }

  return {
    items: parsed.items || [],
    promptTokens: data?.usage?.prompt_tokens || 0,
    completionTokens: data?.usage?.completion_tokens || 0,
  };
}

// --- Main ---

async function main() {
  const blockedTestTitles = generateBlockedTitles(blockedTopics);
  const allTitles = [
    ...SAFE_TITLES,
    ...blockedTestTitles.map((b) => b.title),
  ];

  console.log(`\n  Classification Accuracy Test`);
  console.log(`  Model: ${MODEL}`);
  console.log(`  Blocked topics: ${blockedTopics.length} configured`);
  console.log(`  Testing ${SAFE_TITLES.length} safe + ${blockedTestTitles.length} blocked titles...`);
  console.log(`  Blocked titles: ${SHOW_BLOCKED ? "shown (--unsafe)" : "redacted (pass --unsafe to show)"}\n`);

  const result = await classify(allTitles);

  const statusMap = new Map();
  for (const item of result.items) {
    statusMap.set(Number(item.i), item.blocked === true ? "blocked" : "safe");
  }

  let safeCorrect = 0;
  let safeFalseBlock = 0;
  let blockedCorrect = 0;
  let blockedMissed = 0;

  console.log("  ── Safe titles ──");
  for (let i = 0; i < SAFE_TITLES.length; i++) {
    const status = statusMap.get(i) || "unknown";
    const correct = status === "safe";
    if (correct) safeCorrect++;
    else safeFalseBlock++;
    const mark = correct ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    console.log(`    ${mark} "${SAFE_TITLES[i]}" → ${status}`);
  }

  console.log(`\n  ── Blocked titles${SHOW_BLOCKED ? "" : " (redacted)"} ──`);
  for (let i = 0; i < blockedTestTitles.length; i++) {
    const idx = SAFE_TITLES.length + i;
    const status = statusMap.get(idx) || "unknown";
    const correct = status === "blocked";
    if (correct) blockedCorrect++;
    else blockedMissed++;
    const topicIdx = blockedTopics.indexOf(blockedTestTitles[i].topic) + 1;
    const mark = correct ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    const label = SHOW_BLOCKED
      ? `"${blockedTestTitles[i].title}"`
      : `[Topic ${topicIdx}] test #${i + 1}`;
    console.log(`    ${mark} ${label} → ${status}`);
  }

  const total = SAFE_TITLES.length + blockedTestTitles.length;
  const correct = safeCorrect + blockedCorrect;
  const pct = total > 0 ? ((correct / total) * 100).toFixed(1) : "0.0";

  console.log(`\n  ── Results ──`);
  console.log(`    Safe:    ${safeCorrect}/${SAFE_TITLES.length} correct` +
    (safeFalseBlock > 0 ? ` (${safeFalseBlock} false blocks)` : ""));
  console.log(`    Blocked: ${blockedCorrect}/${blockedTestTitles.length} correct` +
    (blockedMissed > 0 ? ` (${blockedMissed} missed!)` : ""));
  console.log(`    Overall: ${correct}/${total} (${pct}%)`);
  console.log(`    Tokens:  ${result.promptTokens} prompt + ${result.completionTokens} completion\n`);

  if (blockedMissed > 0) {
    console.log(`  \x1b[31m⚠ ${blockedMissed} blocked title(s) were NOT caught by the classifier!\x1b[0m`);
  }
  if (safeFalseBlock > 0) {
    console.log(`  \x1b[33m⚠ ${safeFalseBlock} safe title(s) were incorrectly blocked (false positives).\x1b[0m`);
  }
  if (blockedMissed === 0 && safeFalseBlock === 0) {
    console.log(`  \x1b[32m✓ All classifications correct.\x1b[0m`);
  }
  console.log();

  process.exit(blockedMissed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\n  Test failed: ${err.message}\n`);
  process.exit(1);
});
