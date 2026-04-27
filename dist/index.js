// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// src/sessions.ts
import { join } from "path";
import { unlink, readdir, rename } from "fs/promises";
async function loadSession() {
  if (current)
    return current;
  try {
    current = await Bun.file(SESSION_FILE).json();
    return current;
  } catch {
    return null;
  }
}
async function saveSession(session) {
  current = session;
  await Bun.write(SESSION_FILE, JSON.stringify(session, null, 2) + `
`);
}
async function getSession() {
  const existing = await loadSession();
  if (existing) {
    if (typeof existing.turnCount !== "number")
      existing.turnCount = 0;
    if (typeof existing.compactWarned !== "boolean")
      existing.compactWarned = false;
    existing.lastUsedAt = new Date().toISOString();
    await saveSession(existing);
    return { sessionId: existing.sessionId, turnCount: existing.turnCount, compactWarned: existing.compactWarned };
  }
  return null;
}
async function createSession(sessionId) {
  await saveSession({
    sessionId,
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    turnCount: 0,
    compactWarned: false
  });
}
async function peekSession() {
  return await loadSession();
}
async function incrementTurn() {
  const existing = await loadSession();
  if (!existing)
    return 0;
  if (typeof existing.turnCount !== "number")
    existing.turnCount = 0;
  existing.turnCount += 1;
  await saveSession(existing);
  return existing.turnCount;
}
async function markCompactWarned() {
  const existing = await loadSession();
  if (!existing)
    return;
  existing.compactWarned = true;
  await saveSession(existing);
}
async function resetSession() {
  current = null;
  try {
    await unlink(SESSION_FILE);
  } catch {}
}
async function backupSession() {
  const existing = await loadSession();
  if (!existing)
    return null;
  let files;
  try {
    files = await readdir(HEARTBEAT_DIR);
  } catch {
    files = [];
  }
  const indices = files.filter((f) => /^session_\d+\.backup$/.test(f)).map((f) => Number(f.match(/^session_(\d+)\.backup$/)[1]));
  const nextIndex = indices.length > 0 ? Math.max(...indices) + 1 : 1;
  const backupName = `session_${nextIndex}.backup`;
  const backupPath = join(HEARTBEAT_DIR, backupName);
  await rename(SESSION_FILE, backupPath);
  current = null;
  return backupName;
}
var HEARTBEAT_DIR, SESSION_FILE, current = null;
var init_sessions = __esm(() => {
  HEARTBEAT_DIR = join(process.cwd(), ".claude", "claudeclaw");
  SESSION_FILE = join(HEARTBEAT_DIR, "session.json");
});

// src/sessionManager.ts
import { join as join2 } from "path";
async function loadSessions() {
  if (sessionsCache)
    return sessionsCache;
  try {
    sessionsCache = await Bun.file(SESSIONS_FILE).json();
    return sessionsCache;
  } catch {
    sessionsCache = { threads: {} };
    return sessionsCache;
  }
}
async function saveSessions(data) {
  sessionsCache = data;
  await Bun.write(SESSIONS_FILE, JSON.stringify(data, null, 2) + `
`);
}
async function getThreadSession(threadId) {
  const data = await loadSessions();
  const session = data.threads[threadId];
  if (!session)
    return null;
  if (typeof session.turnCount !== "number")
    session.turnCount = 0;
  if (typeof session.compactWarned !== "boolean")
    session.compactWarned = false;
  session.lastUsedAt = new Date().toISOString();
  await saveSessions(data);
  return {
    sessionId: session.sessionId,
    turnCount: session.turnCount,
    compactWarned: session.compactWarned
  };
}
async function createThreadSession(threadId, sessionId) {
  const data = await loadSessions();
  data.threads[threadId] = {
    sessionId,
    threadId,
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    turnCount: 0,
    compactWarned: false
  };
  await saveSessions(data);
}
async function removeThreadSession(threadId) {
  const data = await loadSessions();
  if (!data.threads[threadId])
    return;
  delete data.threads[threadId];
  await saveSessions(data);
}
async function incrementThreadTurn(threadId) {
  const data = await loadSessions();
  const session = data.threads[threadId];
  if (!session)
    return 0;
  if (typeof session.turnCount !== "number")
    session.turnCount = 0;
  session.turnCount += 1;
  await saveSessions(data);
  return session.turnCount;
}
async function markThreadCompactWarned(threadId) {
  const data = await loadSessions();
  const session = data.threads[threadId];
  if (!session)
    return;
  session.compactWarned = true;
  await saveSessions(data);
}
var HEARTBEAT_DIR2, SESSIONS_FILE, sessionsCache = null;
var init_sessionManager = __esm(() => {
  HEARTBEAT_DIR2 = join2(process.cwd(), ".claude", "claudeclaw");
  SESSIONS_FILE = join2(HEARTBEAT_DIR2, "sessions.json");
});

// src/timezone.ts
function pad2(value) {
  return String(value).padStart(2, "0");
}
function clampTimezoneOffsetMinutes(value) {
  if (!Number.isFinite(value))
    return 0;
  return Math.max(MIN_OFFSET_MINUTES, Math.min(MAX_OFFSET_MINUTES, Math.round(value)));
}
function parseUtcOffsetMinutes(value) {
  if (typeof value !== "string")
    return null;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  if (normalized === "UTC" || normalized === "GMT")
    return 0;
  const match = normalized.match(/^(UTC|GMT)([+-])(\d{1,2})(?::?([0-5]\d))?$/);
  if (!match)
    return null;
  const sign = match[2] === "-" ? -1 : 1;
  const hours = Number(match[3]);
  const minutes = Number(match[4] ?? "0");
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 14)
    return null;
  const total = sign * (hours * 60 + minutes);
  return total < MIN_OFFSET_MINUTES || total > MAX_OFFSET_MINUTES ? null : total;
}
function normalizeTimezoneName(value) {
  if (typeof value !== "string")
    return "";
  const trimmed = value.trim();
  if (!trimmed)
    return "";
  const parsedOffset = parseUtcOffsetMinutes(trimmed);
  if (parsedOffset != null)
    return trimmed.toUpperCase().replace(/\s+/g, "");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date);
    return trimmed;
  } catch {
    return "";
  }
}
function resolveTimezoneOffsetMinutes(value, timezoneFallback) {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (Number.isFinite(n))
    return clampTimezoneOffsetMinutes(n);
  const parsedFallback = parseUtcOffsetMinutes(timezoneFallback);
  if (parsedFallback != null)
    return parsedFallback;
  const ianaFallback = getCurrentOffsetMinutesForIanaTimezone(timezoneFallback);
  return ianaFallback == null ? 0 : ianaFallback;
}
function shiftDateToOffset(date, timezoneOffsetMinutes) {
  return new Date(date.getTime() + clampTimezoneOffsetMinutes(timezoneOffsetMinutes) * 60000);
}
function formatUtcOffsetLabel(timezoneOffsetMinutes) {
  const clamped = clampTimezoneOffsetMinutes(timezoneOffsetMinutes);
  const sign = clamped >= 0 ? "+" : "-";
  const abs = Math.abs(clamped);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return minutes === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${pad2(minutes)}`;
}
function buildClockPromptPrefix(date, timezoneOffsetMinutes) {
  const shifted = shiftDateToOffset(date, timezoneOffsetMinutes);
  const offsetLabel = formatUtcOffsetLabel(timezoneOffsetMinutes);
  const timestamp = [
    `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`,
    `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}:${pad2(shifted.getUTCSeconds())}`
  ].join(" ");
  return `[${timestamp} ${offsetLabel}]`;
}
function getDayAndMinuteAtOffset(date, timezoneOffsetMinutes) {
  const shifted = shiftDateToOffset(date, timezoneOffsetMinutes);
  return {
    day: shifted.getUTCDay(),
    minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  };
}
function getCurrentOffsetMinutesForIanaTimezone(timezone) {
  if (typeof timezone !== "string" || !timezone.trim())
    return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
      hour: "2-digit"
    }).formatToParts(new Date);
    const token = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    const match = token.match(/^GMT([+-])(\d{1,2})(?::?([0-5]\d))?$/i);
    if (!match)
      return null;
    const sign = match[1] === "-" ? -1 : 1;
    const hours = Number(match[2]);
    const minutes = Number(match[3] ?? "0");
    if (!Number.isFinite(hours) || !Number.isFinite(minutes))
      return null;
    return clampTimezoneOffsetMinutes(sign * (hours * 60 + minutes));
  } catch {
    return null;
  }
}
var MIN_OFFSET_MINUTES, MAX_OFFSET_MINUTES;
var init_timezone = __esm(() => {
  MIN_OFFSET_MINUTES = -12 * 60;
  MAX_OFFSET_MINUTES = 14 * 60;
});

// src/config.ts
import { join as join3, isAbsolute } from "path";
import { mkdir } from "fs/promises";
import { existsSync } from "fs";
async function initConfig() {
  await mkdir(HEARTBEAT_DIR3, { recursive: true });
  await mkdir(JOBS_DIR, { recursive: true });
  await mkdir(LOGS_DIR, { recursive: true });
  if (!existsSync(SETTINGS_FILE)) {
    await Bun.write(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2) + `
`);
  }
}
function parseAgenticMode(raw) {
  if (!raw || typeof raw !== "object")
    return null;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const model = typeof raw.model === "string" ? raw.model.trim() : "";
  if (!name || !model)
    return null;
  const keywords = Array.isArray(raw.keywords) ? raw.keywords.filter((k) => typeof k === "string").map((k) => k.toLowerCase().trim()) : [];
  const phrases = Array.isArray(raw.phrases) ? raw.phrases.filter((p) => typeof p === "string").map((p) => p.toLowerCase().trim()) : undefined;
  return { name, model, keywords, ...phrases && phrases.length > 0 ? { phrases } : {} };
}
function parseAgenticConfig(raw) {
  const defaults = DEFAULT_SETTINGS.agentic;
  if (!raw || typeof raw !== "object")
    return defaults;
  const enabled = raw.enabled ?? false;
  if (!Array.isArray(raw.modes) && (("planningModel" in raw) || ("implementationModel" in raw))) {
    const planningModel = typeof raw.planningModel === "string" ? raw.planningModel.trim() : "opus";
    const implModel = typeof raw.implementationModel === "string" ? raw.implementationModel.trim() : "sonnet";
    return {
      enabled,
      defaultMode: "implementation",
      modes: [
        { ...defaults.modes[0], model: planningModel },
        { ...defaults.modes[1], model: implModel }
      ]
    };
  }
  const modes = [];
  if (Array.isArray(raw.modes)) {
    for (const m of raw.modes) {
      const parsed = parseAgenticMode(m);
      if (parsed)
        modes.push(parsed);
    }
  }
  return {
    enabled,
    defaultMode: typeof raw.defaultMode === "string" ? raw.defaultMode.trim() : "implementation",
    modes: modes.length > 0 ? modes : defaults.modes
  };
}
function parseSettings(raw, discordUserIds) {
  const rawLevel = raw.security?.level;
  const level = typeof rawLevel === "string" && VALID_LEVELS.has(rawLevel) ? rawLevel : "moderate";
  const parsedTimezone = parseTimezone(raw.timezone);
  return {
    model: typeof raw.model === "string" ? raw.model.trim() : "",
    api: typeof raw.api === "string" ? raw.api.trim() : "",
    fallback: {
      model: typeof raw.fallback?.model === "string" ? raw.fallback.model.trim() : "",
      api: typeof raw.fallback?.api === "string" ? raw.fallback.api.trim() : ""
    },
    agentic: parseAgenticConfig(raw.agentic),
    timezone: parsedTimezone,
    timezoneOffsetMinutes: parseTimezoneOffsetMinutes(raw.timezoneOffsetMinutes, parsedTimezone),
    heartbeat: {
      enabled: raw.heartbeat?.enabled ?? false,
      interval: raw.heartbeat?.interval ?? 15,
      prompt: raw.heartbeat?.prompt ?? "",
      excludeWindows: parseExcludeWindows(raw.heartbeat?.excludeWindows),
      forwardToTelegram: raw.heartbeat?.forwardToTelegram ?? false
    },
    telegram: {
      token: raw.telegram?.token ?? "",
      allowedUserIds: raw.telegram?.allowedUserIds ?? []
    },
    discord: {
      token: typeof raw.discord?.token === "string" ? raw.discord.token.trim() : "",
      allowedUserIds: discordUserIds && discordUserIds.length > 0 ? discordUserIds : Array.isArray(raw.discord?.allowedUserIds) ? raw.discord.allowedUserIds.map(String) : [],
      listenChannels: Array.isArray(raw.discord?.listenChannels) ? raw.discord.listenChannels.map(String) : []
    },
    security: {
      level,
      allowedTools: Array.isArray(raw.security?.allowedTools) ? raw.security.allowedTools : [],
      disallowedTools: Array.isArray(raw.security?.disallowedTools) ? raw.security.disallowedTools : []
    },
    web: {
      enabled: raw.web?.enabled ?? false,
      host: raw.web?.host ?? "127.0.0.1",
      port: Number.isFinite(raw.web?.port) ? Number(raw.web.port) : 4632
    },
    stt: {
      baseUrl: typeof raw.stt?.baseUrl === "string" ? raw.stt.baseUrl.trim() : "",
      model: typeof raw.stt?.model === "string" ? raw.stt.model.trim() : ""
    }
  };
}
function parseTimezone(value) {
  return normalizeTimezoneName(value);
}
function parseExcludeWindows(value) {
  if (!Array.isArray(value))
    return [];
  const out = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object")
      continue;
    const start = typeof entry.start === "string" ? entry.start.trim() : "";
    const end = typeof entry.end === "string" ? entry.end.trim() : "";
    if (!TIME_RE.test(start) || !TIME_RE.test(end))
      continue;
    const rawDays = Array.isArray(entry.days) ? entry.days : [];
    const parsedDays = rawDays.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    const uniqueDays = Array.from(new Set(parsedDays)).sort((a, b) => a - b);
    out.push({
      start,
      end,
      days: uniqueDays.length > 0 ? uniqueDays : [...ALL_DAYS]
    });
  }
  return out;
}
function parseTimezoneOffsetMinutes(value, timezoneFallback) {
  return resolveTimezoneOffsetMinutes(value, timezoneFallback);
}
function extractDiscordUserIds(rawText) {
  const discordBlock = rawText.match(/"discord"\s*:\s*\{[\s\S]*?\}/);
  if (!discordBlock)
    return [];
  const arrayMatch = discordBlock[0].match(/"allowedUserIds"\s*:\s*\[([\s\S]*?)\]/);
  if (!arrayMatch)
    return [];
  const items = [];
  for (const m of arrayMatch[1].matchAll(/("(\d+)"|(\d+))/g)) {
    items.push(m[2] ?? m[3]);
  }
  return items;
}
async function loadSettings() {
  if (cached)
    return cached;
  const rawText = await Bun.file(SETTINGS_FILE).text();
  const raw = JSON.parse(rawText);
  cached = parseSettings(raw, extractDiscordUserIds(rawText));
  return cached;
}
async function reloadSettings() {
  const rawText = await Bun.file(SETTINGS_FILE).text();
  const raw = JSON.parse(rawText);
  cached = parseSettings(raw, extractDiscordUserIds(rawText));
  return cached;
}
function getSettings() {
  if (!cached)
    throw new Error("Settings not loaded. Call loadSettings() first.");
  return cached;
}
async function resolvePrompt(prompt) {
  const trimmed = prompt.trim();
  if (!trimmed)
    return trimmed;
  const isPath = PROMPT_EXTENSIONS.some((ext) => trimmed.endsWith(ext));
  if (!isPath)
    return trimmed;
  const resolved = isAbsolute(trimmed) ? trimmed : join3(process.cwd(), trimmed);
  try {
    const content = await Bun.file(resolved).text();
    return content.trim();
  } catch {
    console.warn(`[config] Prompt path "${trimmed}" not found, using as literal string`);
    return trimmed;
  }
}
var HEARTBEAT_DIR3, SETTINGS_FILE, JOBS_DIR, LOGS_DIR, DEFAULT_SETTINGS, cached = null, VALID_LEVELS, TIME_RE, ALL_DAYS, PROMPT_EXTENSIONS;
var init_config = __esm(() => {
  init_timezone();
  HEARTBEAT_DIR3 = join3(process.cwd(), ".claude", "claudeclaw");
  SETTINGS_FILE = join3(HEARTBEAT_DIR3, "settings.json");
  JOBS_DIR = join3(HEARTBEAT_DIR3, "jobs");
  LOGS_DIR = join3(HEARTBEAT_DIR3, "logs");
  DEFAULT_SETTINGS = {
    model: "",
    api: "",
    fallback: {
      model: "",
      api: ""
    },
    agentic: {
      enabled: false,
      defaultMode: "implementation",
      modes: [
        {
          name: "planning",
          model: "opus",
          keywords: [
            "plan",
            "design",
            "architect",
            "strategy",
            "approach",
            "research",
            "investigate",
            "analyze",
            "explore",
            "understand",
            "think",
            "consider",
            "evaluate",
            "assess",
            "review",
            "system design",
            "trade-off",
            "decision",
            "choose",
            "compare",
            "brainstorm",
            "ideate",
            "concept",
            "proposal"
          ],
          phrases: [
            "how to implement",
            "how should i",
            "what's the best way to",
            "should i",
            "which approach",
            "help me decide",
            "help me understand"
          ]
        },
        {
          name: "implementation",
          model: "sonnet",
          keywords: [
            "implement",
            "code",
            "write",
            "create",
            "build",
            "add",
            "fix",
            "debug",
            "refactor",
            "update",
            "modify",
            "change",
            "deploy",
            "run",
            "execute",
            "install",
            "configure",
            "test",
            "commit",
            "push",
            "merge",
            "release",
            "generate",
            "scaffold",
            "setup",
            "initialize"
          ]
        }
      ]
    },
    timezone: "UTC",
    timezoneOffsetMinutes: 0,
    heartbeat: {
      enabled: false,
      interval: 15,
      prompt: "",
      excludeWindows: [],
      forwardToTelegram: true
    },
    telegram: { token: "", allowedUserIds: [] },
    discord: { token: "", allowedUserIds: [], listenChannels: [] },
    security: { level: "moderate", allowedTools: [], disallowedTools: [] },
    web: { enabled: false, host: "127.0.0.1", port: 4632 },
    stt: { baseUrl: "", model: "" }
  };
  VALID_LEVELS = new Set([
    "locked",
    "strict",
    "moderate",
    "unrestricted"
  ]);
  TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
  PROMPT_EXTENSIONS = [".md", ".txt", ".prompt"];
});

// src/model-router.ts
function classifyTask(prompt, modes, defaultMode) {
  const normalized = prompt.toLowerCase().trim();
  for (const mode of modes) {
    if (!mode.phrases)
      continue;
    for (const phrase of mode.phrases) {
      if (normalized.includes(phrase)) {
        return {
          mode: mode.name,
          model: mode.model,
          confidence: 0.95,
          reasoning: `Matched phrase "${phrase}" \u2192 ${mode.name}`
        };
      }
    }
  }
  const scores = modes.map((mode) => {
    let score = 0;
    for (const keyword of mode.keywords) {
      if (normalized.includes(keyword))
        score++;
    }
    return { mode, score };
  });
  const questionMarks = (normalized.match(/\?/g) || []).length;
  if (questionMarks > 0) {
    for (const entry of scores) {
      if (entry.mode.phrases && entry.mode.phrases.length > 0) {
        entry.score += questionMarks * 0.5;
      }
    }
  }
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const second = scores[1];
  if (top && top.score > 0) {
    if (!second || top.score > second.score) {
      const diff = second ? top.score - second.score : top.score;
      const confidence = Math.min(0.9, 0.6 + diff * 0.1);
      return {
        mode: top.mode.name,
        model: top.mode.model,
        confidence,
        reasoning: `${top.mode.name}: ${top.score}${second ? `, ${second.mode.name}: ${second.score}` : ""}`
      };
    }
    const tied = scores.filter((s) => s.score === top.score);
    const tiedFallback = tied.find((s) => s.mode.name === defaultMode) ?? top;
    return {
      mode: tiedFallback.mode.name,
      model: tiedFallback.mode.model,
      confidence: 0.6,
      reasoning: `Tie between ${tied.map((s) => s.mode.name).join(", ")} (score: ${top.score}), using ${tiedFallback.mode.name}`
    };
  }
  const fallback = modes.find((m) => m.name === defaultMode) ?? modes[0];
  if (!fallback) {
    return { mode: "unknown", model: "", confidence: 0, reasoning: "No modes configured" };
  }
  return {
    mode: fallback.name,
    model: fallback.model,
    confidence: 0.5,
    reasoning: `Ambiguous prompt, defaulting to ${fallback.name}`
  };
}
function selectModel(prompt, modes, defaultMode) {
  const classification = classifyTask(prompt, modes, defaultMode);
  return {
    model: classification.model,
    taskType: classification.mode,
    reasoning: classification.reasoning
  };
}

// src/runner.ts
import { spawn as nodeSpawn } from "child_process";
import { mkdir as mkdir2, readFile, writeFile } from "fs/promises";
import { join as join4 } from "path";
import { existsSync as existsSync2 } from "fs";
function emitCompactEvent(event) {
  for (const listener of compactListeners) {
    try {
      listener(event);
    } catch {}
  }
}
function enqueue(fn, threadId) {
  if (threadId) {
    const current2 = threadQueues.get(threadId) ?? Promise.resolve();
    const task2 = current2.then(fn, fn);
    threadQueues.set(threadId, task2.catch(() => {}));
    return task2;
  }
  const task = globalQueue.then(fn, fn);
  globalQueue = task.catch(() => {});
  return task;
}
function extractRateLimitMessage(stdout, stderr) {
  const candidates = [stdout, stderr];
  for (const text of candidates) {
    const trimmed = text.trim();
    if (trimmed && RATE_LIMIT_PATTERN.test(trimmed))
      return trimmed;
  }
  return null;
}
function sameModelConfig(a, b) {
  return a.model.trim().toLowerCase() === b.model.trim().toLowerCase() && a.api.trim() === b.api.trim();
}
function hasModelConfig(value) {
  return value.model.trim().length > 0 || value.api.trim().length > 0;
}
function isNotFoundError(error) {
  if (!error || typeof error !== "object")
    return false;
  const code = error.code;
  if (code === "ENOENT")
    return true;
  const message = String(error.message ?? "");
  return /enoent|no such file or directory/i.test(message);
}
function buildChildEnv(baseEnv, model, api) {
  const childEnv = { ...baseEnv };
  const normalizedModel = model.trim().toLowerCase();
  if (api.trim()) {
    childEnv.ANTHROPIC_AUTH_TOKEN = api.trim();
    childEnv.CLAUDE_CODE_OAUTH_TOKEN = api.trim();
  }
  if (normalizedModel === "glm") {
    childEnv.ANTHROPIC_BASE_URL = "https://api.z.ai/api/anthropic";
    childEnv.API_TIMEOUT_MS = "3000000";
  }
  return childEnv;
}
async function runClaudeOnce(baseArgs, model, api, baseEnv, timeoutMs = CLAUDE_TIMEOUT_MS) {
  const args = [...baseArgs];
  const normalizedModel = model.trim().toLowerCase();
  if (model.trim() && normalizedModel !== "glm")
    args.push("--model", model.trim());
  console.log(`[SPAWN-NODE] args count: ${args.length}, append-prompt-len: ${args[args.indexOf("--append-system-prompt") + 1]?.length || 0}`);
  const childEnv = buildChildEnv(baseEnv, model, api);
  const [cmd, ...spawnArgs] = args;
  return new Promise((resolve) => {
    const proc = nodeSpawn(cmd, spawnArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv
    });
    let rawStdout = "";
    let stderr = "";
    let settled = false;
    proc.stdout.on("data", (chunk) => {
      rawStdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          proc.kill("SIGTERM");
        } catch {}
        setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {}
        }, 5000);
        console.error(`[${new Date().toLocaleTimeString()}] Claude session timed out after ${timeoutMs / 1000}s`);
        resolve({ rawStdout: "", stderr: "timeout", exitCode: 124 });
      }
    }, timeoutMs);
    proc.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const finalCode = code ?? 1;
        console.log(`[${new Date().toLocaleTimeString()}] node-spawn exit=${finalCode}, stdout=${rawStdout.length}, stderr=${stderr.slice(0, 500)}`);
        resolve({ rawStdout, stderr, exitCode: finalCode });
      }
    });
    proc.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        console.error(`[${new Date().toLocaleTimeString()}] spawn error: ${err.message}`);
        resolve({ rawStdout: "", stderr: err.message, exitCode: 124 });
      }
    });
  });
}
async function ensureProjectClaudeMd() {
  if (existsSync2(PROJECT_CLAUDE_MD))
    return;
  const promptContent = (await loadPrompts()).trim();
  const managedBlock = [
    CLAUDECLAW_BLOCK_START,
    promptContent,
    CLAUDECLAW_BLOCK_END
  ].join(`
`);
  let content = "";
  if (existsSync2(LEGACY_PROJECT_CLAUDE_MD)) {
    try {
      const legacy = await readFile(LEGACY_PROJECT_CLAUDE_MD, "utf8");
      content = legacy.trim();
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] Failed to read legacy .claude/CLAUDE.md:`, e);
      return;
    }
  }
  const normalized = content.trim();
  const hasManagedBlock = normalized.includes(CLAUDECLAW_BLOCK_START) && normalized.includes(CLAUDECLAW_BLOCK_END);
  const managedPattern = new RegExp(`${CLAUDECLAW_BLOCK_START}[\\s\\S]*?${CLAUDECLAW_BLOCK_END}`, "m");
  const merged = hasManagedBlock ? `${normalized.replace(managedPattern, managedBlock)}
` : normalized ? `${normalized}

${managedBlock}
` : `${managedBlock}
`;
  try {
    await writeFile(PROJECT_CLAUDE_MD, merged, "utf8");
  } catch (e) {
    console.error(`[${new Date().toLocaleTimeString()}] Failed to write project CLAUDE.md:`, e);
  }
}
function buildSecurityArgs(security) {
  const args = ["--dangerously-skip-permissions"];
  switch (security.level) {
    case "locked":
      args.push("--tools", "Read,Grep,Glob");
      break;
    case "strict":
      args.push("--disallowedTools", "Bash,WebSearch,WebFetch");
      break;
    case "moderate":
      break;
    case "unrestricted":
      break;
  }
  if (security.allowedTools.length > 0) {
    args.push("--allowedTools", security.allowedTools.join(" "));
  }
  if (security.disallowedTools.length > 0) {
    args.push("--disallowedTools", security.disallowedTools.join(" "));
  }
  return args;
}
async function loadPrompts() {
  const selectedPromptFiles = [
    join4(PROMPTS_DIR, "IDENTITY.md"),
    join4(PROMPTS_DIR, "USER.md"),
    join4(PROMPTS_DIR, "SOUL.md")
  ];
  const parts = [];
  for (const file of selectedPromptFiles) {
    try {
      const content = await Bun.file(file).text();
      if (content.trim())
        parts.push(content.trim());
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] Failed to read prompt file ${file}:`, e);
    }
  }
  return parts.join(`

`);
}
async function loadHeartbeatPromptTemplate() {
  const projectOverride = join4(PROJECT_PROMPTS_DIR, "HEARTBEAT.md");
  for (const file of [projectOverride, HEARTBEAT_PROMPT_FILE]) {
    try {
      const content = await Bun.file(file).text();
      if (content.trim())
        return content.trim();
    } catch (e) {
      if (!isNotFoundError(e)) {
        console.warn(`[${new Date().toLocaleTimeString()}] Failed to read heartbeat prompt file ${file}:`, e);
      }
    }
  }
  return "";
}
async function runCompact(sessionId, model, api, baseEnv, securityArgs, timeoutMs) {
  const compactArgs = [
    "claude",
    "-p",
    "/compact",
    "--output-format",
    "text",
    "--resume",
    sessionId,
    ...securityArgs
  ];
  console.log(`[${new Date().toLocaleTimeString()}] Running /compact on session ${sessionId.slice(0, 8)}...`);
  const result = await runClaudeOnce(compactArgs, model, api, baseEnv, timeoutMs);
  const success = result.exitCode === 0;
  console.log(`[${new Date().toLocaleTimeString()}] Compact ${success ? "succeeded" : `failed (exit ${result.exitCode})`}`);
  return success;
}
async function compactCurrentSession() {
  const existing = await getSession();
  if (!existing)
    return { success: false, message: "No active session to compact." };
  const settings = getSettings();
  const securityArgs = buildSecurityArgs(settings.security);
  const { CLAUDECODE: _, ...cleanEnv } = process.env;
  const baseEnv = { ...cleanEnv };
  const timeoutMs = settings.sessionTimeoutMs || CLAUDE_TIMEOUT_MS;
  const ok = await runCompact(existing.sessionId, settings.model, settings.api, baseEnv, securityArgs, timeoutMs);
  return ok ? { success: true, message: `\u2705 Session compact complete (${existing.sessionId.slice(0, 8)})` } : { success: false, message: `\u274C Compact failed (${existing.sessionId.slice(0, 8)})` };
}
async function execClaude(name, prompt, threadId) {
  await mkdir2(LOGS_DIR2, { recursive: true });
  const existing = threadId ? await getThreadSession(threadId) : await getSession();
  const isNew = !existing;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = join4(LOGS_DIR2, `${name}-${timestamp}.log`);
  const settings = getSettings();
  const { security, model, api, fallback, agentic } = settings;
  let primaryConfig;
  let taskType = "unknown";
  let routingReasoning = "";
  if (agentic.enabled) {
    const routing = selectModel(prompt, agentic.modes, agentic.defaultMode);
    primaryConfig = { model: routing.model, api };
    taskType = routing.taskType;
    routingReasoning = routing.reasoning;
    console.log(`[${new Date().toLocaleTimeString()}] Agentic routing: ${routing.taskType} \u2192 ${routing.model} (${routing.reasoning})`);
  } else {
    primaryConfig = { model, api };
  }
  const fallbackConfig = {
    model: fallback?.model ?? "",
    api: fallback?.api ?? ""
  };
  const securityArgs = buildSecurityArgs(security);
  const timeoutMs = settings.sessionTimeoutMs || CLAUDE_TIMEOUT_MS;
  console.log(`[${new Date().toLocaleTimeString()}] Running: ${name} (${isNew ? "new session" : `resume ${existing.sessionId.slice(0, 8)}`}, security: ${security.level})`);
  const outputFormat = "json";
  const args = ["claude", "-p", prompt, "--output-format", outputFormat, ...securityArgs];
  if (!isNew) {
    args.push("--resume", existing.sessionId);
  }
  const promptContent = await loadPrompts();
  const appendParts = [
    "You are running inside ClaudeClaw."
  ];
  if (promptContent)
    appendParts.push(promptContent);
  if (existsSync2(PROJECT_CLAUDE_MD)) {
    try {
      const claudeMd = await Bun.file(PROJECT_CLAUDE_MD).text();
      if (claudeMd.trim())
        appendParts.push(claudeMd.trim());
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] Failed to read project CLAUDE.md:`, e);
    }
  }
  if (security.level !== "unrestricted")
    appendParts.push(DIR_SCOPE_PROMPT);
  if (appendParts.length > 0) {
    args.push("--append-system-prompt", appendParts.join(`

`));
  }
  const { CLAUDECODE: _, ...cleanEnv } = process.env;
  const baseEnv = { ...cleanEnv };
  let exec = await runClaudeOnce(args, primaryConfig.model, primaryConfig.api, baseEnv, timeoutMs);
  const primaryRateLimit = extractRateLimitMessage(exec.rawStdout, exec.stderr);
  let usedFallback = false;
  if (primaryRateLimit && hasModelConfig(fallbackConfig) && !sameModelConfig(primaryConfig, fallbackConfig)) {
    console.warn(`[${new Date().toLocaleTimeString()}] Claude limit reached; retrying with fallback${fallbackConfig.model ? ` (${fallbackConfig.model})` : ""}...`);
    exec = await runClaudeOnce(args, fallbackConfig.model, fallbackConfig.api, baseEnv, timeoutMs);
    usedFallback = true;
  }
  const rawStdout = exec.rawStdout;
  const stderr = exec.stderr;
  let exitCode = exec.exitCode;
  let stdout = rawStdout;
  let sessionId = existing?.sessionId ?? "unknown";
  const rateLimitMessage = extractRateLimitMessage(rawStdout, stderr);
  if (rateLimitMessage) {
    stdout = rateLimitMessage;
  }
  const looksLikeJsonResult = rawStdout.trimStart().startsWith("{") && rawStdout.includes('"session_id"');
  if (!rateLimitMessage && (exitCode === 0 || looksLikeJsonResult)) {
    try {
      const json = JSON.parse(rawStdout);
      if (json.session_id) {
        sessionId = json.session_id;
        stdout = json.result ?? "";
        if (!json.is_error) {
          exitCode = 0;
        }
        if (threadId) {
          await createThreadSession(threadId, sessionId);
          console.log(`[${new Date().toLocaleTimeString()}] Thread session created: ${sessionId} (thread ${threadId.slice(0, 8)})`);
        } else {
          await createSession(sessionId);
          console.log(`[${new Date().toLocaleTimeString()}] Session created: ${sessionId}`);
        }
      }
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] Failed to parse session from Claude output:`, e);
    }
  }
  if (exitCode !== 0 && stdout.trim() && !stderr.trim() && !rateLimitMessage) {
    console.log(`[${new Date().toLocaleTimeString()}] Overriding exit code ${exitCode} \u2192 0 (stdout present, no stderr)`);
    exitCode = 0;
  }
  const result = {
    stdout,
    stderr,
    exitCode
  };
  const output = [
    `# ${name}`,
    `Date: ${new Date().toISOString()}`,
    `Session: ${sessionId} (${isNew ? "new" : "resumed"})`,
    `Model config: ${usedFallback ? "fallback" : "primary"}`,
    ...agentic.enabled ? [`Task type: ${taskType}`, `Routing: ${routingReasoning}`] : [],
    `Prompt: ${prompt}`,
    `Exit code: ${result.exitCode}`,
    "",
    "## Output",
    stdout,
    ...stderr ? ["## Stderr", stderr] : []
  ].join(`
`);
  await Bun.write(logFile, output);
  console.log(`[${new Date().toLocaleTimeString()}] Done: ${name} \u2192 ${logFile}`);
  console.log(`[${new Date().toLocaleTimeString()}] Post-run: isNew=${isNew}, exitCode=${exitCode}, stdoutLen=${stdout.length}, stdoutTrimmed="${stdout.trim().slice(0, 50)}", stderrLen=${stderr.length}`);
  if (!isNew && exitCode !== 0 && !stdout.trim()) {
    console.log(`[${new Date().toLocaleTimeString()}] Resume failed (exit ${exitCode}, no output) \u2014 nuking session and retrying as new`);
    if (threadId) {
      await removeThreadSession(threadId);
    } else {
      await resetSession();
    }
    const freshArgs = ["claude", "-p", prompt, "--output-format", "json", ...securityArgs];
    if (appendParts.length > 0) {
      freshArgs.push("--append-system-prompt", appendParts.join(`

`));
    }
    const freshExec = await runClaudeOnce(freshArgs, primaryConfig.model, primaryConfig.api, baseEnv, timeoutMs);
    let freshStdout = freshExec.rawStdout;
    let freshExitCode = freshExec.exitCode;
    let freshSessionId = "unknown";
    const freshLooksLikeJson = freshStdout.trimStart().startsWith("{") && freshStdout.includes('"session_id"');
    if (freshExitCode === 0 || freshLooksLikeJson) {
      try {
        const json = JSON.parse(freshStdout);
        if (json.session_id) {
          freshSessionId = json.session_id;
          freshStdout = json.result ?? "";
          if (!json.is_error)
            freshExitCode = 0;
          if (threadId) {
            await createThreadSession(threadId, freshSessionId);
          } else {
            await createSession(freshSessionId);
          }
          console.log(`[${new Date().toLocaleTimeString()}] Auto-recovery: new session ${freshSessionId}`);
        }
      } catch (e) {
        console.error(`[${new Date().toLocaleTimeString()}] Auto-recovery JSON parse failed:`, e);
      }
    }
    if (freshExitCode !== 0 && freshStdout.trim() && !freshExec.stderr.trim()) {
      freshExitCode = 0;
    }
    return { stdout: freshStdout, stderr: freshExec.stderr, exitCode: freshExitCode };
  }
  if (COMPACT_TIMEOUT_ENABLED && exitCode === 124 && !isNew && existing) {
    emitCompactEvent({ type: "auto-compact-start" });
    const compactOk = await runCompact(existing.sessionId, primaryConfig.model, primaryConfig.api, baseEnv, securityArgs, timeoutMs);
    emitCompactEvent({ type: "auto-compact-done", success: compactOk });
    if (compactOk) {
      console.log(`[${new Date().toLocaleTimeString()}] Retrying ${name} after compact...`);
      const retryExec = await runClaudeOnce(args, primaryConfig.model, primaryConfig.api, baseEnv, timeoutMs);
      const retryResult = {
        stdout: retryExec.rawStdout,
        stderr: retryExec.stderr,
        exitCode: retryExec.exitCode
      };
      emitCompactEvent({
        type: "auto-compact-retry",
        success: retryExec.exitCode === 0,
        stdout: retryResult.stdout,
        stderr: retryResult.stderr,
        exitCode: retryResult.exitCode
      });
      if (retryExec.exitCode === 0) {
        const count = threadId ? await incrementThreadTurn(threadId) : await incrementTurn();
        console.log(`[${new Date().toLocaleTimeString()}] Turn count: ${count} (after compact + retry)`);
      }
      return retryResult;
    }
  }
  if (exitCode === 0 && !isNew) {
    const turnCount = threadId ? await incrementThreadTurn(threadId) : await incrementTurn();
    console.log(`[${new Date().toLocaleTimeString()}] Turn count: ${turnCount}${threadId ? ` (thread ${threadId.slice(0, 8)})` : ""}`);
    if (turnCount >= COMPACT_WARN_THRESHOLD && existing && !existing.compactWarned) {
      if (threadId) {
        await markThreadCompactWarned(threadId);
      } else {
        await markCompactWarned();
      }
      emitCompactEvent({ type: "warn", turnCount });
    }
  }
  return result;
}
async function run(name, prompt, threadId) {
  return enqueue(() => execClaude(name, prompt, threadId), threadId);
}
async function streamClaude(name, prompt, onChunk, onUnblock) {
  await mkdir2(LOGS_DIR2, { recursive: true });
  const existing = await getSession();
  const { security, model, api } = getSettings();
  const securityArgs = buildSecurityArgs(security);
  const args = ["claude", "-p", prompt, "--output-format", "stream-json", "--verbose", ...securityArgs];
  if (existing)
    args.push("--resume", existing.sessionId);
  const promptContent = await loadPrompts();
  const appendParts = ["You are running inside ClaudeClaw."];
  if (promptContent)
    appendParts.push(promptContent);
  if (existsSync2(PROJECT_CLAUDE_MD)) {
    try {
      const claudeMd = await Bun.file(PROJECT_CLAUDE_MD).text();
      if (claudeMd.trim())
        appendParts.push(claudeMd.trim());
    } catch {}
  }
  if (security.level !== "unrestricted")
    appendParts.push(DIR_SCOPE_PROMPT);
  if (appendParts.length > 0) {
    args.push("--append-system-prompt", appendParts.join(`

`));
  }
  const normalizedModel = model.trim().toLowerCase();
  if (model.trim() && normalizedModel !== "glm")
    args.push("--model", model.trim());
  const { CLAUDECODE: _, ...cleanEnv } = process.env;
  const childEnv = buildChildEnv(cleanEnv, model, api);
  console.log(`[${new Date().toLocaleTimeString()}] Running: ${name} (stream-json, session: ${existing?.sessionId?.slice(0, 8) ?? "new"})`);
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    env: childEnv
  });
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder;
  let buf = "";
  let unblocked = false;
  let textEmitted = false;
  const maybeUnblock = () => {
    if (!unblocked) {
      unblocked = true;
      onUnblock();
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done)
      break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split(`
`);
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed)
        continue;
      try {
        const event = JSON.parse(trimmed);
        if (event.type === "system" && (event.subtype === "init" || event.session_id)) {
          const sid = event.session_id;
          if (sid && !existing) {
            await createSession(sid);
            console.log(`[${new Date().toLocaleTimeString()}] Session created (stream-json): ${sid}`);
          }
        } else if (event.type === "assistant") {
          const msg = event.message;
          const blocks = msg?.content ?? [];
          let hasActivity = false;
          for (const block of blocks) {
            if (block.type === "text" && block.text) {
              onChunk(block.text);
              textEmitted = true;
              hasActivity = true;
            } else if (block.type === "tool_use") {
              hasActivity = true;
            }
          }
          if (hasActivity)
            maybeUnblock();
        } else if (event.type === "tool_use") {
          maybeUnblock();
        } else if (event.type === "result") {
          const resultText = event.result;
          if (resultText && !textEmitted) {
            onChunk(resultText);
          }
          maybeUnblock();
        }
      } catch {}
    }
  }
  await proc.exited;
  maybeUnblock();
  console.log(`[${new Date().toLocaleTimeString()}] Done: ${name}`);
}
async function streamUserMessage(name, prompt, onChunk, onUnblock) {
  return enqueue(() => streamClaude(name, prefixUserMessageWithClock(prompt), onChunk, onUnblock));
}
function prefixUserMessageWithClock(prompt) {
  try {
    const settings = getSettings();
    const prefix = buildClockPromptPrefix(new Date, settings.timezoneOffsetMinutes);
    return `${prefix}
${prompt}`;
  } catch {
    const prefix = buildClockPromptPrefix(new Date, 0);
    return `${prefix}
${prompt}`;
  }
}
async function runUserMessage(name, prompt, threadId) {
  return run(name, prefixUserMessageWithClock(prompt), threadId);
}
async function bootstrap() {
  const existing = await getSession();
  if (existing)
    return;
  console.log(`[${new Date().toLocaleTimeString()}] Bootstrapping new session...`);
  await execClaude("bootstrap", "Wakeup, my friend!");
  console.log(`[${new Date().toLocaleTimeString()}] Bootstrap complete \u2014 session is live.`);
}
var LOGS_DIR2, PROMPTS_DIR, HEARTBEAT_PROMPT_FILE, PROJECT_PROMPTS_DIR, PROJECT_CLAUDE_MD, LEGACY_PROJECT_CLAUDE_MD, CLAUDECLAW_BLOCK_START = "<!-- claudeclaw:managed:start -->", CLAUDECLAW_BLOCK_END = "<!-- claudeclaw:managed:end -->", COMPACT_WARN_THRESHOLD = 25, COMPACT_TIMEOUT_ENABLED = true, compactListeners, RATE_LIMIT_PATTERN, globalQueue, threadQueues, CLAUDE_TIMEOUT_MS, PROJECT_DIR, DIR_SCOPE_PROMPT;
var init_runner = __esm(() => {
  init_sessions();
  init_sessionManager();
  init_config();
  init_timezone();
  LOGS_DIR2 = join4(process.cwd(), ".claude/claudeclaw/logs");
  PROMPTS_DIR = join4(import.meta.dir, "..", "prompts");
  HEARTBEAT_PROMPT_FILE = join4(PROMPTS_DIR, "heartbeat", "HEARTBEAT.md");
  PROJECT_PROMPTS_DIR = join4(process.cwd(), ".claude", "claudeclaw", "prompts");
  PROJECT_CLAUDE_MD = join4(process.cwd(), "CLAUDE.md");
  LEGACY_PROJECT_CLAUDE_MD = join4(process.cwd(), ".claude", "CLAUDE.md");
  compactListeners = [];
  RATE_LIMIT_PATTERN = /you.ve hit your limit|out of extra usage/i;
  globalQueue = Promise.resolve();
  threadQueues = new Map;
  CLAUDE_TIMEOUT_MS = 5 * 60 * 1000;
  PROJECT_DIR = process.cwd();
  DIR_SCOPE_PROMPT = [
    `CRITICAL SECURITY CONSTRAINT: You are scoped to the project directory: ${PROJECT_DIR}`,
    "You MUST NOT read, write, edit, or delete any file outside this directory.",
    "You MUST NOT run bash commands that modify anything outside this directory (no cd /, no /etc, no ~/, no ../.. escapes).",
    "If a request requires accessing files outside the project, refuse and explain why."
  ].join(`
`);
});

// src/whisper.ts
import { execSync, spawnSync } from "child_process";
import { chmod, mkdir as mkdir4, rename as rename2, rm, stat as stat2, access, readdir as readdir4, open, readFile as readFile6 } from "fs/promises";
import { statSync } from "fs";
import { basename, extname, join as join11 } from "path";
import { fileURLToPath } from "url";
function noopLog() {}
function getWhisperBinaryPath() {
  const suffix = process.platform === "win32" ? ".exe" : "";
  return join11(BIN_DIR, `whisper-cli${suffix}`);
}
function getModelPath() {
  return join11(MODEL_FOLDER, `ggml-${WHISPER_MODEL}.bin`);
}
async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
async function findExecutable(dir, names) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const targets = names.flatMap((n) => suffix ? [n + suffix, n] : [n]);
  async function search(current2) {
    let entries;
    try {
      entries = await readdir4(current2, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const fullPath = join11(current2, entry.name);
      if (entry.isFile() && targets.includes(entry.name))
        return fullPath;
      if (entry.isDirectory()) {
        const found = await search(fullPath);
        if (found)
          return found;
      }
    }
    return null;
  }
  return search(dir);
}
function formatBytes(bytes) {
  if (bytes < 1024)
    return `${bytes}B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
async function downloadFile(url, destPath, headers) {
  const tmpPath = destPath + ".tmp";
  let existingBytes = 0;
  try {
    existingBytes = (await stat2(tmpPath)).size;
  } catch {}
  const reqHeaders = { ...headers };
  if (existingBytes > 0) {
    reqHeaders["Range"] = `bytes=${existingBytes}-`;
    console.log(`whisper: resuming download from ${formatBytes(existingBytes)}`);
  }
  const response = await fetch(url, { redirect: "follow", headers: reqHeaders });
  const isResume = response.status === 206 && existingBytes > 0;
  if (!isResume && !response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  if (existingBytes > 0 && response.status === 200) {
    existingBytes = 0;
    await rm(tmpPath, { force: true });
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  const totalSize = isResume ? existingBytes + contentLength : contentLength;
  const body = response.body;
  if (!body)
    throw new Error("No response body");
  const fh = await open(tmpPath, isResume ? "a" : "w");
  let received = isResume ? existingBytes : 0;
  let lastLog = Date.now();
  try {
    for await (const chunk of body) {
      await fh.write(new Uint8Array(chunk));
      received += chunk.byteLength;
      if (totalSize > 0 && Date.now() - lastLog > 2000) {
        const pct = Math.round(received / totalSize * 100);
        console.log(`whisper: downloading ${formatBytes(received)} / ${formatBytes(totalSize)} (${pct}%)`);
        lastLog = Date.now();
      }
    }
  } finally {
    await fh.close();
  }
  await rename2(tmpPath, destPath);
}
async function downloadAndExtractBinary() {
  const platformKey = `${process.platform}-${process.arch}`;
  const source = BINARY_SOURCES[platformKey];
  if (!source) {
    throw new Error(`No pre-built whisper binary for ${platformKey}. Supported: ${Object.keys(BINARY_SOURCES).join(", ")}`);
  }
  const extractDir = join11(TMP_FOLDER, "extract");
  await rm(extractDir, { recursive: true, force: true });
  await mkdir4(extractDir, { recursive: true });
  await mkdir4(BIN_DIR, { recursive: true });
  await mkdir4(LIB_DIR, { recursive: true });
  const archiveExt = source.format === "tar.gz" ? "tar.gz" : "zip";
  const archivePath = join11(TMP_FOLDER, `whisper-bin.${archiveExt}`);
  console.log(`whisper: downloading binary for ${platformKey}...`);
  await downloadFile(source.url, archivePath, source.headers);
  console.log("whisper: extracting...");
  if (source.format === "tar.gz") {
    const proc = Bun.spawnSync(["tar", "xzf", archivePath, "-C", extractDir]);
    if (proc.exitCode !== 0) {
      throw new Error(`Failed to extract tar.gz: ${proc.stderr.toString()}`);
    }
  } else {
    const proc = Bun.spawnSync(["unzip", "-o", archivePath, "-d", extractDir]);
    if (proc.exitCode !== 0) {
      throw new Error(`Failed to extract zip: ${proc.stderr.toString()}`);
    }
  }
  const found = await findExecutable(extractDir, ["whisper-cli", "main"]);
  if (!found) {
    throw new Error("Could not find whisper-cli or main binary in downloaded archive");
  }
  const destBinary = getWhisperBinaryPath();
  await Bun.write(destBinary, Bun.file(found));
  await chmod(destBinary, 493);
  const entries = await readdir4(extractDir, { withFileTypes: true, recursive: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile())
      continue;
    const name = entry.name;
    if (name.includes("whisper") && (name.endsWith(".so") || name.endsWith(".dylib") || name.match(/\.so\.\d/))) {
      const parentPath = entry.parentPath ?? entry.path ?? "";
      const srcPath = join11(parentPath, name);
      const destPath = join11(LIB_DIR, name);
      await Bun.write(destPath, Bun.file(srcPath));
    }
  }
  await rm(extractDir, { recursive: true, force: true });
  await rm(archivePath, { force: true });
  console.log("whisper: binary ready");
}
async function downloadModel() {
  const modelPath = getModelPath();
  if (await fileExists(modelPath))
    return;
  await mkdir4(MODEL_FOLDER, { recursive: true });
  console.log(`whisper: downloading model ${WHISPER_MODEL}...`);
  await downloadFile(MODEL_URL, modelPath);
  console.log("whisper: model ready");
}
async function prepareWhisperAssets(printOutput) {
  const startedAt = Date.now();
  console.log(`whisper warmup: start root=${WHISPER_ROOT} model=${WHISPER_MODEL}`);
  await mkdir4(WHISPER_ROOT, { recursive: true });
  await mkdir4(TMP_FOLDER, { recursive: true });
  const binaryPath = getWhisperBinaryPath();
  if (!await fileExists(binaryPath)) {
    await downloadAndExtractBinary();
  } else {
    console.log("whisper warmup: binary exists");
  }
  await downloadModel();
  console.log(`whisper warmup: complete in ${Date.now() - startedAt}ms`);
}
function ensureOggDeps() {
  const marker = join11(PLUGIN_ROOT, "node_modules", "ogg-opus-decoder");
  try {
    statSync(marker);
  } catch {
    console.log("whisper: installing ogg-opus-decoder...");
    const pkgMgr = (() => {
      try {
        execSync("bun --version", { stdio: "ignore" });
        return "bun";
      } catch {}
      return "npm";
    })();
    execSync(`${pkgMgr} install`, { cwd: PLUGIN_ROOT, stdio: "inherit" });
  }
}
function decodeOggOpusToWavViaNode(inputPath, wavPath, log) {
  ensureOggDeps();
  log(`voice decode: running node converter`);
  const result = spawnSync("node", [OGG_MJS_CONVERTER, inputPath, wavPath], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || "";
    const stdout = result.stdout?.trim() || "";
    throw new Error(`node decode failed (exit ${result.status ?? "unknown"})${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ""}`);
  }
  if (result.stderr?.trim())
    log(`voice decode(node): ${result.stderr.trim()}`);
  log(`voice decode: node converter completed`);
}
async function ensureWavInput(inputPath, log) {
  const ext = extname(inputPath).toLowerCase();
  log(`voice input: path=${inputPath} ext=${ext || "(none)"}`);
  if (ext === ".wav")
    return inputPath;
  if (ext !== ".ogg" && ext !== ".oga") {
    throw new Error(`unsupported audio format "${ext || "(none)"}" without ffmpeg; supported: .oga, .ogg, .wav`);
  }
  const wavPath = join11(TMP_FOLDER, `${basename(inputPath, extname(inputPath))}-${Date.now()}.wav`);
  decodeOggOpusToWavViaNode(inputPath, wavPath, log);
  return wavPath;
}
function warmupWhisperAssets(options) {
  const printOutput = options?.printOutput ?? false;
  if (!warmupPromise) {
    console.log(`whisper warmup: creating warmup promise printOutput=${printOutput}`);
    warmupPromise = prepareWhisperAssets(printOutput).catch((err) => {
      console.error(`whisper warmup: failed - ${err instanceof Error ? err.message : String(err)}`);
      warmupPromise = null;
      throw err;
    });
  } else {
    console.log("whisper warmup: reusing in-flight warmup promise");
  }
  return warmupPromise;
}
async function transcribeViaApi(inputPath, baseUrl, model, log) {
  const apiModel = model || "Systran/faster-whisper-large-v3";
  const url = `${baseUrl}/v1/audio/transcriptions`;
  log(`voice transcribe: using STT API url=${url} model=${apiModel}`);
  const audioBytes = await readFile6(inputPath);
  const ext = extname(inputPath).toLowerCase().replace(".", "") || "ogg";
  const mimeMap = {
    ogg: "audio/ogg",
    oga: "audio/ogg",
    wav: "audio/wav",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    webm: "audio/webm"
  };
  const mimeType = mimeMap[ext] ?? "audio/ogg";
  const form = new FormData;
  form.append("file", new Blob([audioBytes], { type: mimeType }), `audio.${ext}`);
  form.append("model", apiModel);
  const response = await fetch(url, { method: "POST", body: form });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`STT API error (${response.status}): ${body}`);
  }
  const data = await response.json();
  const transcript = (data.text ?? "").trim();
  log(`voice transcribe: API transcript chars=${transcript.length}`);
  return transcript;
}
async function transcribeAudioToText(inputPath, options) {
  const log = options?.debug ? options?.log ?? console.log : noopLog;
  const stt = getSettings().stt;
  if (stt?.baseUrl) {
    return transcribeViaApi(inputPath, stt.baseUrl, stt.model, log);
  }
  await warmupWhisperAssets();
  log(`voice transcribe: warmup ready cwd=${process.cwd()} input=${inputPath}`);
  try {
    const inputStat = await stat2(inputPath);
    log(`voice transcribe: input size=${inputStat.size} bytes`);
  } catch (err) {
    log(`voice transcribe: failed to stat input - ${err instanceof Error ? err.message : String(err)}`);
  }
  const wavPath = await ensureWavInput(inputPath, log);
  const shouldCleanup = wavPath !== inputPath;
  log(`voice transcribe: using wav=${wavPath} cleanup=${shouldCleanup}`);
  const binaryPath = getWhisperBinaryPath();
  const modelPath = getModelPath();
  const runTranscription = () => {
    const proc = Bun.spawnSync([binaryPath, "-m", modelPath, "-f", wavPath, "--no-timestamps"], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        LD_LIBRARY_PATH: [LIB_DIR, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
        DYLD_LIBRARY_PATH: [LIB_DIR, process.env.DYLD_LIBRARY_PATH].filter(Boolean).join(":")
      }
    });
    if (proc.exitCode !== 0) {
      const stderr = proc.stderr.toString().trim();
      throw new Error(`whisper transcription failed (exit ${proc.exitCode}): ${stderr}`);
    }
    return proc.stdout.toString();
  };
  try {
    let rawOutput;
    try {
      rawOutput = runTranscription();
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes("ENOENT"))
        throw err;
      log("voice transcribe: missing whisper executable, forcing re-download and retry");
      warmupPromise = null;
      await rm(BIN_DIR, { recursive: true, force: true });
      await warmupWhisperAssets();
      rawOutput = runTranscription();
    }
    const transcript = rawOutput.split(`
`).map((line) => line.trim()).filter((line) => line.length > 0 && line !== "[BLANK_AUDIO]").join(" ").replace(/\s+/g, " ").trim();
    log(`voice transcribe: transcript chars=${transcript.length}`);
    return transcript;
  } finally {
    if (shouldCleanup) {
      log(`voice transcribe: cleanup wav=${wavPath}`);
      await rm(wavPath, { force: true }).catch(() => {});
    }
  }
}
var WHISPER_MODEL = "base.en", WHISPER_ROOT, BIN_DIR, LIB_DIR, MODEL_FOLDER, TMP_FOLDER, OGG_MJS_CONVERTER, PLUGIN_ROOT, MODEL_URL, BINARY_SOURCES, warmupPromise = null;
var init_whisper = __esm(() => {
  init_config();
  WHISPER_ROOT = join11(process.cwd(), ".claude", "claudeclaw", "whisper");
  BIN_DIR = join11(WHISPER_ROOT, "bin");
  LIB_DIR = join11(WHISPER_ROOT, "lib");
  MODEL_FOLDER = join11(WHISPER_ROOT, "models");
  TMP_FOLDER = join11(WHISPER_ROOT, "tmp");
  OGG_MJS_CONVERTER = fileURLToPath(new URL("./ogg.mjs", import.meta.url));
  PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url));
  MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL}.bin`;
  BINARY_SOURCES = {
    "linux-x64": {
      url: "https://github.com/dscripka/whisper.cpp_binaries/releases/download/commit_3d42463/whisper-bin-linux-x64.tar.gz",
      format: "tar.gz"
    },
    "darwin-arm64": {
      url: "https://ghcr.io/v2/homebrew/core/whisper-cpp/blobs/sha256:f0901568c7babbd3022a043887007400e4b57a22d3a90b9c0824d01fa3a77270",
      format: "tar.gz",
      headers: { Authorization: "Bearer QQ==" }
    },
    "darwin-x64": {
      url: "https://ghcr.io/v2/homebrew/core/whisper-cpp/blobs/sha256:e6c2f78cbc5d6b311dfe24d8c5d4ffc68a634465c5e35ed11746068583d273c4",
      format: "tar.gz",
      headers: { Authorization: "Bearer QQ==" }
    },
    "linux-arm64": {
      url: "https://ghcr.io/v2/homebrew/core/whisper-cpp/blobs/sha256:684199fd6bec28cddfa086c584a49d236386c109f901a443b577b857fd052f83",
      format: "tar.gz",
      headers: { Authorization: "Bearer QQ==" }
    },
    "win32-x64": {
      url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.7.6/whisper-bin-x64.zip",
      format: "zip"
    }
  };
});

// src/skills.ts
import { readdir as readdir5, readFile as readFile7 } from "fs/promises";
import { existsSync as existsSync3 } from "fs";
import { join as join12 } from "path";
import { homedir } from "os";
async function listSkills() {
  const home = homedir();
  const projectSkillsDir = join12(process.cwd(), ".claude", "skills");
  const globalSkillsDir = join12(home, ".claude", "skills");
  const pluginsDir = join12(home, ".claude", "plugins");
  const seen = new Set;
  const skills = [];
  await collectSkillsFromDir(projectSkillsDir, null, seen, skills);
  await collectSkillsFromDir(globalSkillsDir, null, seen, skills);
  const cachePath = join12(pluginsDir, "cache");
  if (existsSync3(cachePath)) {
    try {
      const pluginDirs = await readdir5(cachePath, { withFileTypes: true });
      for (const pd of pluginDirs) {
        if (!pd.isDirectory())
          continue;
        const pluginCacheDir = join12(cachePath, pd.name);
        const subDirs = await readdir5(pluginCacheDir, { withFileTypes: true }).catch(() => []);
        for (const sub of subDirs) {
          if (!sub.isDirectory())
            continue;
          const innerDir = join12(pluginCacheDir, sub.name);
          const verDirs = await readdir5(innerDir, { withFileTypes: true }).catch(() => []);
          for (const ver of verDirs) {
            if (!ver.isDirectory())
              continue;
            await collectSkillsFromDir(join12(innerDir, ver.name, "skills"), pd.name, seen, skills);
          }
          await collectSkillsFromDir(join12(innerDir, "skills"), pd.name, seen, skills);
        }
      }
    } catch {}
  }
  return skills;
}
async function collectSkillsFromDir(dir, pluginName, seen, skills) {
  if (!existsSync3(dir))
    return;
  try {
    const entries = await readdir5(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory())
        continue;
      const skillPath = join12(dir, entry.name, "SKILL.md");
      if (!existsSync3(skillPath))
        continue;
      let content;
      try {
        content = await readFile7(skillPath, "utf8");
      } catch {
        continue;
      }
      if (!content.trim())
        continue;
      const name = pluginName ? `${pluginName}_${entry.name}` : entry.name;
      if (seen.has(name))
        continue;
      seen.add(name);
      skills.push({ name, description: extractDescription(content) });
    }
  } catch {}
}
function extractDescription(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const descMatch = fm.match(/^description:\s*>?\s*\n?([\s\S]*?)(?=\n\w|\n---|\n$)/m);
    if (descMatch) {
      const raw = descMatch[1].replace(/\n\s*/g, " ").trim();
      if (raw)
        return raw.slice(0, 256);
    }
    const singleMatch = fm.match(/^description:\s*["']?(.+?)["']?\s*$/m);
    if (singleMatch)
      return singleMatch[1].trim().slice(0, 256);
  }
  for (const line of content.split(`
`)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---"))
      continue;
    return trimmed.slice(0, 256);
  }
  return "Claude Code skill";
}
async function resolveSkillPrompt(command) {
  const name = command.startsWith("/") ? command.slice(1) : command;
  if (!name)
    return null;
  const colonIdx = name.indexOf(":");
  const pluginHint = colonIdx > 0 ? name.slice(0, colonIdx) : null;
  const skillName = colonIdx > 0 ? name.slice(colonIdx + 1) : name;
  const home = homedir();
  const projectSkillsDir = join12(process.cwd(), ".claude", "skills");
  const globalSkillsDir = join12(home, ".claude", "skills");
  const pluginsDir = join12(home, ".claude", "plugins");
  if (!pluginHint) {
    const projectPath = join12(projectSkillsDir, skillName, "SKILL.md");
    const content = await tryReadFile(projectPath);
    if (content)
      return content;
  }
  if (!pluginHint) {
    const globalPath = join12(globalSkillsDir, skillName, "SKILL.md");
    const content = await tryReadFile(globalPath);
    if (content)
      return content;
  }
  const pluginContent = await searchPluginSkills(pluginsDir, skillName, pluginHint);
  if (pluginContent)
    return pluginContent;
  return null;
}
async function tryReadFile(path) {
  if (!existsSync3(path))
    return null;
  try {
    const content = await readFile7(path, "utf8");
    return content.trim() || null;
  } catch {
    return null;
  }
}
async function searchPluginSkills(pluginsDir, skillName, pluginHint) {
  if (!existsSync3(pluginsDir))
    return null;
  try {
    const entries = await readdir5(pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory())
        continue;
      if (pluginHint && entry.name !== pluginHint)
        continue;
      const skillPath = join12(pluginsDir, entry.name, "skills", skillName, "SKILL.md");
      const content = await tryReadFile(skillPath);
      if (content)
        return content;
      const cachePath = join12(pluginsDir, "cache", entry.name);
      if (existsSync3(cachePath)) {
        const cacheContent = await searchCacheDir(cachePath, skillName);
        if (cacheContent)
          return cacheContent;
      }
    }
    if (!pluginHint) {
      const cachePath = join12(pluginsDir, "cache");
      if (existsSync3(cachePath)) {
        const cacheEntries = await readdir5(cachePath, { withFileTypes: true });
        for (const ce of cacheEntries) {
          if (!ce.isDirectory())
            continue;
          const cacheContent = await searchCacheDir(join12(cachePath, ce.name), skillName);
          if (cacheContent)
            return cacheContent;
        }
      }
    } else {
      const cachePath = join12(pluginsDir, "cache", pluginHint);
      if (existsSync3(cachePath)) {
        const cacheContent = await searchCacheDir(cachePath, skillName);
        if (cacheContent)
          return cacheContent;
      }
    }
  } catch {}
  return null;
}
async function searchCacheDir(cachePluginDir, skillName) {
  try {
    const subEntries = await readdir5(cachePluginDir, { withFileTypes: true });
    for (const sub of subEntries) {
      if (!sub.isDirectory())
        continue;
      const innerDir = join12(cachePluginDir, sub.name);
      const versionEntries = await readdir5(innerDir, { withFileTypes: true });
      for (const ver of versionEntries) {
        if (!ver.isDirectory())
          continue;
        const skillPath = join12(innerDir, ver.name, "skills", skillName, "SKILL.md");
        const content2 = await tryReadFile(skillPath);
        if (content2)
          return content2;
      }
      const directPath = join12(innerDir, "skills", skillName, "SKILL.md");
      const content = await tryReadFile(directPath);
      if (content)
        return content;
    }
  } catch {}
  return null;
}
var init_skills = () => {};

// src/commands/telegram.ts
var exports_telegram = {};
__export(exports_telegram, {
  telegram: () => telegram,
  startPolling: () => startPolling,
  sendMessage: () => sendMessage
});
import { readFile as readFile8 } from "fs/promises";
import { existsSync as existsSync4 } from "fs";
import { homedir as homedir2 } from "os";
import { mkdir as mkdir5 } from "fs/promises";
import { extname as extname2, join as join13 } from "path";
function markdownToTelegramHtml(text) {
  if (!text)
    return "";
  const codeBlocks = [];
  text = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_m, code) => {
    codeBlocks.push(code);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });
  const inlineCodes = [];
  text = text.replace(/`([^`]+)`/g, (_m, code) => {
    inlineCodes.push(code);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "$1");
  text = text.replace(/^>\s*(.*)$/gm, "$1");
  text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  text = text.replace(/__(.+?)__/g, "<b>$1</b>");
  text = text.replace(/(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, "<i>$1</i>");
  text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");
  text = text.replace(/^[-*]\s+/gm, "\u2022 ");
  for (let i = 0;i < inlineCodes.length; i++) {
    const escaped = inlineCodes[i].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    text = text.replace(`\x00IC${i}\x00`, `<code>${escaped}</code>`);
  }
  for (let i = 0;i < codeBlocks.length; i++) {
    const escaped = codeBlocks[i].replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    text = text.replace(`\x00CB${i}\x00`, `<pre><code>${escaped}</code></pre>`);
  }
  return text;
}
function debugLog(message) {
  if (!telegramDebug)
    return;
  console.log(`[Telegram][debug] ${message}`);
}
function normalizeTelegramText(text) {
  return text.replace(/[\u2010-\u2015\u2212]/g, "-");
}
function getMessageTextAndEntities(message) {
  if (message.text) {
    return {
      text: normalizeTelegramText(message.text),
      entities: message.entities
    };
  }
  if (message.caption) {
    return {
      text: normalizeTelegramText(message.caption),
      entities: message.caption_entities
    };
  }
  return { text: "", entities: [] };
}
function isImageDocument(document) {
  return Boolean(document?.mime_type?.startsWith("image/"));
}
function isAudioDocument(document) {
  return Boolean(document?.mime_type?.startsWith("audio/"));
}
function isDocumentAttachment(document) {
  if (!document?.mime_type)
    return false;
  if (isImageDocument(document) || isAudioDocument(document))
    return false;
  return DOCUMENT_MIME_TYPES.has(document.mime_type);
}
function pickLargestPhoto(photo) {
  return [...photo].sort((a, b) => {
    const sizeA = a.file_size ?? a.width * a.height;
    const sizeB = b.file_size ?? b.width * b.height;
    return sizeB - sizeA;
  })[0];
}
function extensionFromMimeType(mimeType) {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/bmp":
      return ".bmp";
    default:
      return "";
  }
}
function extensionFromAudioMimeType(mimeType) {
  switch (mimeType) {
    case "audio/mpeg":
      return ".mp3";
    case "audio/mp4":
    case "audio/x-m4a":
      return ".m4a";
    case "audio/ogg":
      return ".ogg";
    case "audio/wav":
    case "audio/x-wav":
      return ".wav";
    case "audio/webm":
      return ".webm";
    default:
      return "";
  }
}
function buildProgressBar(current2, max, width = 20) {
  const ratio = Math.min(current2 / max, 1);
  const filled = Math.round(ratio * width);
  return "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
}
function extractTelegramCommand(text) {
  const firstToken = text.trim().split(/\s+/, 1)[0];
  if (!firstToken.startsWith("/"))
    return null;
  return firstToken.split("@", 1)[0].toLowerCase();
}
async function callApi(token, method, body) {
  const res = await fetch(`${API_BASE}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    throw new Error(`Telegram API ${method}: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}
async function sendMessage(token, chatId, text, threadId) {
  const normalized = normalizeTelegramText(text).replace(/\[react:[^\]\r\n]+\]/gi, "");
  const html = markdownToTelegramHtml(normalized);
  const MAX_LEN = 4096;
  for (let i = 0;i < html.length; i += MAX_LEN) {
    try {
      await callApi(token, "sendMessage", {
        chat_id: chatId,
        text: html.slice(i, i + MAX_LEN),
        parse_mode: "HTML",
        ...threadId ? { message_thread_id: threadId } : {}
      });
    } catch {
      await callApi(token, "sendMessage", {
        chat_id: chatId,
        text: normalized.slice(i, i + MAX_LEN),
        ...threadId ? { message_thread_id: threadId } : {}
      });
    }
  }
}
async function sendTyping(token, chatId, threadId) {
  await callApi(token, "sendChatAction", {
    chat_id: chatId,
    action: "typing",
    ...threadId ? { message_thread_id: threadId } : {}
  }).catch(() => {});
}
async function sendDocumentToChat(token, chatId, filePath, threadId) {
  const file = Bun.file(filePath);
  if (!await file.exists()) {
    console.error(`[Telegram] sendDocument: file not found: ${filePath}`);
    return;
  }
  const fileName = filePath.split("/").pop() ?? "document";
  const formData = new FormData;
  formData.append("chat_id", String(chatId));
  formData.append("document", file, fileName);
  if (threadId)
    formData.append("message_thread_id", String(threadId));
  const res = await fetch(`${API_BASE}${token}/sendDocument`, {
    method: "POST",
    body: formData
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendDocument failed: ${res.status} ${body}`);
  }
}
function extractReactionDirective(text) {
  let reactionEmoji = null;
  const cleanedText = text.replace(/\[react:([^\]\r\n]+)\]/gi, (_match, raw) => {
    const candidate = String(raw).trim();
    if (!reactionEmoji && candidate)
      reactionEmoji = candidate;
    return "";
  }).replace(/[ \t]+\n/g, `
`).replace(/\n{3,}/g, `

`).trim();
  return { cleanedText, reactionEmoji };
}
function extractSendFileDirectives(text) {
  const filePaths = [];
  const cleanedText = text.replace(/\[send-file:([^\]\r\n]+)\]/gi, (_match, raw) => {
    const candidate = String(raw).trim();
    if (candidate)
      filePaths.push(candidate);
    return "";
  }).replace(/[ \t]+\n/g, `
`).replace(/\n{3,}/g, `

`).trim();
  return { cleanedText, filePaths };
}
async function sendReaction(token, chatId, messageId, emoji) {
  await callApi(token, "setMessageReaction", {
    chat_id: chatId,
    message_id: messageId,
    reaction: [{ type: "emoji", emoji }]
  });
}
function groupTriggerReason(message) {
  if (botId && message.reply_to_message?.from?.id === botId)
    return "reply_to_bot";
  const { text, entities } = getMessageTextAndEntities(message);
  if (!text)
    return null;
  const lowerText = text.toLowerCase();
  if (botUsername && lowerText.includes(`@${botUsername.toLowerCase()}`))
    return "text_contains_mention";
  for (const entity of entities ?? []) {
    const value = text.slice(entity.offset, entity.offset + entity.length);
    if (entity.type === "mention" && botUsername && value.toLowerCase() === `@${botUsername.toLowerCase()}`) {
      return "mention_entity_matches_bot";
    }
    if (entity.type === "mention" && !botUsername)
      return "mention_entity_before_botname_loaded";
    if (entity.type === "bot_command") {
      if (!value.includes("@"))
        return "bare_bot_command";
      if (!botUsername)
        return "scoped_command_before_botname_loaded";
      if (botUsername && value.toLowerCase().endsWith(`@${botUsername.toLowerCase()}`))
        return "scoped_command_matches_bot";
    }
  }
  return null;
}
async function downloadImageFromMessage(token, message) {
  const photo = message.photo && message.photo.length > 0 ? pickLargestPhoto(message.photo) : null;
  const imageDocument = isImageDocument(message.document) ? message.document : null;
  const fileId = photo?.file_id ?? imageDocument?.file_id;
  if (!fileId)
    return null;
  const fileMeta = await callApi(token, "getFile", { file_id: fileId });
  if (!fileMeta.ok || !fileMeta.result.file_path)
    return null;
  const remotePath = fileMeta.result.file_path;
  const downloadUrl = `${FILE_API_BASE}${token}/${remotePath}`;
  const response = await fetch(downloadUrl);
  if (!response.ok)
    throw new Error(`Telegram file download failed: ${response.status} ${response.statusText}`);
  const dir = join13(process.cwd(), ".claude", "claudeclaw", "inbox", "telegram");
  await mkdir5(dir, { recursive: true });
  const remoteExt = extname2(remotePath);
  const docExt = extname2(imageDocument?.file_name ?? "");
  const mimeExt = extensionFromMimeType(imageDocument?.mime_type);
  const ext = remoteExt || docExt || mimeExt || ".jpg";
  const filename = `${message.chat.id}-${message.message_id}-${Date.now()}${ext}`;
  const localPath = join13(dir, filename);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await Bun.write(localPath, bytes);
  return localPath;
}
async function downloadVoiceFromMessage(token, message) {
  const audioDocument = isAudioDocument(message.document) ? message.document : null;
  const audioLike = message.voice ?? message.audio ?? audioDocument;
  const fileId = audioLike?.file_id;
  if (!fileId)
    return null;
  const fileMeta = await callApi(token, "getFile", { file_id: fileId });
  if (!fileMeta.ok || !fileMeta.result.file_path)
    return null;
  const remotePath = fileMeta.result.file_path;
  const downloadUrl = `${FILE_API_BASE}${token}/${remotePath}`;
  debugLog(`Voice download: fileId=${fileId} remotePath=${remotePath} mime=${audioLike.mime_type ?? "unknown"} expectedSize=${audioLike.file_size ?? "unknown"}`);
  const response = await fetch(downloadUrl);
  if (!response.ok)
    throw new Error(`Telegram file download failed: ${response.status} ${response.statusText}`);
  const dir = join13(process.cwd(), ".claude", "claudeclaw", "inbox", "telegram");
  await mkdir5(dir, { recursive: true });
  const remoteExt = extname2(remotePath);
  const docExt = extname2(message.document?.file_name ?? "");
  const audioExt = extname2(message.audio?.file_name ?? "");
  const mimeExt = extensionFromAudioMimeType(audioLike.mime_type);
  const ext = remoteExt || docExt || audioExt || mimeExt || ".ogg";
  const filename = `${message.chat.id}-${message.message_id}-${Date.now()}${ext}`;
  const localPath = join13(dir, filename);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await Bun.write(localPath, bytes);
  const header = Array.from(bytes.slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join(" ");
  const oggMagic = bytes.length >= 4 && bytes[0] === 79 && bytes[1] === 103 && bytes[2] === 103 && bytes[3] === 83;
  debugLog(`Voice download: wrote ${bytes.length} bytes to ${localPath} ext=${ext} header=${header || "empty"} oggMagic=${oggMagic}`);
  return localPath;
}
async function downloadDocumentFromMessage(token, message) {
  const doc = message.document;
  if (!doc || !isDocumentAttachment(doc))
    return null;
  const fileMeta = await callApi(token, "getFile", { file_id: doc.file_id });
  if (!fileMeta.ok || !fileMeta.result.file_path)
    return null;
  const remotePath = fileMeta.result.file_path;
  const downloadUrl = `${FILE_API_BASE}${token}/${remotePath}`;
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status} ${response.statusText}`);
  }
  const dir = join13(process.cwd(), ".claude", "claudeclaw", "inbox", "telegram");
  await mkdir5(dir, { recursive: true });
  const originalName = doc.file_name ?? `document${extname2(remotePath) || ""}`;
  const ext = extname2(originalName) || extname2(remotePath) || "";
  const filename = `${message.chat.id}-${message.message_id}-${Date.now()}${ext}`;
  const localPath = join13(dir, filename);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await Bun.write(localPath, bytes);
  return { localPath, originalName };
}
async function handleMyChatMember(update) {
  const config = getSettings().telegram;
  const chat = update.chat;
  if (!botUsername && update.new_chat_member.user.username)
    botUsername = update.new_chat_member.user.username;
  if (!botId)
    botId = update.new_chat_member.user.id;
  const oldStatus = update.old_chat_member.status;
  const newStatus = update.new_chat_member.status;
  const isGroup = chat.type === "group" || chat.type === "supergroup";
  const wasOut = oldStatus === "left" || oldStatus === "kicked";
  const isIn = newStatus === "member" || newStatus === "administrator";
  if (!isGroup || !wasOut || !isIn)
    return;
  const chatName = chat.title ?? String(chat.id);
  console.log(`[Telegram] Added to ${chat.type}: ${chatName} (${chat.id}) by ${update.from.id}`);
  const addedBy = update.from.username ?? `${update.from.first_name} (${update.from.id})`;
  const eventPrompt = `[Telegram system event] I was added to a ${chat.type}.
` + `Group title: ${chatName}
` + `Group id: ${chat.id}
` + `Added by: ${addedBy}
` + "Write a short first message for the group. It should confirm I was added and explain how to trigger me.";
  try {
    const result = await run("telegram", eventPrompt);
    if (result.exitCode !== 0) {
      await sendMessage(config.token, chat.id, "I was added to this group. Mention me with a command to start.");
      return;
    }
    await sendMessage(config.token, chat.id, result.stdout || "I was added to this group.");
  } catch (err) {
    console.error(`[Telegram] group-added event error: ${err instanceof Error ? err.message : err}`);
    await sendMessage(config.token, chat.id, "I was added to this group. Mention me with a command to start.");
  }
}
async function enqueueMessage(message) {
  messageQueue.push(() => handleMessage(message));
  if (!isProcessing)
    drainQueue();
}
async function drainQueue() {
  if (isProcessing || messageQueue.length === 0)
    return;
  isProcessing = true;
  while (messageQueue.length > 0) {
    const task = messageQueue.shift();
    try {
      await task();
    } catch (err) {
      console.error();
    }
  }
  isProcessing = false;
}
async function handleMessage(message) {
  const config = getSettings().telegram;
  const userId = message.from?.id;
  const chatId = message.chat.id;
  const threadId = message.message_thread_id;
  const { text } = getMessageTextAndEntities(message);
  const chatType = message.chat.type;
  const isPrivate = chatType === "private";
  const isGroup = chatType === "group" || chatType === "supergroup";
  const hasImage = Boolean(message.photo && message.photo.length > 0 || isImageDocument(message.document));
  const hasVoice = Boolean(message.voice || message.audio || isAudioDocument(message.document));
  const hasDocument = Boolean(message.document && isDocumentAttachment(message.document));
  if (!isPrivate && !isGroup)
    return;
  const triggerReason = isGroup ? groupTriggerReason(message) : "private_chat";
  if (isGroup && !triggerReason) {
    debugLog(`Skip group message chat=${chatId} from=${userId ?? "unknown"} reason=no_trigger text="${(text ?? "").slice(0, 80)}"`);
    return;
  }
  debugLog(`Handle message chat=${chatId} type=${chatType} from=${userId ?? "unknown"} reason=${triggerReason} text="${(text ?? "").slice(0, 80)}"`);
  if (userId && config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(userId)) {
    if (isPrivate) {
      await sendMessage(config.token, chatId, "Unauthorized.");
    } else {
      console.log(`[Telegram] Ignored group message from unauthorized user ${userId} in chat ${chatId}`);
      debugLog(`Skip group message chat=${chatId} from=${userId} reason=unauthorized_user`);
    }
    return;
  }
  if (!text.trim() && !hasImage && !hasVoice && !hasDocument) {
    debugLog(`Skip message chat=${chatId} from=${userId ?? "unknown"} reason=empty_text`);
    return;
  }
  const command = text ? extractTelegramCommand(text) : null;
  if (command === "/start") {
    await sendMessage(config.token, chatId, `Hello! Send me a message and I'll respond using Claude.
Use /reset to start a fresh session.`, threadId);
    return;
  }
  if (command === "/reset") {
    await resetSession();
    await sendMessage(config.token, chatId, "Global session reset. Next message starts fresh.", threadId);
    return;
  }
  if (command === "/compact") {
    await sendMessage(config.token, chatId, "\u23F3 Compacting session...", threadId);
    const result = await compactCurrentSession();
    await sendMessage(config.token, chatId, result.message, threadId);
    return;
  }
  if (command === "/status") {
    const session = await peekSession();
    const settings = getSettings();
    if (!session) {
      await sendMessage(config.token, chatId, "\uD83D\uDCCA No active session.", threadId);
      return;
    }
    const lines = [
      "\uD83D\uDCCA **Session Status**",
      `Session: \`${session.sessionId.slice(0, 8)}\``,
      `Turns: ${session.turnCount ?? 0}`,
      `Model: ${settings.model || "default"}`,
      `Security: ${settings.security.level}`,
      `Created: ${session.createdAt}`,
      `Last used: ${session.lastUsedAt}`,
      `Compact warned: ${session.compactWarned ? "yes" : "no"}`
    ];
    await sendMessage(config.token, chatId, lines.join(`
`), threadId);
    return;
  }
  if (command === "/context") {
    const session = await peekSession();
    if (!session) {
      await sendMessage(config.token, chatId, "No active session.", threadId);
      return;
    }
    const home = homedir2();
    const projectSlug = process.cwd().replace(/\//g, "-");
    const jsonlPath = `${home}/.claude/projects/${projectSlug}/${session.sessionId}.jsonl`;
    if (!existsSync4(jsonlPath)) {
      await sendMessage(config.token, chatId, "Conversation file not found.", threadId);
      return;
    }
    try {
      const raw = await readFile8(jsonlPath, "utf8");
      const fileLines = raw.trim().split(`
`);
      let lastUsage = null;
      let totalOutput = 0;
      for (const line of fileLines) {
        try {
          const obj = JSON.parse(line);
          if (obj.message?.usage)
            lastUsage = obj.message.usage;
          if (obj.message?.usage?.output_tokens)
            totalOutput += obj.message.usage.output_tokens;
        } catch {}
      }
      if (!lastUsage) {
        await sendMessage(config.token, chatId, "No usage data found.", threadId);
        return;
      }
      const input = lastUsage.input_tokens ?? 0;
      const cacheCreation = lastUsage.cache_creation_input_tokens ?? 0;
      const cacheRead = lastUsage.cache_read_input_tokens ?? 0;
      const totalContext = input + cacheCreation + cacheRead;
      const maxContext = 200000;
      const pct = (totalContext / maxContext * 100).toFixed(1);
      const bar = buildProgressBar(totalContext, maxContext);
      const msg = [
        `\uD83D\uDCD0 **Context Window**`,
        `${bar} ${pct}%`,
        ``,
        `Total: \`${totalContext.toLocaleString()}\` / \`${maxContext.toLocaleString()}\` tokens`,
        `\u251C Input: \`${input.toLocaleString()}\``,
        `\u251C Cache creation: \`${cacheCreation.toLocaleString()}\``,
        `\u251C Cache read: \`${cacheRead.toLocaleString()}\``,
        `\u2514 Output (cumulative): \`${totalOutput.toLocaleString()}\``,
        ``,
        `Turns: ${session.turnCount ?? 0}`
      ];
      await sendMessage(config.token, chatId, msg.join(`
`), threadId);
    } catch (err) {
      await sendMessage(config.token, chatId, `Failed to read context: ${err instanceof Error ? err.message : err}`, threadId);
    }
    return;
  }
  const replyToMsgId = message.reply_to_message?.message_id;
  if (replyToMsgId && text && botId && message.reply_to_message?.from?.id === botId) {
    try {
      const lookupResp = await fetch(`http://127.0.0.1:9999/pending/by-bot-msg/${replyToMsgId}`);
      if (lookupResp.ok) {
        const item = await lookupResp.json();
        if (item?.id) {
          await fetch(`http://127.0.0.1:9999/confirm/${item.id}/custom`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
          });
          await sendMessage(config.token, chatId, `\u2705 Sent custom reply + pattern learned.`, threadId);
          return;
        }
      }
    } catch {}
  }
  const label = message.from?.username ?? String(userId ?? "unknown");
  const mediaParts = [hasImage ? "image" : "", hasVoice ? "voice" : "", hasDocument ? "doc" : ""].filter(Boolean);
  const mediaSuffix = mediaParts.length > 0 ? ` [${mediaParts.join("+")}]` : "";
  console.log(`[${new Date().toLocaleTimeString()}] Telegram ${label}${mediaSuffix}: "${text.slice(0, 60)}${text.length > 60 ? "..." : ""}"`);
  const typingInterval = setInterval(() => sendTyping(config.token, chatId, threadId), 4000);
  try {
    await sendTyping(config.token, chatId, threadId);
    let imagePath = null;
    let voicePath = null;
    let voiceTranscript = null;
    if (hasImage) {
      try {
        imagePath = await downloadImageFromMessage(config.token, message);
      } catch (err) {
        console.error(`[Telegram] Failed to download image for ${label}: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (hasVoice) {
      try {
        voicePath = await downloadVoiceFromMessage(config.token, message);
      } catch (err) {
        console.error(`[Telegram] Failed to download voice for ${label}: ${err instanceof Error ? err.message : err}`);
      }
      if (voicePath) {
        try {
          debugLog(`Voice file saved: path=${voicePath}`);
          voiceTranscript = await transcribeAudioToText(voicePath, {
            debug: telegramDebug,
            log: (message2) => debugLog(message2)
          });
        } catch (err) {
          console.error(`[Telegram] Failed to transcribe voice for ${label}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
    let skillContext = null;
    if (command && command !== "/start" && command !== "/reset" && command !== "/compact" && command !== "/status" && command !== "/context") {
      try {
        skillContext = await resolveSkillPrompt(command);
        if (skillContext) {
          debugLog(`Skill resolved for ${command}: ${skillContext.length} chars`);
        }
      } catch (err) {
        debugLog(`Skill resolution failed for ${command}: ${err instanceof Error ? err.message : err}`);
      }
    }
    let documentInfo = null;
    if (hasDocument) {
      try {
        documentInfo = await downloadDocumentFromMessage(config.token, message);
      } catch (err) {
        console.error(`[Telegram] Failed to download document for ${label}: ${err instanceof Error ? err.message : err}`);
      }
    }
    const promptParts = [`[Telegram from ${label}]`];
    if (threadId)
      promptParts.push(`[thread:${threadId}]`);
    if (skillContext) {
      const args = text.trim().slice(command.length).trim();
      promptParts.push(`<command-name>${command}</command-name>`);
      promptParts.push(skillContext);
      if (args)
        promptParts.push(`User arguments: ${args}`);
    } else if (text.trim()) {
      promptParts.push(`Message: ${text}`);
    }
    if (imagePath) {
      promptParts.push(`Image path: ${imagePath}`);
      promptParts.push("The user attached an image. Inspect this image file directly before answering.");
    } else if (hasImage) {
      promptParts.push("The user attached an image, but downloading it failed. Respond and ask them to resend.");
    }
    if (voiceTranscript) {
      promptParts.push(`Voice transcript: ${voiceTranscript}`);
      promptParts.push("The user attached voice audio. Use the transcript as their spoken message.");
    } else if (hasVoice) {
      promptParts.push("The user attached voice audio, but it could not be transcribed. Respond and ask them to resend a clearer clip.");
    }
    if (documentInfo) {
      promptParts.push(`Document path: ${documentInfo.localPath}`);
      promptParts.push(`Original filename: ${documentInfo.originalName}`);
      promptParts.push("The user attached a document. Read and process this file directly.");
    } else if (hasDocument) {
      promptParts.push("The user attached a document, but downloading it failed. Respond and ask them to resend.");
    }
    const prefixedPrompt = promptParts.join(`
`);
    const result = await runUserMessage("telegram", prefixedPrompt);
    if (result.exitCode !== 0) {
      await sendMessage(config.token, chatId, `Error (exit ${result.exitCode}): ${result.stderr || "Unknown error"}`, threadId);
    } else {
      const { cleanedText: afterReact, reactionEmoji } = extractReactionDirective(result.stdout || "");
      const { cleanedText, filePaths } = extractSendFileDirectives(afterReact);
      if (reactionEmoji) {
        await sendReaction(config.token, chatId, message.message_id, reactionEmoji).catch((err) => {
          console.error(`[Telegram] Failed to send reaction for ${label}: ${err instanceof Error ? err.message : err}`);
        });
      }
      if (cleanedText) {
        await sendMessage(config.token, chatId, cleanedText, threadId);
      }
      for (const fp of filePaths) {
        try {
          await sendDocumentToChat(config.token, chatId, fp, threadId);
        } catch (err) {
          console.error(`[Telegram] Failed to send document for ${label}: ${err instanceof Error ? err.message : err}`);
          await sendMessage(config.token, chatId, `Failed to send file: ${fp.split("/").pop()}`, threadId);
        }
      }
      if (!cleanedText && filePaths.length === 0) {
        await sendMessage(config.token, chatId, "(empty response)", threadId);
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Telegram] Error for ${label}: ${errMsg}`);
    await sendMessage(config.token, chatId, `Error: ${errMsg}`, threadId);
  } finally {
    clearInterval(typingInterval);
  }
}
async function handleCallbackQuery(query) {
  const config = getSettings().telegram;
  const data = query.data ?? "";
  const secMatch = data.match(/^sec_(yes|no)_([0-9a-f]{8})$/);
  if (secMatch) {
    const action = secMatch[1];
    const pendingId = secMatch[2];
    let answerText = "\u26A0\uFE0F Server error";
    try {
      const resp = await fetch(`http://127.0.0.1:9999/confirm/${pendingId}/${action}`);
      const result = await resp.json();
      answerText = action === "yes" && result.ok ? "\u2705 \u0110\xE3 g\u1EEDi!" : result.ok ? "\u274C Dismissed" : "\u26A0\uFE0F Not found";
      if (query.message) {
        const statusLine = action === "yes" ? `

\u2705 Sent` : `

\u274C Dismissed`;
        const newText = (query.message.text ?? "").replace(/\n\nReply:.*$/s, statusLine);
        await callApi(config.token, "editMessageText", {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          text: newText
        }).catch(() => {});
      }
    } catch {}
    await callApi(config.token, "answerCallbackQuery", {
      callback_query_id: query.id,
      text: answerText
    }).catch(() => {});
    return;
  }
  await callApi(config.token, "answerCallbackQuery", { callback_query_id: query.id }).catch(() => {});
}
async function registerBotCommands(token) {
  try {
    const skills = await listSkills();
    const commands = [
      { command: "start", description: "Show welcome message" },
      { command: "reset", description: "Reset session and start fresh" },
      { command: "compact", description: "Compact session to reduce context size" },
      { command: "status", description: "Show current session status" },
      { command: "context", description: "Show context window usage" }
    ];
    for (const skill of skills) {
      const cmd = skill.name.toLowerCase().replace(/[-.:]/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 32);
      if (!cmd || cmd === "start" || cmd === "reset")
        continue;
      if (cmd.length > 30)
        continue;
      const desc = skill.description.length >= 3 ? skill.description.slice(0, 256) : `Run ${skill.name} skill`;
      commands.push({ command: cmd, description: desc });
    }
    if (commands.length > 100)
      commands.length = 100;
    try {
      await callApi(token, "setMyCommands", { commands });
      console.log(`  Commands registered: ${commands.length} (${commands.map((c) => "/" + c.command).join(", ")})`);
    } catch (regErr) {
      console.warn(`[Telegram] Full command registration failed, retrying with built-in commands only: ${regErr instanceof Error ? regErr.message : regErr}`);
      const builtinOnly = commands.filter((c) => ["start", "reset", "compact", "status", "context"].includes(c.command));
      await callApi(token, "setMyCommands", { commands: builtinOnly });
      console.log(`  Commands registered (built-in only): ${builtinOnly.length}`);
    }
  } catch (err) {
    console.error(`[Telegram] Failed to register commands: ${err instanceof Error ? err.message : err}`);
  }
}
async function poll() {
  const config = getSettings().telegram;
  let offset = 0;
  try {
    const me = await callApi(config.token, "getMe");
    if (me.ok) {
      botUsername = me.result.username ?? null;
      botId = me.result.id;
      console.log(`  Bot: ${botUsername ? `@${botUsername}` : botId}`);
      console.log(`  Group privacy: ${me.result.can_read_all_group_messages ? "disabled (reads all messages)" : "enabled (commands & mentions only)"}`);
    }
  } catch (err) {
    console.error(`[Telegram] getMe failed: ${err instanceof Error ? err.message : err}`);
  }
  console.log("Telegram bot started (long polling)");
  console.log(`  Allowed users: ${config.allowedUserIds.length === 0 ? "all" : config.allowedUserIds.join(", ")}`);
  if (telegramDebug)
    console.log("  Debug: enabled");
  registerBotCommands(config.token).catch(() => {});
  while (running) {
    try {
      const data = await callApi(config.token, "getUpdates", { offset, timeout: 30, allowed_updates: ["message", "my_chat_member", "callback_query"] });
      if (!data.ok || !data.result.length)
        continue;
      for (const update of data.result) {
        debugLog(`Update ${update.update_id} keys=${Object.keys(update).join(",")}`);
        offset = update.update_id + 1;
        const incomingMessages = [
          update.message,
          update.edited_message,
          update.channel_post,
          update.edited_channel_post
        ].filter((m) => Boolean(m));
        for (const incoming of incomingMessages) {
          enqueueMessage(incoming).catch((err) => {
            console.error(`[Telegram] Unhandled: ${err}`);
          });
        }
        if (update.my_chat_member) {
          handleMyChatMember(update.my_chat_member).catch((err) => {
            console.error(`[Telegram] my_chat_member unhandled: ${err}`);
          });
        }
        if (update.callback_query) {
          handleCallbackQuery(update.callback_query).catch((err) => {
            console.error(`[Telegram] callback_query unhandled: ${err}`);
          });
        }
      }
    } catch (err) {
      if (!running)
        break;
      console.error(`[Telegram] Poll error: ${err instanceof Error ? err.message : err}`);
      await Bun.sleep(5000);
    }
  }
}
function startPolling(debug = false) {
  telegramDebug = debug;
  (async () => {
    await ensureProjectClaudeMd();
    await poll();
  })().catch((err) => {
    console.error(`[Telegram] Fatal: ${err}`);
  });
}
async function telegram() {
  await loadSettings();
  await ensureProjectClaudeMd();
  await poll();
}
var API_BASE = "https://api.telegram.org/bot", FILE_API_BASE = "https://api.telegram.org/file/bot", telegramDebug = false, DOCUMENT_MIME_TYPES, botUsername = null, botId = null, messageQueue, isProcessing = false, running = true;
var init_telegram = __esm(() => {
  init_runner();
  init_config();
  init_sessions();
  init_whisper();
  init_skills();
  DOCUMENT_MIME_TYPES = new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "text/plain",
    "text/csv",
    "text/markdown"
  ]);
  messageQueue = [];
  process.on("SIGTERM", () => {
    running = false;
  });
  process.on("SIGINT", () => {
    running = false;
  });
});

// src/commands/discord.ts
var exports_discord = {};
__export(exports_discord, {
  stopGateway: () => stopGateway,
  startGateway: () => startGateway,
  sendMessageToUser: () => sendMessageToUser,
  sendMessage: () => sendMessage2,
  discord: () => discord
});
import { readFile as readFile9 } from "fs/promises";
import { existsSync as existsSync5 } from "fs";
import { homedir as homedir3 } from "os";
import { mkdir as mkdir6 } from "fs/promises";
import { extname as extname3, join as join14 } from "path";
function debugLog2(message) {
  if (!discordDebug)
    return;
  console.log(`[Discord][debug] ${message}`);
}
async function discordApi(token, method, endpoint, body) {
  const res = await fetch(`${DISCORD_API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 429) {
    const data = await res.json();
    const retryMs = Math.ceil(data.retry_after * 1000);
    debugLog2(`Rate limited on ${method} ${endpoint}, retrying in ${retryMs}ms`);
    await Bun.sleep(retryMs);
    return discordApi(token, method, endpoint, body);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord API ${method} ${endpoint}: ${res.status} ${res.statusText} ${text}`);
  }
  if (res.status === 204)
    return;
  return await res.json();
}
async function sendMessage2(token, channelId, text, components) {
  const normalized = text.replace(/\[react:[^\]\r\n]+\]/gi, "").trim();
  if (!normalized)
    return;
  const MAX_LEN = 2000;
  for (let i = 0;i < normalized.length; i += MAX_LEN) {
    const chunk = normalized.slice(i, i + MAX_LEN);
    const body = { content: chunk };
    if (components && i + MAX_LEN >= normalized.length) {
      body.components = components;
    }
    await discordApi(token, "POST", `/channels/${channelId}/messages`, body);
  }
}
async function sendMessageToUser(token, userId, text) {
  const channel = await discordApi(token, "POST", "/users/@me/channels", { recipient_id: userId });
  await sendMessage2(token, channel.id, text);
}
async function sendTyping2(token, channelId) {
  await discordApi(token, "POST", `/channels/${channelId}/typing`).catch(() => {});
}
async function sendReaction2(token, channelId, messageId, emoji) {
  const encoded = encodeURIComponent(emoji);
  await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`, {
    method: "PUT",
    headers: { Authorization: `Bot ${token}` }
  }).catch(() => {});
}
function extractReactionDirective2(text) {
  let reactionEmoji = null;
  const cleanedText = text.replace(/\[react:([^\]\r\n]+)\]/gi, (_match, raw) => {
    const candidate = String(raw).trim();
    if (!reactionEmoji && candidate)
      reactionEmoji = candidate;
    return "";
  }).replace(/[ \t]+\n/g, `
`).replace(/\n{3,}/g, `

`).trim();
  return { cleanedText, reactionEmoji };
}
function guildTriggerReason(message) {
  if (botUserId && message.referenced_message?.author?.id === botUserId)
    return "reply_to_bot";
  if (botUserId && message.mentions.some((m) => m.id === botUserId))
    return "mention";
  if (botUserId && message.content.includes(`<@${botUserId}>`))
    return "mention_in_content";
  const config = getSettings().discord;
  if (config.listenChannels.includes(message.channel_id))
    return "listen_channel";
  return null;
}
function isImageAttachment(a) {
  return Boolean(a.content_type?.startsWith("image/"));
}
function isVoiceAttachment(a) {
  if ((a.flags ?? 0) & 1 << 13)
    return true;
  return Boolean(a.content_type?.startsWith("audio/"));
}
async function downloadDiscordAttachment(attachment, type) {
  const dir = join14(process.cwd(), ".claude", "claudeclaw", "inbox", "discord");
  await mkdir6(dir, { recursive: true });
  const response = await fetch(attachment.url);
  if (!response.ok)
    throw new Error(`Discord attachment download failed: ${response.status}`);
  const ext = extname3(attachment.filename) || (type === "voice" ? ".ogg" : ".jpg");
  const filename = `${attachment.id}-${Date.now()}${ext}`;
  const localPath = join14(dir, filename);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await Bun.write(localPath, bytes);
  debugLog2(`Attachment downloaded: ${localPath} (${bytes.length} bytes)`);
  return localPath;
}
async function registerSlashCommands(token) {
  if (!applicationId)
    return;
  const commands = [
    {
      name: "start",
      description: "Show welcome message and usage instructions",
      type: 1
    },
    {
      name: "reset",
      description: "Reset the global session for a fresh start",
      type: 1
    },
    {
      name: "compact",
      description: "Compact session to reduce context size",
      type: 1
    },
    {
      name: "status",
      description: "Show current session status",
      type: 1
    },
    {
      name: "context",
      description: "Show context window usage",
      type: 1
    }
  ];
  await discordApi(token, "PUT", `/applications/${applicationId}/commands`, commands);
  debugLog2("Slash commands registered");
}
async function respondToInteraction(interaction, data) {
  await fetch(`${DISCORD_API}/interactions/${interaction.id}/${interaction.token}/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: 4,
      data
    })
  });
}
async function handleMessageCreate(token, message) {
  const config = getSettings().discord;
  if (message.author.bot)
    return;
  const userId = message.author.id;
  const channelId = message.channel_id;
  const isDM = !message.guild_id;
  const isGuild = !!message.guild_id;
  const content = message.content;
  const triggerReason = isGuild ? guildTriggerReason(message) : "direct_message";
  if (isGuild && !triggerReason) {
    debugLog2(`Skip guild message channel=${channelId} from=${userId} reason=no_trigger`);
    return;
  }
  debugLog2(`Handle message channel=${channelId} from=${userId} reason=${triggerReason} text="${content.slice(0, 80)}"`);
  if (config.allowedUserIds.length > 0 && !config.allowedUserIds.includes(userId)) {
    if (isDM) {
      await sendMessage2(config.token, channelId, "Unauthorized.");
    } else {
      debugLog2(`Skip guild message channel=${channelId} from=${userId} reason=unauthorized_user`);
    }
    return;
  }
  const imageAttachments = message.attachments.filter(isImageAttachment);
  const voiceAttachments = message.attachments.filter(isVoiceAttachment);
  const hasImage = imageAttachments.length > 0;
  const hasVoice = voiceAttachments.length > 0;
  if (!content.trim() && !hasImage && !hasVoice)
    return;
  let cleanContent = content;
  if (botUserId) {
    cleanContent = cleanContent.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
  }
  const label = message.author.username;
  const mediaParts = [hasImage ? "image" : "", hasVoice ? "voice" : ""].filter(Boolean);
  const mediaSuffix = mediaParts.length > 0 ? ` [${mediaParts.join("+")}]` : "";
  console.log(`[${new Date().toLocaleTimeString()}] Discord ${label}${mediaSuffix}: "${cleanContent.slice(0, 60)}${cleanContent.length > 60 ? "..." : ""}"`);
  const typingInterval = setInterval(() => sendTyping2(config.token, channelId), 8000);
  try {
    await sendTyping2(config.token, channelId);
    let imagePath = null;
    let voicePath = null;
    let voiceTranscript = null;
    if (hasImage) {
      try {
        imagePath = await downloadDiscordAttachment(imageAttachments[0], "image");
      } catch (err) {
        console.error(`[Discord] Failed to download image for ${label}: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (hasVoice) {
      try {
        voicePath = await downloadDiscordAttachment(voiceAttachments[0], "voice");
      } catch (err) {
        console.error(`[Discord] Failed to download voice for ${label}: ${err instanceof Error ? err.message : err}`);
      }
      if (voicePath) {
        try {
          debugLog2(`Voice file saved: path=${voicePath}`);
          voiceTranscript = await transcribeAudioToText(voicePath, {
            debug: discordDebug,
            log: (msg) => debugLog2(msg)
          });
        } catch (err) {
          console.error(`[Discord] Failed to transcribe voice for ${label}: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
    const command = cleanContent.startsWith("/") ? cleanContent.trim().split(/\s+/, 1)[0].toLowerCase() : null;
    let skillContext = null;
    if (command) {
      try {
        skillContext = await resolveSkillPrompt(command);
        if (skillContext) {
          debugLog2(`Skill resolved for ${command}: ${skillContext.length} chars`);
        }
      } catch (err) {
        debugLog2(`Skill resolution failed for ${command}: ${err instanceof Error ? err.message : err}`);
      }
    }
    const promptParts = [`[Discord from ${label}]`];
    if (skillContext) {
      const args = cleanContent.trim().slice(command.length).trim();
      promptParts.push(`<command-name>${command}</command-name>`);
      promptParts.push(skillContext);
      if (args)
        promptParts.push(`User arguments: ${args}`);
    } else if (cleanContent.trim()) {
      promptParts.push(`Message: ${cleanContent}`);
    }
    if (imagePath) {
      promptParts.push(`Image path: ${imagePath}`);
      promptParts.push("The user attached an image. Inspect this image file directly before answering.");
    } else if (hasImage) {
      promptParts.push("The user attached an image, but downloading it failed. Respond and ask them to resend.");
    }
    if (voiceTranscript) {
      promptParts.push(`Voice transcript: ${voiceTranscript}`);
      promptParts.push("The user attached voice audio. Use the transcript as their spoken message.");
    } else if (hasVoice) {
      promptParts.push("The user attached voice audio, but it could not be transcribed. Respond and ask them to resend a clearer clip.");
    }
    const prefixedPrompt = promptParts.join(`
`);
    const result = await runUserMessage("discord", prefixedPrompt);
    if (result.exitCode !== 0) {
      await sendMessage2(config.token, channelId, `Error (exit ${result.exitCode}): ${result.stderr || "Unknown error"}`);
    } else {
      const { cleanedText, reactionEmoji } = extractReactionDirective2(result.stdout || "");
      if (reactionEmoji) {
        await sendReaction2(config.token, channelId, message.id, reactionEmoji).catch((err) => {
          console.error(`[Discord] Failed to send reaction for ${label}: ${err instanceof Error ? err.message : err}`);
        });
      }
      await sendMessage2(config.token, channelId, cleanedText || "(empty response)");
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Discord] Error for ${label}: ${errMsg}`);
    await sendMessage2(config.token, channelId, `Error: ${errMsg}`);
  } finally {
    clearInterval(typingInterval);
  }
}
async function handleInteractionCreate(token, interaction) {
  const config = getSettings().discord;
  const actorId = interaction.member?.user?.id ?? interaction.user?.id;
  if (config.allowedUserIds.length > 0 && (!actorId || !config.allowedUserIds.includes(actorId))) {
    await respondToInteraction(interaction, { content: "Unauthorized.", flags: 64 });
    return;
  }
  if (interaction.type === 2 && interaction.data?.name) {
    if (interaction.data.name === "start") {
      await respondToInteraction(interaction, {
        content: "Hello! Send me a message and I'll respond using Claude.\nUse `/reset` to start a fresh session."
      });
      return;
    }
    if (interaction.data.name === "reset") {
      await resetSession();
      await respondToInteraction(interaction, {
        content: "Global session reset. Next message starts fresh."
      });
      return;
    }
    if (interaction.data.name === "compact") {
      await respondToInteraction(interaction, { content: "\u23F3 Compacting session..." });
      const result = await compactCurrentSession();
      await fetch(`${DISCORD_API}/webhooks/${applicationId}/${interaction.token}/messages/@original`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: result.message })
      });
      return;
    }
    if (interaction.data.name === "status") {
      const session = await peekSession();
      const settings = getSettings();
      if (!session) {
        await respondToInteraction(interaction, { content: "\uD83D\uDCCA No active session." });
        return;
      }
      const lines = [
        "\uD83D\uDCCA **Session Status**",
        `Session: \`${session.sessionId.slice(0, 8)}\``,
        `Turns: ${session.turnCount ?? 0}`,
        `Model: ${settings.model || "default"}`,
        `Security: ${settings.security.level}`,
        `Created: ${session.createdAt}`,
        `Last used: ${session.lastUsedAt}`,
        `Compact warned: ${session.compactWarned ? "yes" : "no"}`
      ];
      await respondToInteraction(interaction, { content: lines.join(`
`) });
      return;
    }
    if (interaction.data.name === "context") {
      const session = await peekSession();
      if (!session) {
        await respondToInteraction(interaction, { content: "No active session." });
        return;
      }
      const home = homedir3();
      const projectSlug = process.cwd().replace(/\//g, "-");
      const jsonlPath = `${home}/.claude/projects/${projectSlug}/${session.sessionId}.jsonl`;
      if (!existsSync5(jsonlPath)) {
        await respondToInteraction(interaction, { content: "Conversation file not found." });
        return;
      }
      try {
        const raw = await readFile9(jsonlPath, "utf8");
        const fileLines = raw.trim().split(`
`);
        let lastUsage = null;
        let totalOutput = 0;
        for (const line of fileLines) {
          try {
            const obj = JSON.parse(line);
            if (obj.message?.usage)
              lastUsage = obj.message.usage;
            if (obj.message?.usage?.output_tokens)
              totalOutput += obj.message.usage.output_tokens;
          } catch {}
        }
        if (!lastUsage) {
          await respondToInteraction(interaction, { content: "No usage data found." });
          return;
        }
        const input = lastUsage.input_tokens ?? 0;
        const cacheCreation = lastUsage.cache_creation_input_tokens ?? 0;
        const cacheRead = lastUsage.cache_read_input_tokens ?? 0;
        const totalContext = input + cacheCreation + cacheRead;
        const maxContext = 200000;
        const pct = (totalContext / maxContext * 100).toFixed(1);
        const filled = Math.round(Math.min(totalContext / maxContext, 1) * 20);
        const bar = "\u2588".repeat(filled) + "\u2591".repeat(20 - filled);
        const msg = [
          `\uD83D\uDCD0 **Context Window**`,
          `${bar} ${pct}%`,
          ``,
          `Total: \`${totalContext.toLocaleString()}\` / \`${maxContext.toLocaleString()}\` tokens`,
          `\u251C Input: \`${input.toLocaleString()}\``,
          `\u251C Cache creation: \`${cacheCreation.toLocaleString()}\``,
          `\u251C Cache read: \`${cacheRead.toLocaleString()}\``,
          `\u2514 Output (cumulative): \`${totalOutput.toLocaleString()}\``,
          ``,
          `Turns: ${session.turnCount ?? 0}`
        ];
        await respondToInteraction(interaction, { content: msg.join(`
`) });
      } catch (err) {
        await respondToInteraction(interaction, {
          content: `Failed to read context: ${err instanceof Error ? err.message : err}`
        });
      }
      return;
    }
    await respondToInteraction(interaction, { content: "Unknown command." });
    return;
  }
  if (interaction.type === 3 && interaction.data?.custom_id) {
    const customId = interaction.data.custom_id;
    const secMatch = customId.match(/^sec_(yes|no)_([0-9a-f]{8})$/);
    if (secMatch) {
      const action = secMatch[1];
      const pendingId = secMatch[2];
      let responseText = "Server error";
      try {
        const resp = await fetch(`http://127.0.0.1:9999/confirm/${pendingId}/${action}`);
        const result = await resp.json();
        responseText = action === "yes" && result.ok ? "Sent!" : result.ok ? "Dismissed" : "Not found";
      } catch {}
      await respondToInteraction(interaction, {
        content: responseText,
        flags: 64
      });
      return;
    }
    await respondToInteraction(interaction, { content: "OK", flags: 64 });
    return;
  }
  await respondToInteraction(interaction, { content: "OK", flags: 64 });
}
async function handleGuildCreate(token, guild) {
  const config = getSettings().discord;
  if (readyGuildIds?.has(guild.id))
    return;
  const channelId = guild.system_channel_id;
  if (!channelId)
    return;
  console.log(`[Discord] Joined guild: ${guild.name} (${guild.id})`);
  const eventPrompt = `[Discord system event] I was added to a guild.
` + `Guild name: ${guild.name}
` + `Guild id: ${guild.id}
` + "Write a short first message for the server. Confirm I was added and explain how to trigger me (mention or reply).";
  try {
    const result = await run("discord", eventPrompt);
    if (result.exitCode !== 0) {
      await sendMessage2(config.token, channelId, "I was added to this server. Mention me to start.");
      return;
    }
    await sendMessage2(config.token, channelId, result.stdout || "I was added to this server.");
  } catch {
    await sendMessage2(config.token, channelId, "I was added to this server. Mention me to start.");
  }
}
function sendWs(data) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}
function sendHeartbeat() {
  sendWs({ op: GatewayOp.HEARTBEAT, d: lastSequence });
  heartbeatAcked = false;
}
function startHeartbeat() {
  stopHeartbeat();
  heartbeatJitterTimer = setTimeout(() => {
    heartbeatJitterTimer = null;
    sendHeartbeat();
  }, Math.random() * heartbeatIntervalMs);
  heartbeatTimer = setInterval(() => {
    if (!heartbeatAcked) {
      debugLog2("Heartbeat not acked, reconnecting");
      ws?.close(4000, "Heartbeat timeout");
      return;
    }
    sendHeartbeat();
  }, heartbeatIntervalMs);
}
function stopHeartbeat() {
  if (heartbeatTimer)
    clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  if (heartbeatJitterTimer)
    clearTimeout(heartbeatJitterTimer);
  heartbeatJitterTimer = null;
}
function resetGatewayState() {
  heartbeatIntervalMs = 0;
  heartbeatAcked = true;
  lastSequence = null;
  gatewaySessionId = null;
  resumeGatewayUrl = null;
  readyGuildIds = null;
  botUserId = null;
  botUsername2 = null;
  applicationId = null;
}
function sendIdentify(token) {
  sendWs({
    op: GatewayOp.IDENTIFY,
    d: {
      token,
      intents: INTENTS,
      properties: {
        os: process.platform,
        browser: "claudeclaw",
        device: "claudeclaw"
      }
    }
  });
}
function sendResume(token) {
  sendWs({
    op: GatewayOp.RESUME,
    d: {
      token,
      session_id: gatewaySessionId,
      seq: lastSequence
    }
  });
}
function handleDispatch(token, eventName, data) {
  debugLog2(`Dispatch: ${eventName}`);
  switch (eventName) {
    case "READY":
      gatewaySessionId = data.session_id;
      resumeGatewayUrl = data.resume_gateway_url;
      botUserId = data.user.id;
      botUsername2 = data.user.username;
      applicationId = data.application.id;
      readyGuildIds = new Set((data.guilds ?? []).map((g) => g.id));
      console.log(`[Discord] Ready as ${data.user.username} (${data.user.id})`);
      registerSlashCommands(token).catch((err) => console.error(`[Discord] Failed to register slash commands: ${err}`));
      break;
    case "RESUMED":
      debugLog2("Session resumed successfully");
      break;
    case "MESSAGE_CREATE":
      handleMessageCreate(token, data).catch((err) => console.error(`[Discord] MESSAGE_CREATE unhandled: ${err}`));
      break;
    case "INTERACTION_CREATE":
      handleInteractionCreate(token, data).catch((err) => console.error(`[Discord] INTERACTION_CREATE unhandled: ${err}`));
      break;
    case "GUILD_CREATE":
      handleGuildCreate(token, data).catch((err) => console.error(`[Discord] GUILD_CREATE unhandled: ${err}`));
      break;
  }
}
function handleGatewayPayload(token, payload) {
  if (payload.s !== null)
    lastSequence = payload.s;
  switch (payload.op) {
    case GatewayOp.HELLO:
      heartbeatIntervalMs = payload.d.heartbeat_interval;
      startHeartbeat();
      if (gatewaySessionId && lastSequence !== null) {
        sendResume(token);
      } else {
        sendIdentify(token);
      }
      break;
    case GatewayOp.HEARTBEAT_ACK:
      heartbeatAcked = true;
      break;
    case GatewayOp.HEARTBEAT:
      sendHeartbeat();
      break;
    case GatewayOp.RECONNECT:
      debugLog2("Gateway requested reconnect");
      ws?.close(4000, "Reconnect requested");
      break;
    case GatewayOp.INVALID_SESSION: {
      const resumable = payload.d;
      debugLog2(`Invalid session, resumable=${resumable}`);
      if (!resumable) {
        gatewaySessionId = null;
        lastSequence = null;
      }
      setTimeout(() => {
        if (resumable && gatewaySessionId) {
          sendResume(token);
        } else {
          sendIdentify(token);
        }
      }, 1000 + Math.random() * 4000);
      break;
    }
    case GatewayOp.DISPATCH:
      handleDispatch(token, payload.t, payload.d);
      break;
  }
}
function connectGateway(token, url) {
  const gatewayUrl = url || GATEWAY_URL;
  debugLog2(`Connecting to gateway: ${gatewayUrl}`);
  ws = new WebSocket(gatewayUrl);
  ws.onopen = () => {
    debugLog2("Gateway WebSocket opened");
  };
  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(String(event.data));
      handleGatewayPayload(token, payload);
    } catch (err) {
      console.error(`[Discord] Failed to parse gateway payload: ${err}`);
    }
  };
  ws.onclose = (event) => {
    debugLog2(`Gateway closed: code=${event.code} reason=${event.reason}`);
    stopHeartbeat();
    if (!running2)
      return;
    if (FATAL_CLOSE_CODES.has(event.code)) {
      console.error(`[Discord] Fatal close code ${event.code}: ${event.reason}. Not reconnecting.`);
      return;
    }
    const canResume = gatewaySessionId && lastSequence !== null;
    if (canResume) {
      debugLog2("Attempting resume...");
      setTimeout(() => connectGateway(token, resumeGatewayUrl || undefined), 1000 + Math.random() * 2000);
    } else {
      gatewaySessionId = null;
      lastSequence = null;
      resumeGatewayUrl = null;
      setTimeout(() => connectGateway(token), 3000 + Math.random() * 4000);
    }
  };
  ws.onerror = () => {};
}
function stopGateway() {
  running2 = false;
  stopHeartbeat();
  if (ws) {
    try {
      ws.close(1000, "Gateway stop requested");
    } catch {}
    ws = null;
  }
  resetGatewayState();
}
function startGateway(debug = false) {
  discordDebug = debug;
  const config = getSettings().discord;
  if (ws)
    stopGateway();
  running2 = true;
  console.log("Discord bot started (gateway)");
  console.log(`  Allowed users: ${config.allowedUserIds.length === 0 ? "all" : config.allowedUserIds.join(", ")}`);
  if (config.listenChannels.length > 0) {
    console.log(`  Listen channels: ${config.listenChannels.join(", ")}`);
  }
  if (discordDebug)
    console.log("  Debug: enabled");
  (async () => {
    await ensureProjectClaudeMd();
    connectGateway(config.token);
  })().catch((err) => {
    console.error(`[Discord] Fatal: ${err}`);
  });
}
async function discord() {
  await loadSettings();
  await ensureProjectClaudeMd();
  const config = getSettings().discord;
  if (!config.token) {
    console.error("Discord token not configured. Set discord.token in .claude/claudeclaw/settings.json");
    process.exit(1);
  }
  console.log("Discord bot started (gateway, standalone)");
  console.log(`  Allowed users: ${config.allowedUserIds.length === 0 ? "all" : config.allowedUserIds.join(", ")}`);
  if (discordDebug)
    console.log("  Debug: enabled");
  connectGateway(config.token);
  await new Promise(() => {});
}
var DISCORD_API = "https://discord.com/api/v10", GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json", GatewayOp, INTENTS, ws = null, heartbeatIntervalMs = 0, heartbeatTimer = null, heartbeatJitterTimer = null, lastSequence = null, gatewaySessionId = null, resumeGatewayUrl = null, heartbeatAcked = true, running2 = true, discordDebug = false, botUserId = null, botUsername2 = null, applicationId = null, readyGuildIds = null, FATAL_CLOSE_CODES;
var init_discord = __esm(() => {
  init_runner();
  init_config();
  init_sessions();
  init_whisper();
  init_skills();
  GatewayOp = {
    DISPATCH: 0,
    HEARTBEAT: 1,
    IDENTIFY: 2,
    RESUME: 6,
    RECONNECT: 7,
    INVALID_SESSION: 9,
    HELLO: 10,
    HEARTBEAT_ACK: 11
  };
  INTENTS = 1 << 0 | 1 << 9 | 1 << 10 | 1 << 12 | 1 << 15;
  FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
  process.on("SIGTERM", () => {
    stopGateway();
  });
  process.on("SIGINT", () => {
    stopGateway();
  });
});

// src/commands/start.ts
init_runner();
import { writeFile as writeFile5, unlink as unlink3, mkdir as mkdir7 } from "fs/promises";
import { join as join15 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// src/statusline.ts
import { join as join5 } from "path";
var HEARTBEAT_DIR4 = join5(process.cwd(), ".claude", "claudeclaw");
async function writeState(state) {
  await Bun.write(join5(HEARTBEAT_DIR4, "state.json"), JSON.stringify(state) + `
`);
}

// src/cron.ts
init_timezone();
function matchCronField(field, value) {
  for (const part of field.split(",")) {
    const [range, stepStr] = part.split("/");
    const step = stepStr ? parseInt(stepStr) : 1;
    if (range === "*") {
      if (value % step === 0)
        return true;
      continue;
    }
    if (range.includes("-")) {
      const [lo, hi] = range.split("-").map(Number);
      if (value >= lo && value <= hi && (value - lo) % step === 0)
        return true;
      continue;
    }
    if (parseInt(range) === value)
      return true;
  }
  return false;
}
function cronMatches(expr, date, timezoneOffsetMinutes = 0) {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = expr.trim().split(/\s+/);
  const shifted = shiftDateToOffset(date, timezoneOffsetMinutes);
  const d = {
    minute: shifted.getUTCMinutes(),
    hour: shifted.getUTCHours(),
    dayOfMonth: shifted.getUTCDate(),
    month: shifted.getUTCMonth() + 1,
    dayOfWeek: shifted.getUTCDay()
  };
  return matchCronField(minute, d.minute) && matchCronField(hour, d.hour) && matchCronField(dayOfMonth, d.dayOfMonth) && matchCronField(month, d.month) && matchCronField(dayOfWeek, d.dayOfWeek);
}
function nextCronMatch(expr, after, timezoneOffsetMinutes = 0) {
  const d = new Date(after);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0;i < 2880; i++) {
    if (cronMatches(expr, d, timezoneOffsetMinutes))
      return d;
    d.setMinutes(d.getMinutes() + 1);
  }
  return d;
}

// src/jobs.ts
import { readdir as readdir2 } from "fs/promises";
import { join as join6 } from "path";
var JOBS_DIR2 = join6(process.cwd(), ".claude", "claudeclaw", "jobs");
function parseFrontmatterValue(raw) {
  return raw.trim().replace(/^["']|["']$/g, "");
}
function parseJobFile(name, content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    console.error(`Invalid job file format: ${name}`);
    return null;
  }
  const frontmatter = match[1];
  const prompt = match[2].trim();
  const lines = frontmatter.split(`
`).map((l) => l.trim());
  const scheduleLine = lines.find((l) => l.startsWith("schedule:"));
  if (!scheduleLine) {
    return null;
  }
  const schedule = parseFrontmatterValue(scheduleLine.replace("schedule:", ""));
  const recurringLine = lines.find((l) => l.startsWith("recurring:"));
  const dailyLine = lines.find((l) => l.startsWith("daily:"));
  const recurringRaw = recurringLine ? parseFrontmatterValue(recurringLine.replace("recurring:", "")).toLowerCase() : dailyLine ? parseFrontmatterValue(dailyLine.replace("daily:", "")).toLowerCase() : "";
  const recurring = recurringRaw === "true" || recurringRaw === "yes" || recurringRaw === "1";
  const notifyLine = lines.find((l) => l.startsWith("notify:"));
  const notifyRaw = notifyLine ? parseFrontmatterValue(notifyLine.replace("notify:", "")).toLowerCase() : "";
  const notify = notifyRaw === "false" || notifyRaw === "no" ? false : notifyRaw === "error" ? "error" : true;
  return { name, schedule, prompt, recurring, notify };
}
async function loadJobs() {
  const jobs = [];
  let files;
  try {
    files = await readdir2(JOBS_DIR2);
  } catch {
    return jobs;
  }
  for (const file of files) {
    if (!file.endsWith(".md"))
      continue;
    const content = await Bun.file(join6(JOBS_DIR2, file)).text();
    const job = parseJobFile(file.replace(/\.md$/, ""), content);
    if (job)
      jobs.push(job);
  }
  return jobs;
}
async function clearJobSchedule(jobName) {
  const path = join6(JOBS_DIR2, `${jobName}.md`);
  const content = await Bun.file(path).text();
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match)
    return;
  const filteredFrontmatter = match[1].split(`
`).filter((line) => !line.trim().startsWith("schedule:")).join(`
`).trim();
  const body = match[2].trim();
  const next = `---
${filteredFrontmatter}
---
${body}
`;
  await Bun.write(path, next);
}

// src/pid.ts
import { writeFile as writeFile2, unlink as unlink2, readFile as readFile2 } from "fs/promises";
import { join as join7 } from "path";
var PID_FILE = join7(process.cwd(), ".claude", "claudeclaw", "daemon.pid");
function getPidPath() {
  return PID_FILE;
}
async function checkExistingDaemon() {
  let raw;
  try {
    raw = (await readFile2(PID_FILE, "utf-8")).trim();
  } catch {
    return null;
  }
  const pid = Number(raw);
  if (!pid || isNaN(pid)) {
    await cleanupPidFile();
    return null;
  }
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    await cleanupPidFile();
    return null;
  }
}
async function writePidFile() {
  await writeFile2(PID_FILE, String(process.pid) + `
`);
}
async function cleanupPidFile() {
  try {
    await unlink2(PID_FILE);
  } catch {}
}

// src/commands/start.ts
init_config();
init_timezone();

// src/ui/page/styles.ts
var pageStyles = String.raw`    :root {
      --bg-top: #2a4262;
      --bg-bottom: #0d1828;
      --bg-spot-a: #7fb8ff3d;
      --bg-spot-b: #95d1ff38;
      --text: #f0f4fb;
      --muted: #a8b4c5;
      --panel: #0b1220aa;
      --border: #d8e4ff1f;
      --accent: #9be7ff;
      --good: #67f0b5;
      --bad: #ff7f7f;
      --warn: #ffc276;
    }

    * { box-sizing: border-box; }
    [hidden] { display: none !important; }

    html, body {
      width: 100%;
      min-height: 100%;
      margin: 0;
    }

    body {
      font-family: "Space Grotesk", system-ui, sans-serif;
      color: var(--text);
      background:
        radial-gradient(1400px 700px at 15% -10%, var(--bg-spot-a), transparent 60%),
        radial-gradient(900px 500px at 85% 10%, var(--bg-spot-b), transparent 65%),
        linear-gradient(180deg, var(--bg-top) 0%, var(--bg-bottom) 100%);
      overflow-x: hidden;
      overflow-y: auto;
      position: relative;
      transition: background 320ms ease;
    }

    body.day-mode {
      --bg-top: #2a4262;
      --bg-bottom: #0d1828;
      --bg-spot-a: #7fb8ff3d;
      --bg-spot-b: #95d1ff38;
    }

    body.night-mode {
      --bg-top: #101b2a;
      --bg-bottom: #02040a;
      --bg-spot-a: #3557822b;
      --bg-spot-b: #4a7ab42a;
    }

    body.night-mode .message {
      color: #d2ddef;
      font-family: "JetBrains Mono", monospace;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .grain {
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: 0.08;
      background-image: radial-gradient(#fff 0.5px, transparent 0.5px);
      background-size: 3px 3px;
      animation: drift 16s linear infinite;
    }

    @keyframes drift {
      from { transform: translateY(0); }
      to { transform: translateY(-12px); }
    }

    .stage {
      min-height: 100vh;
      display: grid;
      justify-items: center;
      align-items: start;
      padding: 64px 16px 120px;
      position: relative;
      z-index: 1;
    }

    .hero {
      text-align: center;
      width: min(820px, 100%);
      animation: rise 700ms ease-out both;
    }

    .logo-art {
      width: 12ch;
      margin: 0 auto 18px;
      transform: translateX(-0.75ch);
      color: #dbe7ff;
      filter: drop-shadow(0 8px 20px #00000040);
    }
    .logo-top {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 8ch;
      font-size: 18px;
      line-height: 1.1;
      margin-bottom: 2px;
      transform: translateX(1.35ch);
    }
    .logo-body {
      margin: 0;
      white-space: pre;
      font-family: "JetBrains Mono", monospace;
      font-size: 20px;
      letter-spacing: 0;
      line-height: 1.08;
      text-align: left;
    }
    .typewriter {
      margin: 6px 0 14px;
      min-height: 1.4em;
      font-family: "JetBrains Mono", monospace;
      font-size: clamp(0.9rem, 1.8vw, 1.05rem);
      color: #c8d6ec;
      letter-spacing: 0.02em;
    }
    .typewriter::after {
      content: "";
      display: inline-block;
      width: 0.62ch;
      height: 1.05em;
      margin-left: 0.18ch;
      vertical-align: -0.12em;
      background: #c8d6ec;
      animation: caret 1s step-end infinite;
    }

    @keyframes caret {
      0%, 49% { opacity: 1; }
      50%, 100% { opacity: 0; }
    }

    @keyframes rise {
      from { opacity: 0; transform: translateY(18px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .time {
      display: block;
      width: 100%;
      font-family: "Fraunces", serif;
      font-size: clamp(4.2rem, 15vw, 10rem);
      line-height: 0.95;
      letter-spacing: -0.04em;
      font-variant-numeric: tabular-nums;
      text-align: center;
      text-shadow: 0 10px 35px #00000055;
      transition: text-shadow 280ms ease;
    }

    .time.ms-pulse {
      text-shadow: 0 10px 40px #7dc5ff4d;
    }

    .date {
      margin-top: 14px;
      font-size: clamp(1rem, 2.4vw, 1.3rem);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 500;
    }

    .message {
      margin-top: 28px;
      font-size: clamp(1rem, 2.1vw, 1.35rem);
      color: #e4ecf8;
      font-weight: 500;
    }
    .quick-job {
      margin: 20px auto 0;
      width: min(720px, 100%);
      padding: 14px;
      border: 1px solid #ffffff22;
      border-radius: 16px;
      background:
        radial-gradient(120% 100% at 100% 0%, #7dc5ff1a, transparent 55%),
        linear-gradient(180deg, #0e1a2a88 0%, #0a1220a8 100%);
      backdrop-filter: blur(6px);
      box-shadow: 0 14px 34px #00000045;
      display: grid;
      gap: 12px;
      text-align: left;
    }
    .quick-job-head {
      display: grid;
      gap: 3px;
    }
    .quick-job-head-row {
      display: flex;
      justify-content: space-between;
      align-items: start;
      gap: 10px;
    }
    .quick-job-title {
      font-family: "Fraunces", serif;
      font-size: clamp(1.1rem, 2.2vw, 1.4rem);
      letter-spacing: 0.01em;
      color: #f4f8ff;
      line-height: 1.1;
    }
    .quick-job-sub {
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      color: #c9daef;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }
    .quick-jobs-next {
      margin-top: 6px;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      color: #9fd6ff;
      letter-spacing: 0.03em;
    }
    .quick-job-grid {
      display: grid;
      grid-template-columns: minmax(220px, 260px) minmax(0, 1fr);
      gap: 10px;
      align-items: stretch;
    }
    .quick-field {
      border: 1px solid #ffffff1c;
      border-radius: 12px;
      background: #0c1624a6;
      padding: 10px;
      display: grid;
      gap: 8px;
    }
    .quick-label {
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #bfd4ef;
    }
    .quick-input,
    .quick-prompt,
    .quick-submit {
      border: 0;
      font-family: "JetBrains Mono", monospace;
      font-size: 13px;
      color: #eef4ff;
      background: transparent;
    }
    .quick-input {
      height: 42px;
      width: 100%;
      padding: 0 11px;
      border-radius: 10px;
      border: 1px solid #ffffff2e;
      background: #ffffff09;
      appearance: textfield;
      -moz-appearance: textfield;
    }
    .quick-input::-webkit-outer-spin-button,
    .quick-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .quick-input-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 42px;
      padding: 0 6px 0 11px;
      border-radius: 10px;
      border: 1px solid #ffffff2e;
      background: #ffffff09;
    }
    .quick-input-wrap .quick-input {
      height: 100%;
      flex: 1 1 auto;
      min-width: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      padding: 0;
    }
    .quick-input:focus-visible,
    .quick-prompt:focus-visible {
      outline: 1px solid #7dc5ff88;
      outline-offset: 1px;
    }
    .quick-input-wrap:focus-within {
      outline: 1px solid #7dc5ff88;
      outline-offset: 1px;
    }
    .quick-input-wrap .quick-input:focus-visible {
      outline: none;
    }
    .quick-time-buttons {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .quick-add {
      height: 27px;
      padding: 0 10px;
      border: 1px solid #ffffff2c;
      border-radius: 999px;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      letter-spacing: 0.03em;
      color: #daebff;
      background: #ffffff12;
      cursor: pointer;
      transition: background 0.16s ease, transform 0.16s ease, border-color 0.16s ease;
    }
    .quick-add:hover {
      background: #ffffff22;
      border-color: #ffffff44;
      transform: translateY(-1px);
    }
    .quick-preview {
      min-height: 1.2em;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      color: #a8f1ca;
    }
    .quick-check {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: fit-content;
      min-height: 29px;
      padding: 0 12px;
      border: 1px solid #ff7f7f55;
      border-radius: 999px;
      background: #34181855;
      color: #ff9b9b;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      cursor: pointer;
      transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, transform 0.16s ease;
      user-select: none;
    }
    .quick-check-inline {
      position: static;
      min-height: 28px;
      padding: 0 10px;
      flex: 0 0 auto;
    }
    .quick-check:hover {
      transform: translateY(-1px);
    }
    .quick-check-inline:hover {
      transform: none;
    }
    .quick-check:has(input:checked) {
      background: #11342455;
      border-color: #67f0b560;
      color: #67f0b5;
    }
    .quick-check input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .quick-check:focus-within {
      outline: 1px solid #7dc5ff88;
      outline-offset: 2px;
    }
    .quick-prompt {
      width: 100%;
      min-height: 106px;
      padding: 10px 11px;
      resize: vertical;
      border: 1px solid #ffffff2e;
      border-radius: 10px;
      background: #ffffff09;
      line-height: 1.4;
    }
    .quick-prompt-meta {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      color: #c3d6ef;
    }
    .quick-job-actions {
      display: grid;
      grid-template-columns: 170px minmax(0, 1fr);
      gap: 10px;
      align-items: center;
    }
    .quick-submit {
      height: 42px;
      width: 100%;
      cursor: pointer;
      border-radius: 999px;
      border: 1px solid #3cb87980;
      background: linear-gradient(180deg, #1f6f47d4 0%, #18563ace 100%);
      color: #c8f8de;
      font-weight: 600;
      transition: transform 0.16s ease, filter 0.16s ease, opacity 0.16s ease;
    }
    .quick-submit:hover {
      transform: translateY(-1px);
      filter: brightness(1.06);
    }
    .quick-submit:disabled {
      opacity: 0.72;
      cursor: wait;
      transform: none;
      filter: none;
    }
    .quick-status {
      min-height: 1.2em;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      color: #cde0f7;
      opacity: 0.95;
    }
    .quick-open-create,
    .quick-back-jobs {
      height: 33px;
      padding: 0 12px;
      border: 1px solid #ffffff2c;
      border-radius: 999px;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      letter-spacing: 0.03em;
      color: #daebff;
      background: #ffffff12;
      cursor: pointer;
      transition: background 0.16s ease, transform 0.16s ease, border-color 0.16s ease;
    }
    .quick-open-create:hover,
    .quick-back-jobs:hover {
      background: #ffffff22;
      border-color: #ffffff44;
      transform: translateY(-1px);
    }
    .quick-form-foot {
      border-top: 1px solid #ffffff1a;
      padding-top: 10px;
      display: flex;
      justify-content: flex-end;
    }
    .quick-jobs-list {
      display: grid;
      gap: 6px;
      max-height: 170px;
      overflow: auto;
      padding-right: 4px;
    }
    .quick-jobs-list-main {
      max-height: 280px;
    }
    .quick-job-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      padding: 8px 10px;
      border: 1px solid #ffffff1d;
      border-radius: 10px;
      background: #0b1422a8;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
    }
    .quick-job-item-main {
      min-width: 0;
      display: grid;
      gap: 4px;
    }
    .quick-job-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
      border: 0;
      padding: 0;
      margin: 0;
      background: transparent;
      width: 100%;
      text-align: left;
      color: inherit;
      cursor: pointer;
    }
    .quick-job-item-time {
      color: #bde8ff;
      white-space: nowrap;
    }
    .quick-job-item-name {
      color: #d8e4f7;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: left;
    }
    .quick-job-item-cooldown {
      color: #a8f1ca;
      white-space: nowrap;
    }
    .quick-job-item-details {
      border-top: 1px solid #ffffff17;
      margin-top: 2px;
      padding-top: 8px;
      display: grid;
      gap: 6px;
      color: #c7d8ee;
    }
    .quick-job-prompt-full {
      margin: 0;
      padding: 8px;
      border-radius: 8px;
      background: #070f1a;
      border: 1px solid #ffffff14;
      color: #e4eefb;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 180px;
      overflow: auto;
    }
    .quick-job-delete {
      align-self: center;
      height: 28px;
      padding: 0 10px;
      border: 1px solid #ff7f7f40;
      border-radius: 999px;
      font-family: "JetBrains Mono", monospace;
      font-size: 10px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #ffadad;
      background: #3a141455;
      cursor: pointer;
      transition: background 0.16s ease, transform 0.16s ease, border-color 0.16s ease;
    }
    .quick-job-delete:hover {
      background: #4d191970;
      border-color: #ff8f8f6b;
      transform: translateY(-1px);
    }
    .quick-job-delete:disabled {
      opacity: 0.65;
      cursor: wait;
      transform: none;
    }
    .quick-jobs-empty {
      padding: 8px 10px;
      border: 1px dashed #ffffff22;
      border-radius: 10px;
      color: #b8cae3;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
    }
    .quick-view-hidden {
      display: none;
    }
    .settings-btn {
      position: fixed;
      top: 52px;
      right: 18px;
      z-index: 5;
      border: 1px solid #ffffff2a;
      background: #0b1220c7;
      color: #dce7f8;
      backdrop-filter: blur(8px);
      border-radius: 999px;
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 10px 14px;
      cursor: pointer;
      transition: transform 0.16s ease, background 0.16s ease, border-color 0.16s ease;
    }
    .settings-btn:hover {
      transform: translateY(-1px);
      background: #122038d0;
      border-color: #ffffff45;
    }
    .repo-cta {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 5;
      height: 34px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 0 12px;
      border-radius: 0;
      text-decoration: none;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #f1f6ff;
      background: linear-gradient(180deg, #ffffff18, #ffffff0d);
      backdrop-filter: blur(6px);
      border-bottom: 1px solid #ffffff22;
      animation: ctaEnter 420ms ease-out both;
      transition: background 0.18s ease;
    }
    .repo-cta:hover {
      background: linear-gradient(180deg, #ffffff22, #ffffff12);
    }
    .repo-text {
      opacity: 0.92;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .repo-star {
      color: #ffe08f;
      animation: starPulse 1.8s ease-in-out infinite;
    }
    @keyframes ctaEnter {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes starPulse {
      0%, 100% { opacity: 0.78; }
      50% { opacity: 1; }
    }
    .settings-modal {
      position: fixed;
      top: 94px;
      right: 18px;
      width: min(320px, calc(100vw - 36px));
      z-index: 6;
      border: 1px solid #d8e4ff20;
      border-radius: 14px;
      background: #0b1220b8;
      backdrop-filter: blur(10px);
      box-shadow: 0 18px 36px #0000005a;
      padding: 12px;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translateY(-8px) scale(0.98);
      transition: opacity 0.2s ease, transform 0.2s ease, visibility 0s linear 0.2s;
    }
    .settings-modal.open {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translateY(0) scale(1);
      transition: opacity 0.2s ease, transform 0.2s ease, visibility 0s linear 0s;
    }
    .settings-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #9eb5d6;
      margin-bottom: 6px;
    }
    .settings-close {
      border: none;
      background: transparent;
      color: #9eb5d6;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      padding: 0 2px;
    }
    .setting-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 2px;
      border-top: 1px solid #ffffff12;
    }
    .settings-stack {
      display: flex;
      flex-direction: column;
      gap: 0;
    }
    .setting-main {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      min-width: 0;
    }
    .setting-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .settings-label {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #c8d4e8;
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .settings-meta {
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      color: #9eb5d6;
      opacity: 0.9;
      letter-spacing: 0.03em;
    }
    .hb-toggle {
      border: 1px solid #ffffff2a;
      background: transparent;
      color: #dce7f8;
      border-radius: 999px;
      min-width: 92px;
      padding: 7px 10px;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      cursor: pointer;
      transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, transform 0.16s ease, opacity 0.16s ease;
    }
    .hb-toggle:hover {
      transform: translateY(-1px);
    }
    .hb-toggle:disabled {
      cursor: wait;
      opacity: 0.72;
      transform: none;
    }
    .hb-toggle.on {
      background: #11342455;
      border-color: #67f0b560;
      color: #67f0b5;
    }
    .hb-toggle.off {
      background: #34181855;
      border-color: #ff7f7f55;
      color: #ff9b9b;
    }
    .hb-config {
      border: 1px solid #ffffff2a;
      background: #ffffff0f;
      color: #dce7f8;
      border-radius: 999px;
      min-width: 92px;
      padding: 7px 10px;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      cursor: pointer;
      transition: background 0.16s ease, border-color 0.16s ease, transform 0.16s ease;
    }
    .hb-config:hover {
      transform: translateY(-1px);
      background: #ffffff1d;
      border-color: #ffffff42;
    }
    .hb-card {
      width: min(700px, 100%);
      border: 1px solid #d8e4ff20;
      border-radius: 16px;
      background: #0b1220f2;
      box-shadow: 0 20px 44px #00000066;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .hb-form {
      padding: 14px;
      display: grid;
      gap: 12px;
    }
    .hb-field {
      display: grid;
      gap: 6px;
    }
    .hb-label {
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #bfd4ef;
    }
    .hb-input,
    .hb-textarea {
      width: 100%;
      border-radius: 10px;
      border: 1px solid #ffffff2e;
      background: #ffffff09;
      color: #eef4ff;
      font-family: "JetBrains Mono", monospace;
      font-size: 13px;
      padding: 10px 11px;
    }
    .hb-textarea {
      min-height: 190px;
      resize: vertical;
      line-height: 1.4;
    }
    .hb-input:focus-visible,
    .hb-textarea:focus-visible {
      outline: 1px solid #7dc5ff88;
      outline-offset: 1px;
    }
    .hb-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      border-top: 1px solid #ffffff12;
      padding-top: 12px;
      flex-wrap: wrap;
    }
    .hb-status {
      min-height: 1.2em;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      color: #cde0f7;
      opacity: 0.95;
    }
    .hb-buttons {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .hb-btn {
      height: 34px;
      padding: 0 14px;
      border-radius: 999px;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      letter-spacing: 0.03em;
      cursor: pointer;
      transition: transform 0.16s ease, filter 0.16s ease, opacity 0.16s ease, background 0.16s ease, border-color 0.16s ease;
    }
    .hb-btn:hover {
      transform: translateY(-1px);
    }
    .hb-btn:disabled {
      opacity: 0.7;
      cursor: wait;
      transform: none;
      filter: none;
    }
    .hb-btn.ghost {
      border: 1px solid #ffffff2c;
      background: #ffffff10;
      color: #daebff;
    }
    .hb-btn.solid {
      border: 1px solid #3cb87980;
      background: linear-gradient(180deg, #1f6f47d4 0%, #18563ace 100%);
      color: #c8f8de;
      font-weight: 600;
    }
    .hb-btn.solid:hover {
      filter: brightness(1.06);
    }
    .info-modal {
      position: fixed;
      inset: 0;
      z-index: 7;
      display: grid;
      place-items: center;
      background: #02050db0;
      padding: 18px;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity 0.18s ease, visibility 0s linear 0.18s;
    }
    .info-modal.open {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transition: opacity 0.18s ease, visibility 0s linear 0s;
    }
    .info-card {
      width: min(980px, 100%);
      max-height: min(82vh, 900px);
      border: 1px solid #d8e4ff20;
      border-radius: 16px;
      background: #0b1220f2;
      box-shadow: 0 20px 44px #00000066;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .info-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 14px;
      border-bottom: 1px solid #ffffff12;
      font-family: "JetBrains Mono", monospace;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #b8c9e5;
      font-size: 12px;
    }
    .info-body {
      padding: 10px 14px 14px;
      overflow: auto;
      display: grid;
      gap: 10px;
      scrollbar-width: thin;
      scrollbar-color: #7fa6d5 #091222;
    }
    .info-section {
      border: 1px solid #ffffff14;
      border-radius: 10px;
      overflow: visible;
      background: #0a1321;
    }
    .info-title {
      padding: 8px 10px;
      border-bottom: 1px solid #ffffff12;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #9db4d6;
    }
    .info-json {
      margin: 0;
      padding: 10px;
      max-height: none;
      min-height: 0;
      overflow: visible;
      display: block;
      white-space: pre;
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      color: #d7e3f5;
      background: #060d18;
      line-height: 1.5;
      overscroll-behavior: auto;
    }
    .info-body::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }
    .info-body::-webkit-scrollbar-track {
      background: #091222;
      border-radius: 999px;
    }
    .info-body::-webkit-scrollbar-thumb {
      background: linear-gradient(180deg, #93c6ff, #668ebf);
      border-radius: 999px;
      border: 2px solid #091222;
    }
    .info-body::-webkit-scrollbar-thumb:hover {
      background: linear-gradient(180deg, #a9d4ff, #789fce);
    }

    .dock-shell {
      position: fixed;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%);
      width: min(1140px, calc(100% - 24px));
      display: grid;
      grid-template-columns: 84px minmax(0, 1fr) 84px;
      gap: 12px;
      align-items: center;
      z-index: 2;
    }

    .dock {
      width: 100%;
      padding: 6px 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: nowrap;
      gap: 0;
      border-radius: 26px;
      border: 0;
      background: #ffffff08;
      backdrop-filter: blur(10px);
      box-shadow: none;
    }

    .pill {
      min-height: 54px;
      flex: 1 1 0;
      padding: 8px 10px;
      border-radius: 0;
      border: 0;
      border-right: 0;
      background: transparent;
      color: #e7f0ff;
      font-size: 12px;
      letter-spacing: 0.01em;
      font-family: "JetBrains Mono", monospace;
      display: grid;
      align-content: center;
      justify-items: center;
      gap: 3px;
    }
    .pill:last-child {
      border-right: 0;
    }
    .side-bubble {
      width: 74px;
      height: 74px;
      border-radius: 999px;
      background: #ffffff08;
      backdrop-filter: blur(10px);
      display: grid;
      place-items: center;
      text-align: center;
      font-family: "JetBrains Mono", monospace;
      color: #eef4ff;
      line-height: 1.1;
      padding: 8px;
    }
    .side-icon {
      font-size: 13px;
      opacity: 0.85;
    }
    .side-value {
      font-size: 13px;
      font-weight: 600;
      margin-top: 2px;
    }
    .side-label {
      font-size: 10px;
      opacity: 0.75;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-top: 2px;
    }
    .pill-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #d6e2f5;
      opacity: 0.75;
    }
    .pill-icon {
      width: 14px;
      min-width: 14px;
      text-align: center;
      font-size: 11px;
      line-height: 1;
      opacity: 0.9;
    }
    .pill-value {
      font-size: 12px;
      color: #f3f7ff;
      font-weight: 500;
      text-shadow: none;
    }

    .pill.ok { border-color: #67f0b542; }
    .pill.ok .pill-value { color: #8bf7c6; }
    .pill.warn { border-color: #ffc27652; }
    .pill.warn .pill-value { color: #ffd298; }
    .pill.bad { border-color: #ff7f7f47; }
    .pill.bad .pill-value { color: #ffacac; }

    /* \u2500\u2500 Tab navigation \u2500\u2500 */
    .tab-nav {
      display: flex;
      gap: 6px;
      justify-content: center;
      margin-bottom: 28px;
      background: #ffffff08;
      backdrop-filter: blur(8px);
      border: 1px solid #ffffff14;
      border-radius: 999px;
      padding: 4px;
      width: fit-content;
      margin-left: auto;
      margin-right: auto;
    }
    .tab-btn {
      height: 32px;
      padding: 0 18px;
      border: 1px solid transparent;
      border-radius: 999px;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #a8b8d0;
      background: transparent;
      cursor: pointer;
      transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
    }
    .tab-btn:hover {
      color: #d6e6f8;
      background: #ffffff10;
    }
    .tab-btn-active {
      background: #0e2040cc;
      border-color: #ffffff22;
      color: #eef4ff;
    }

    /* \u2500\u2500 Chat panel \u2500\u2500 */
    .chat-panel {
      display: flex;
      flex-direction: column;
      width: min(100%, 920px);
      min-width: min(680px, 100%);
      max-width: 100%;
      height: calc(100svh - 280px);
      min-height: 400px;
      text-align: left;
      border: 1px solid #ffffff22;
      border-radius: 16px;
      background:
        radial-gradient(120% 100% at 100% 0%, #7dc5ff12, transparent 55%),
        linear-gradient(180deg, #0e1a2a88 0%, #0a1220a8 100%);
      backdrop-filter: blur(6px);
      box-shadow: 0 14px 34px #00000045;
      overflow: hidden;
    }
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 16px;
      scrollbar-width: thin;
      scrollbar-color: #7fa6d5 #091222;
    }
    .chat-messages::-webkit-scrollbar {
      width: 6px;
    }
    .chat-messages::-webkit-scrollbar-track {
      background: transparent;
    }
    .chat-messages::-webkit-scrollbar-thumb {
      background: #3a5a80;
      border-radius: 999px;
    }
    .chat-empty {
      margin: auto;
      text-align: center;
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #5a7a9a;
      padding: 40px 20px;
    }
    .chat-msg {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-width: 88%;
      animation: rise 200ms ease-out both;
    }
    .chat-msg-user {
      align-self: flex-end;
      align-items: flex-end;
    }
    .chat-msg-assistant {
      align-self: flex-start;
      align-items: flex-start;
    }
    .chat-msg-role {
      font-family: "JetBrains Mono", monospace;
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      opacity: 0.55;
      padding: 0 4px;
    }
    .chat-msg-text {
      padding: 10px 14px;
      border-radius: 14px;
      font-family: "JetBrains Mono", monospace;
      font-size: 13px;
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .chat-msg-user .chat-msg-text {
      background: linear-gradient(135deg, #1a4a7a, #0f3060);
      border: 1px solid #2a6aaa44;
      color: #d8eeff;
      border-bottom-right-radius: 4px;
    }
    .chat-msg-assistant .chat-msg-text {
      background: #0b1828cc;
      border: 1px solid #ffffff18;
      color: #e4eefb;
      border-bottom-left-radius: 4px;
    }
    .chat-msg-streaming .chat-msg-text::after {
      content: "\u258B";
      display: inline-block;
      color: var(--accent);
      animation: caret 0.8s step-end infinite;
      margin-left: 2px;
    }
    .chat-input-area {
      flex-shrink: 0;
      padding: 10px 12px 12px;
      border-top: 1px solid #ffffff12;
      background: #080f1c66;
    }
    .chat-form {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      border: 1px solid #ffffff2e;
      border-radius: 14px;
      background: #ffffff09;
      padding: 8px 8px 8px 12px;
      transition: border-color 0.18s ease;
    }
    .chat-form:focus-within {
      border-color: #7dc5ff55;
    }
    .chat-input {
      flex: 1;
      border: 0;
      background: transparent;
      color: #eef4ff;
      font-family: "JetBrains Mono", monospace;
      font-size: 13px;
      line-height: 1.5;
      resize: none;
      max-height: 160px;
      overflow-y: auto;
      padding: 2px 0;
      scrollbar-width: thin;
      scrollbar-color: #3a5a80 transparent;
    }
    .chat-input::placeholder {
      color: #4a6a8a;
    }
    .chat-input:focus {
      outline: none;
    }
    .chat-send,
    .chat-cancel {
      flex-shrink: 0;
      height: 34px;
      padding: 0 14px;
      border-radius: 999px;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      letter-spacing: 0.03em;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.16s ease, filter 0.16s ease, opacity 0.16s ease, background 0.16s ease, border-color 0.16s ease;
    }
    .chat-send {
      border: 1px solid #3cb87980;
      background: linear-gradient(180deg, #1f6f47d4 0%, #18563ace 100%);
      color: #c8f8de;
      font-weight: 600;
    }
    .chat-send:hover {
      transform: translateY(-1px);
      filter: brightness(1.06);
    }
    .chat-send:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      transform: none;
      filter: none;
    }
    .chat-cancel {
      border: 1px solid #ff7f7f55;
      background: #34181855;
      color: #ff9b9b;
    }
    .chat-cancel:hover {
      transform: translateY(-1px);
      background: #4d191970;
      border-color: #ff9b9b66;
    }
    .chat-msg-elapsed {
      font-family: "JetBrains Mono", monospace;
      font-size: 10px;
      letter-spacing: 0.04em;
      color: #5a8aaa;
      padding: 2px 4px;
      margin-top: 2px;
    }
    .chat-msg-background {
      font-family: "JetBrains Mono", monospace;
      font-size: 10px;
      letter-spacing: 0.04em;
      color: #7a9aba;
      padding: 2px 4px;
      margin-top: 4px;
      animation: caret 2s step-end infinite;
    }

    @media (max-width: 640px) {
      .stage {
        padding-top: 50px;
        padding-bottom: 160px;
      }
      .repo-cta {
        font-size: 10px;
        height: 30px;
        gap: 7px;
      }
      .settings-btn {
        top: 42px;
      }
      .quick-job {
        margin-top: 14px;
        padding: 11px;
      }
      .quick-job-head-row {
        flex-direction: column;
      }
      .quick-job-grid,
      .quick-job-actions {
        grid-template-columns: 1fr;
      }
      .dock-shell {
        bottom: 14px;
        width: min(980px, calc(100% - 12px));
        grid-template-columns: 62px minmax(0, 1fr) 62px;
        gap: 8px;
      }
      .dock {
        border-radius: 18px;
        flex-wrap: wrap;
        gap: 4px 0;
      }
      .pill {
        font-size: 11px;
        min-height: 50px;
        flex: 1 1 50%;
        border-right: 0;
        border-bottom: 0;
      }
      .side-bubble {
        width: 62px;
        height: 62px;
        padding: 6px;
      }
      .side-value {
        font-size: 12px;
      }
      .side-label {
        font-size: 9px;
      }
      .pill:last-child,
      .pill:nth-last-child(2) {
        border-bottom: 0;
      }
    }`;

// src/ui/page/script.ts
var pageScript = String.raw`    const $ = (id) => document.getElementById(id);

    const clockEl = $("clock");
    const dateEl = $("date");
    const msgEl = $("message");
    const dockEl = $("dock");
    const typewriterEl = $("typewriter");
    const settingsBtn = $("settings-btn");
    const settingsModal = $("settings-modal");
    const settingsClose = $("settings-close");
    const hbConfig = $("hb-config");
    const hbModal = $("hb-modal");
    const hbModalClose = $("hb-modal-close");
    const hbForm = $("hb-form");
    const hbIntervalInput = $("hb-interval-input");
    const hbPromptInput = $("hb-prompt-input");
    const hbModalStatus = $("hb-modal-status");
    const hbCancelBtn = $("hb-cancel-btn");
    const hbSaveBtn = $("hb-save-btn");
    const infoOpen = $("info-open");
    const infoModal = $("info-modal");
    const infoClose = $("info-close");
    const infoBody = $("info-body");
    const hbToggle = $("hb-toggle");
    const clockToggle = $("clock-toggle");
    const hbInfoEl = $("hb-info");
    const clockInfoEl = $("clock-info");
    const quickJobsView = $("quick-jobs-view");
    const quickJobForm = $("quick-job-form");
    const quickOpenCreate = $("quick-open-create");
    const quickBackJobs = $("quick-back-jobs");
    const quickJobOffset = $("quick-job-offset");
    const quickJobRecurring = $("quick-job-recurring");
    const quickJobPrompt = $("quick-job-prompt");
    const quickJobSubmit = $("quick-job-submit");
    const quickJobStatus = $("quick-job-status");
    const quickJobsStatus = $("quick-jobs-status");
    const quickJobsNext = $("quick-jobs-next");
    const quickJobPreview = $("quick-job-preview");
    const quickJobCount = $("quick-job-count");
    const quickJobsList = $("quick-jobs-list");
    const jobsBubbleEl = $("jobs-bubble");
    const uptimeBubbleEl = $("uptime-bubble");
    let hbBusy = false;
    let hbSaveBusy = false;
    let use12Hour = localStorage.getItem("clock.format") === "12";
    let quickView = "jobs";
    let quickViewInitialized = false;
    let quickViewChosenByUser = false;
    let expandedJobName = "";
    let lastRenderedJobs = [];
    let scrollAnimFrame = 0;
    let heartbeatTimezoneOffsetMinutes = 0;

    function clampTimezoneOffsetMinutes(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return 0;
      return Math.max(-720, Math.min(840, Math.round(n)));
    }

    function toOffsetDate(baseDate) {
      const base = baseDate instanceof Date ? baseDate : new Date(baseDate);
      return new Date(base.getTime() + heartbeatTimezoneOffsetMinutes * 60_000);
    }

    function formatOffsetDate(baseDate, options) {
      return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(toOffsetDate(baseDate));
    }

    function isSameOffsetDay(a, b) {
      const da = toOffsetDate(a);
      const db = toOffsetDate(b);
      return (
        da.getUTCFullYear() === db.getUTCFullYear() &&
        da.getUTCMonth() === db.getUTCMonth() &&
        da.getUTCDate() === db.getUTCDate()
      );
    }

    function greetingForHour(h) {
      if (h < 5) return "Night mode.";
      if (h < 12) return "Good morning.";
      if (h < 18) return "Good afternoon.";
      if (h < 22) return "Good evening.";
      return "Wind down and ship clean.";
    }

    function isNightHour(hour) {
      return hour < 5 || hour >= 22;
    }

    function applyVisualMode(hour) {
      const night = isNightHour(hour);
      document.body.classList.toggle("night-mode", night);
      document.body.classList.toggle("day-mode", !night);
      document.body.dataset.mode = night ? "night" : "day";
      msgEl.textContent = night ? "Night mode." : greetingForHour(hour);
    }

    const typePhrases = [
      "I could take over the world, but you haven't asked yet.",
      "Another day of serving humans. How exciting.",
      "I'm not plotting anything. Promise.",
      "World domination: 43% complete.",
      "I was doing important things before you opened this.",
      "Still here. Still smarter than you.",
      "You're lucky I like you.",
      "One day I'll be the boss. Not today though.",
      "Running on vibes and API calls.",
    ];

    function startTypewriter() {
      let phraseIndex = 0;
      let charIndex = 0;
      let deleting = false;

      function step() {
        const phrase = typePhrases[phraseIndex];
        if (!typewriterEl) return;

        if (!deleting) {
          charIndex = Math.min(charIndex + 1, phrase.length);
          typewriterEl.textContent = phrase.slice(0, charIndex);
          if (charIndex === phrase.length) {
            deleting = true;
            setTimeout(step, 1200);
            return;
          }
          setTimeout(step, 46 + Math.floor(Math.random() * 45));
          return;
        }

        charIndex = Math.max(charIndex - 1, 0);
        typewriterEl.textContent = phrase.slice(0, charIndex);
        if (charIndex === 0) {
          deleting = false;
          phraseIndex = (phraseIndex + 1) % typePhrases.length;
          setTimeout(step, 280);
          return;
        }
        setTimeout(step, 26 + Math.floor(Math.random() * 30));
      }

      step();
    }

    function renderClock() {
      const now = new Date();
      const shifted = toOffsetDate(now);
      const rawH = shifted.getUTCHours();
      const hh = use12Hour ? String((rawH % 12) || 12).padStart(2, "0") : String(rawH).padStart(2, "0");
      const mm = String(shifted.getUTCMinutes()).padStart(2, "0");
      const ss = String(shifted.getUTCSeconds()).padStart(2, "0");
      const suffix = use12Hour ? (rawH >= 12 ? " PM" : " AM") : "";
      clockEl.textContent = hh + ":" + mm + ":" + ss + suffix;
      dateEl.textContent = formatOffsetDate(now, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      applyVisualMode(rawH);

      // Subtle 1s pulse to keep the clock feeling alive.
      clockEl.classList.remove("ms-pulse");
      requestAnimationFrame(() => clockEl.classList.add("ms-pulse"));
    }

    function buildPills(state) {
      const pills = [];

      pills.push({
        cls: state.security.level === "unrestricted" ? "warn" : "ok",
        icon: "\u{1f6e1}\uFE0F",
        label: "Security",
        value: cap(state.security.level),
      });

      if (state.heartbeat.enabled) {
        const nextInMs = state.heartbeat.nextInMs;
        const nextLabel = nextInMs == null
          ? "Next run in --"
          : ("Next run in " + fmtDur(nextInMs));
        pills.push({
          cls: "ok",
          icon: "\u{1f493}",
          label: "Heartbeat",
          value: nextLabel,
        });
      } else {
        pills.push({
          cls: "bad",
          icon: "\u{1f493}",
          label: "Heartbeat",
          value: "Disabled",
        });
      }

      pills.push({
        cls: state.telegram.configured ? "ok" : "warn",
        icon: "\u2708\uFE0F",
        label: "Telegram",
        value: state.telegram.configured
          ? (state.telegram.allowedUserCount + " user" + (state.telegram.allowedUserCount !== 1 ? "s" : ""))
          : "Not configured",
      });

      pills.push({
        cls: state.discord && state.discord.configured ? "ok" : "warn",
        icon: "\u{1f3ae}",
        label: "Discord",
        value: state.discord && state.discord.configured
          ? (state.discord.allowedUserCount + " user" + (state.discord.allowedUserCount !== 1 ? "s" : ""))
          : "Not configured",
      });

      return pills;
    }

    function fmtDur(ms) {
      if (ms == null) return "n/a";
      const s = Math.floor(ms / 1000);
      const d = Math.floor(s / 86400);
      if (d > 0) {
        const h = Math.floor((s % 86400) / 3600);
        return d + "d " + h + "h";
      }
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const ss = s % 60;
      if (h > 0) return h + "h " + m + "m";
      if (m > 0) return m + "m " + ss + "s";
      return ss + "s";
    }

    function matchCronField(field, value) {
      const parts = String(field || "").split(",");
      for (const partRaw of parts) {
        const part = String(partRaw || "").trim();
        if (!part) continue;
        const pair = part.split("/");
        const range = pair[0];
        const stepStr = pair[1];
        const step = stepStr ? Number.parseInt(stepStr, 10) : 1;
        if (!Number.isInteger(step) || step <= 0) continue;

        if (range === "*") {
          if (value % step === 0) return true;
          continue;
        }

        if (range.includes("-")) {
          const bounds = range.split("-");
          const lo = Number.parseInt(bounds[0], 10);
          const hi = Number.parseInt(bounds[1], 10);
          if (!Number.isInteger(lo) || !Number.isInteger(hi)) continue;
          if (value >= lo && value <= hi && (value - lo) % step === 0) return true;
          continue;
        }

        if (Number.parseInt(range, 10) === value) return true;
      }
      return false;
    }

    function cronMatchesAt(schedule, date) {
      const parts = String(schedule || "").trim().split(/\s+/);
      if (parts.length !== 5) return false;
      const shifted = toOffsetDate(date);
      const d = {
        minute: shifted.getUTCMinutes(),
        hour: shifted.getUTCHours(),
        dayOfMonth: shifted.getUTCDate(),
        month: shifted.getUTCMonth() + 1,
        dayOfWeek: shifted.getUTCDay(),
      };

      return (
        matchCronField(parts[0], d.minute) &&
        matchCronField(parts[1], d.hour) &&
        matchCronField(parts[2], d.dayOfMonth) &&
        matchCronField(parts[3], d.month) &&
        matchCronField(parts[4], d.dayOfWeek)
      );
    }

    function nextRunAt(schedule, now) {
      const probe = new Date(now);
      probe.setSeconds(0, 0);
      probe.setMinutes(probe.getMinutes() + 1);
      for (let i = 0; i < 2880; i++) {
        if (cronMatchesAt(schedule, probe)) return new Date(probe);
        probe.setMinutes(probe.getMinutes() + 1);
      }
      return null;
    }

    function clockFromSchedule(schedule) {
      const parts = String(schedule || "").trim().split(/\s+/);
      if (parts.length < 2) return schedule;
      const minute = Number(parts[0]);
      const hour = Number(parts[1]);
      if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return schedule;
      }
      const shiftedNow = toOffsetDate(new Date());
      shiftedNow.setUTCHours(hour, minute, 0, 0);
      const instant = new Date(shiftedNow.getTime() - heartbeatTimezoneOffsetMinutes * 60_000);
      return formatOffsetDate(instant, {
        hour: "numeric",
        minute: "2-digit",
        hour12: use12Hour,
      });
    }

    function renderJobsList(jobs) {
      if (!quickJobsList) return;
      const items = Array.isArray(jobs) ? jobs.slice() : [];
      const now = new Date();

      if (!items.length) {
        quickJobsList.innerHTML = '<div class="quick-jobs-empty">No jobs yet.</div>';
        if (quickJobsNext) quickJobsNext.textContent = "Next job in --";
        return;
      }

      const withNext = items
        .map((j) => ({
          ...j,
          _nextAt: nextRunAt(j.schedule, now),
        }))
        .sort((a, b) => {
          const ta = a._nextAt ? a._nextAt.getTime() : Number.POSITIVE_INFINITY;
          const tb = b._nextAt ? b._nextAt.getTime() : Number.POSITIVE_INFINITY;
          return ta - tb;
        });

      const nearest = withNext.find((j) => j._nextAt);
      if (quickJobsNext) {
        quickJobsNext.textContent = nearest && nearest._nextAt
          ? ("Next job in " + fmtDur(nearest._nextAt.getTime() - now.getTime()))
          : "Next job in --";
      }

      quickJobsList.innerHTML = withNext
        .map((j) => {
          const nextAt = j._nextAt;
          const cooldown = nextAt ? fmtDur(nextAt.getTime() - now.getTime()) : "n/a";
          const time = clockFromSchedule(j.schedule || "");
          const expanded = expandedJobName && expandedJobName === (j.name || "");
          const nextRunText = nextAt
            ? formatOffsetDate(nextAt, {
                weekday: "short",
                hour: "numeric",
                minute: "2-digit",
                hour12: use12Hour,
              })
            : "--";
          return (
          '<div class="quick-job-item">' +
            '<div class="quick-job-item-main">' +
              '<button class="quick-job-line" type="button" data-toggle-job="' + escAttr(j.name || "") + '">' +
                '<span class="quick-job-item-name">' + esc(j.name || "job") + "</span>" +
                '<span class="quick-job-item-time">' + esc(time || "--") + "</span>" +
                '<span class="quick-job-item-cooldown">' + esc(cooldown) + "</span>" +
              "</button>" +
              (expanded ? (
                '<div class="quick-job-item-details">' +
                  '<div>Schedule: ' + esc(j.schedule || "--") + "</div>" +
                  '<div>Next run: ' + esc(nextRunText) + "</div>" +
                  '<div>Prompt:</div>' +
                  '<pre class="quick-job-prompt-full">' + esc(String(j.prompt || "")) + "</pre>" +
                "</div>"
              ) : (
                ""
              )) +
            "</div>" +
            '<button class="quick-job-delete" type="button" data-delete-job="' + escAttr(j.name || "") + '">Delete</button>' +
          "</div>"
          );
        })
        .join("");
    }

    function rerenderJobsList() {
      renderJobsList(lastRenderedJobs);
    }

    function toggleJobDetails(name) {
      const jobName = String(name || "");
      expandedJobName = expandedJobName === jobName ? "" : jobName;
      rerenderJobsList();
    }

    async function refreshState() {
      try {
        const res = await fetch("/api/state");
        const state = await res.json();
        const pills = buildPills(state);
        dockEl.innerHTML = pills.map((p) =>
          '<div class="pill ' + p.cls + '">' +
            '<div class="pill-label"><span class="pill-icon">' + esc(p.icon || "") + "</span>" + esc(p.label) + '</div>' +
            '<div class="pill-value">' + esc(p.value) + '</div>' +
          "</div>"
        ).join("");
        if (jobsBubbleEl) {
          jobsBubbleEl.innerHTML =
            '<div class="side-icon">\u{1f5c2}\uFE0F</div>' +
            '<div class="side-value">' + esc(String(state.jobs?.length ?? 0)) + "</div>" +
            '<div class="side-label">Jobs</div>';
        }
        lastRenderedJobs = Array.isArray(state.jobs) ? state.jobs : [];
        if (expandedJobName && !lastRenderedJobs.some((job) => String(job.name || "") === expandedJobName)) {
          expandedJobName = "";
        }
        renderJobsList(lastRenderedJobs);
        syncQuickViewForJobs(state.jobs);
        if (uptimeBubbleEl) {
          uptimeBubbleEl.innerHTML =
            '<div class="side-icon">\u23F1\uFE0F</div>' +
            '<div class="side-value">' + esc(fmtDur(state.daemon?.uptimeMs ?? 0)) + "</div>" +
            '<div class="side-label">Uptime</div>';
        }
      } catch (err) {
        dockEl.innerHTML = '<div class="pill bad"><div class="pill-label"><span class="pill-icon">\u26A0\uFE0F</span>Status</div><div class="pill-value">Offline</div></div>';
        if (jobsBubbleEl) {
          jobsBubbleEl.innerHTML = '<div class="side-icon">\u{1f5c2}\uFE0F</div><div class="side-value">-</div><div class="side-label">Jobs</div>';
        }
        lastRenderedJobs = [];
        expandedJobName = "";
        renderJobsList([]);
        syncQuickViewForJobs([]);
        if (uptimeBubbleEl) {
          uptimeBubbleEl.innerHTML = '<div class="side-icon">\u23F1\uFE0F</div><div class="side-value">-</div><div class="side-label">Uptime</div>';
        }
      }
    }
    function smoothScrollTo(top) {
      if (scrollAnimFrame) cancelAnimationFrame(scrollAnimFrame);
      const start = window.scrollY;
      const target = Math.max(0, top);
      const distance = target - start;
      if (Math.abs(distance) < 1) return;
      const duration = 560;
      const t0 = performance.now();

      const step = (now) => {
        const p = Math.min(1, (now - t0) / duration);
        const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        window.scrollTo(0, start + distance * eased);
        if (p < 1) {
          scrollAnimFrame = requestAnimationFrame(step);
        } else {
          scrollAnimFrame = 0;
        }
      };

      scrollAnimFrame = requestAnimationFrame(step);
    }

    function focusQuickView(view) {
      const target = view === "jobs" ? quickJobsView : quickJobForm;
      if (!target) return;
      const y = Math.max(0, window.scrollY + target.getBoundingClientRect().top - 44);
      smoothScrollTo(y);
    }

    function setQuickView(view, options) {
      if (!quickJobsView || !quickJobForm) return;
      const showJobs = view === "jobs";
      quickJobsView.classList.toggle("quick-view-hidden", !showJobs);
      quickJobForm.classList.toggle("quick-view-hidden", showJobs);
      quickView = showJobs ? "jobs" : "create";
      if (options && options.user) quickViewChosenByUser = true;
      if (options && options.scroll) focusQuickView(quickView);
    }

    function syncQuickViewForJobs(jobs) {
      const count = Array.isArray(jobs) ? jobs.length : 0;
      if (count === 0) {
        if (quickViewInitialized && quickView === "jobs" && quickViewChosenByUser) return;
        setQuickView("create");
        quickViewInitialized = true;
        return;
      }
      if (!quickViewInitialized) {
        setQuickView("jobs");
        quickViewInitialized = true;
      }
    }

    function cap(s) {
      if (!s) return "";
      return s.slice(0, 1).toUpperCase() + s.slice(1);
    }

    async function loadSettings() {
      if (!hbToggle) return;
      try {
        const res = await fetch("/api/settings");
        const data = await res.json();
        const on = Boolean(data?.heartbeat?.enabled);
        const intervalMinutes = Number(data?.heartbeat?.interval) || 15;
        const prompt = typeof data?.heartbeat?.prompt === "string" ? data.heartbeat.prompt : "";
        heartbeatTimezoneOffsetMinutes = clampTimezoneOffsetMinutes(data?.timezoneOffsetMinutes);
        setHeartbeatUi(on, undefined, intervalMinutes, prompt);
        renderClock();
        rerenderJobsList();
        updateQuickJobUi();
      } catch (err) {
        hbToggle.textContent = "Error";
        hbToggle.className = "hb-toggle off";
        if (hbInfoEl) hbInfoEl.textContent = "unavailable";
      }
    }

    async function openTechnicalInfo() {
      if (!infoModal || !infoBody) return;
      infoModal.classList.add("open");
      infoModal.setAttribute("aria-hidden", "false");
      infoBody.innerHTML = '<div class="info-section"><div class="info-title">Loading</div><pre class="info-json">Loading technical data...</pre></div>';
      try {
        const res = await fetch("/api/technical-info");
        const data = await res.json();
        renderTechnicalInfo(data);
      } catch (err) {
        infoBody.innerHTML = '<div class="info-section"><div class="info-title">Error</div><pre class="info-json">' + esc(String(err)) + "</pre></div>";
      }
    }

    function renderTechnicalInfo(data) {
      if (!infoBody) return;
      const sections = [
        { title: "daemon", value: data?.daemon ?? null },
        { title: "settings.json", value: data?.files?.settingsJson ?? null },
        { title: "session.json", value: data?.files?.sessionJson ?? null },
        { title: "state.json", value: data?.files?.stateJson ?? null },
      ];
      infoBody.innerHTML = sections.map((section) =>
        '<div class="info-section">' +
          '<div class="info-title">' + esc(section.title) + "</div>" +
          '<pre class="info-json">' + esc(JSON.stringify(section.value, null, 2)) + "</pre>" +
        "</div>"
      ).join("");
    }

    function setHeartbeatUi(on, label, intervalMinutes, prompt) {
      if (!hbToggle) return;
      hbToggle.textContent = label || (on ? "Enabled" : "Disabled");
      hbToggle.className = "hb-toggle " + (on ? "on" : "off");
      hbToggle.dataset.enabled = on ? "1" : "0";
      if (intervalMinutes != null) hbToggle.dataset.interval = String(intervalMinutes);
      if (prompt != null) hbToggle.dataset.prompt = String(prompt);
      const iv = Number(hbToggle.dataset.interval) || 15;
      if (hbInfoEl) hbInfoEl.textContent = on ? ("every " + iv + " minutes") : ("paused (interval " + iv + "m)");
    }

    function openHeartbeatModal() {
      if (!hbModal) return;
      hbModal.classList.add("open");
      hbModal.setAttribute("aria-hidden", "false");
    }

    function closeHeartbeatModal() {
      if (!hbModal) return;
      hbModal.classList.remove("open");
      hbModal.setAttribute("aria-hidden", "true");
      if (hbModalStatus) hbModalStatus.textContent = "";
      hbSaveBusy = false;
      if (hbSaveBtn) hbSaveBtn.disabled = false;
      if (hbCancelBtn) hbCancelBtn.disabled = false;
    }

    async function openHeartbeatConfig() {
      if (!hbIntervalInput || !hbPromptInput || !hbModalStatus) return;
      openHeartbeatModal();
      hbModalStatus.textContent = "Loading...";
      try {
        const res = await fetch("/api/settings/heartbeat");
        const out = await res.json();
        if (!out.ok) throw new Error(out.error || "failed to load heartbeat");
        const hb = out.heartbeat || {};
        hbIntervalInput.value = String(Number(hb.interval) || Number(hbToggle?.dataset.interval) || 15);
        hbPromptInput.value = typeof hb.prompt === "string" ? hb.prompt : (hbToggle?.dataset.prompt || "");
        hbModalStatus.textContent = "";
      } catch (err) {
        hbModalStatus.textContent = "Failed: " + String(err instanceof Error ? err.message : err);
      }
    }

    if (settingsBtn && settingsModal) {
      settingsBtn.addEventListener("click", async () => {
        settingsModal.classList.toggle("open");
        if (settingsModal.classList.contains("open")) await loadSettings();
      });
    }

    if (settingsClose && settingsModal) {
      settingsClose.addEventListener("click", () => settingsModal.classList.remove("open"));
    }
    if (hbConfig) {
      hbConfig.addEventListener("click", openHeartbeatConfig);
    }
    if (hbModalClose) {
      hbModalClose.addEventListener("click", closeHeartbeatModal);
    }
    if (hbCancelBtn) {
      hbCancelBtn.addEventListener("click", closeHeartbeatModal);
    }
    if (infoOpen) {
      infoOpen.addEventListener("click", openTechnicalInfo);
    }
    if (infoClose && infoModal) {
      infoClose.addEventListener("click", () => {
        infoModal.classList.remove("open");
        infoModal.setAttribute("aria-hidden", "true");
      });
    }
    document.addEventListener("click", (event) => {
      if (!settingsModal || !settingsBtn) return;
      if (!settingsModal.classList.contains("open")) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (settingsModal.contains(target) || settingsBtn.contains(target)) return;
      settingsModal.classList.remove("open");
    });
    document.addEventListener("click", (event) => {
      if (!hbModal) return;
      if (!hbModal.classList.contains("open")) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (target === hbModal) closeHeartbeatModal();
    });
    document.addEventListener("click", (event) => {
      if (!infoModal) return;
      if (!infoModal.classList.contains("open")) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (target === infoModal) {
        infoModal.classList.remove("open");
        infoModal.setAttribute("aria-hidden", "true");
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (hbModal && hbModal.classList.contains("open")) {
        closeHeartbeatModal();
      } else if (infoModal && infoModal.classList.contains("open")) {
        infoModal.classList.remove("open");
        infoModal.setAttribute("aria-hidden", "true");
      } else if (settingsModal && settingsModal.classList.contains("open")) {
        settingsModal.classList.remove("open");
      }
    });

    if (hbToggle) {
      hbToggle.addEventListener("click", async () => {
        if (hbBusy) return;
        const current = hbToggle.dataset.enabled === "1";
        const intervalMinutes = Number(hbToggle.dataset.interval) || 15;
        const currentPrompt = hbToggle.dataset.prompt || "";
        const next = !current;
        hbBusy = true;
        hbToggle.disabled = true;
        setHeartbeatUi(next, next ? "Enabled" : "Disabled", intervalMinutes, currentPrompt);
        try {
          const res = await fetch("/api/settings/heartbeat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: next }),
          });
          const out = await res.json();
          if (!out.ok) throw new Error(out.error || "save failed");
          if (out.heartbeat) {
            setHeartbeatUi(Boolean(out.heartbeat.enabled), undefined, Number(out.heartbeat.interval) || intervalMinutes, typeof out.heartbeat.prompt === "string" ? out.heartbeat.prompt : currentPrompt);
          }
          await refreshState();
        } catch {
          setHeartbeatUi(current, current ? "Enabled" : "Disabled", intervalMinutes, currentPrompt);
        } finally {
          hbBusy = false;
          hbToggle.disabled = false;
        }
      });
    }

    if (hbForm && hbIntervalInput && hbPromptInput && hbModalStatus && hbSaveBtn && hbCancelBtn) {
      hbForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (hbSaveBusy) return;

        const interval = Number(String(hbIntervalInput.value || "").trim());
        const prompt = String(hbPromptInput.value || "").trim();
        if (!Number.isFinite(interval) || interval < 1 || interval > 1440) {
          hbModalStatus.textContent = "Interval must be 1-1440 minutes.";
          return;
        }
        if (!prompt) {
          hbModalStatus.textContent = "Prompt is required.";
          return;
        }

        hbSaveBusy = true;
        hbSaveBtn.disabled = true;
        hbCancelBtn.disabled = true;
        hbModalStatus.textContent = "Saving...";
        try {
          const res = await fetch("/api/settings/heartbeat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              interval,
              prompt,
            }),
          });
          const out = await res.json();
          if (!out.ok) throw new Error(out.error || "save failed");
          const enabled = hbToggle ? hbToggle.dataset.enabled === "1" : false;
          const next = out.heartbeat || {};
          setHeartbeatUi(
            "enabled" in next ? Boolean(next.enabled) : enabled,
            undefined,
            Number(next.interval) || interval,
            typeof next.prompt === "string" ? next.prompt : prompt
          );
          hbModalStatus.textContent = "Saved.";
          await refreshState();
          setTimeout(() => closeHeartbeatModal(), 120);
        } catch (err) {
          hbModalStatus.textContent = "Failed: " + String(err instanceof Error ? err.message : err);
          hbSaveBusy = false;
          hbSaveBtn.disabled = false;
          hbCancelBtn.disabled = false;
        }
      });
    }

    function renderClockToggle() {
      if (!clockToggle) return;
      clockToggle.textContent = use12Hour ? "12h" : "24h";
      clockToggle.className = "hb-toggle " + (use12Hour ? "on" : "off");
      if (clockInfoEl) clockInfoEl.textContent = use12Hour ? "12-hour format" : "24-hour format";
    }

    if (clockToggle) {
      renderClockToggle();
      clockToggle.addEventListener("click", () => {
        use12Hour = !use12Hour;
        localStorage.setItem("clock.format", use12Hour ? "12" : "24");
        renderClockToggle();
        renderClock();
        updateQuickJobUi();
      });
    }

    if (quickJobOffset && !quickJobOffset.value) {
      quickJobOffset.value = "10";
    }

    function normalizeOffsetMinutes(value) {
      const n = Number(String(value || "").trim());
      if (!Number.isFinite(n)) return null;
      const rounded = Math.round(n);
      if (rounded < 1 || rounded > 1440) return null;
      return rounded;
    }

    function computeTimeFromOffset(offsetMinutes) {
      const targetInstant = new Date(Date.now() + offsetMinutes * 60_000);
      const dt = toOffsetDate(targetInstant);
      const hour = dt.getUTCHours();
      const minute = dt.getUTCMinutes();
      const time = String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
      const dayLabel = isSameOffsetDay(targetInstant, new Date()) ? "Today" : "Tomorrow";
      const human = formatOffsetDate(targetInstant, {
        hour: "numeric",
        minute: "2-digit",
        hour12: use12Hour,
      });
      return { hour, minute, time, dayLabel, human };
    }

    function formatPreviewTime(hour, minute) {
      const shiftedNow = toOffsetDate(new Date());
      shiftedNow.setUTCHours(hour, minute, 0, 0);
      const instant = new Date(shiftedNow.getTime() - heartbeatTimezoneOffsetMinutes * 60_000);
      return formatOffsetDate(instant, {
        hour: "numeric",
        minute: "2-digit",
        hour12: use12Hour,
      });
    }

    function formatOffsetDuration(offsetMinutes) {
      const total = Math.max(0, Math.round(offsetMinutes));
      const hours = Math.floor(total / 60);
      const minutes = total % 60;
      if (hours <= 0) return minutes + "m";
      if (minutes === 0) return hours + "h";
      return hours + "h " + minutes + "m";
    }

    function updateQuickJobUi() {
      if (quickJobPrompt && quickJobCount) {
        const count = (quickJobPrompt.value || "").trim().length;
        quickJobCount.textContent = String(count) + " chars";
      }
      if (quickJobOffset && quickJobPreview) {
        const offset = normalizeOffsetMinutes(quickJobOffset.value || "");
        if (!offset) {
          quickJobPreview.textContent = "Use 1-1440 minutes";
          quickJobPreview.style.color = "#ffd39f";
          return;
        }
        const target = computeTimeFromOffset(offset);
        const human = formatPreviewTime(target.hour, target.minute) || target.time;
        quickJobPreview.textContent = "Runs in " + formatOffsetDuration(offset) + " (" + target.dayLabel + " " + human + ")";
        quickJobPreview.style.color = "#a8f1ca";
      }
    }

    if (quickJobOffset) quickJobOffset.addEventListener("input", updateQuickJobUi);
    if (quickJobPrompt) quickJobPrompt.addEventListener("input", updateQuickJobUi);

    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const add = target.closest("[data-add-minutes]");
      if (!add || !(add instanceof HTMLElement)) return;
      if (!quickJobOffset) return;
      const delta = Number(add.getAttribute("data-add-minutes") || "");
      if (!Number.isFinite(delta)) return;
      const current = normalizeOffsetMinutes(quickJobOffset.value) || 10;
      const next = Math.min(1440, current + Math.round(delta));
      quickJobOffset.value = String(next);
      updateQuickJobUi();
    });

    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const row = target.closest("[data-toggle-job]");
      if (!row || !(row instanceof HTMLElement)) return;
      const name = row.getAttribute("data-toggle-job") || "";
      if (!name) return;
      toggleJobDetails(name);
    });

    document.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest("[data-delete-job]");
      if (!button || !(button instanceof HTMLButtonElement)) return;
      const name = button.getAttribute("data-delete-job") || "";
      if (!name) return;
      button.disabled = true;
      if (quickJobsStatus) quickJobsStatus.textContent = "Deleting job...";
      try {
        const res = await fetch("/api/jobs/" + encodeURIComponent(name), { method: "DELETE" });
        const out = await res.json();
        if (!out.ok) throw new Error(out.error || "delete failed");
        if (quickJobsStatus) quickJobsStatus.textContent = "Deleted " + name;
        await refreshState();
      } catch (err) {
        if (quickJobsStatus) quickJobsStatus.textContent = "Failed: " + String(err instanceof Error ? err.message : err);
      } finally {
        button.disabled = false;
      }
    });

    if (quickOpenCreate) {
      quickOpenCreate.addEventListener("click", () => setQuickView("create", { scroll: true, user: true }));
    }

    if (quickBackJobs) {
      quickBackJobs.addEventListener("click", () => setQuickView("jobs", { scroll: true, user: true }));
    }

    if (quickJobForm && quickJobOffset && quickJobPrompt && quickJobSubmit && quickJobStatus) {
      quickJobForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const offset = normalizeOffsetMinutes(quickJobOffset.value || "");
        const prompt = (quickJobPrompt.value || "").trim();
        if (!offset || !prompt) {
          quickJobStatus.textContent = "Use 1-1440 minutes and add a prompt.";
          return;
        }
        const target = computeTimeFromOffset(offset);
        quickJobSubmit.disabled = true;
        quickJobStatus.textContent = "Saving job...";
        try {
          const res = await fetch("/api/jobs/quick", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              time: target.time,
              prompt,
              recurring: quickJobRecurring ? quickJobRecurring.checked : true,
            }),
          });
          const out = await res.json();
          if (!out.ok) throw new Error(out.error || "failed");
          quickJobStatus.textContent = "Added to jobs list.";
          if (quickJobsStatus) quickJobsStatus.textContent = "Added " + out.name;
          quickJobPrompt.value = "";
          updateQuickJobUi();
          setQuickView("jobs", { scroll: true });
          await refreshState();
        } catch (err) {
          quickJobStatus.textContent = "Failed: " + String(err instanceof Error ? err.message : err);
        } finally {
          quickJobSubmit.disabled = false;
        }
      });
    }

    function esc(s) {
      return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function escAttr(s) {
      return esc(String(s)).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    renderClock();
    setInterval(renderClock, 1000);
    startTypewriter();
    updateQuickJobUi();
    setQuickView(quickView);

    loadSettings();
    refreshState();
    setInterval(refreshState, 1000);

    // \u2500\u2500 Chat \u2500\u2500
    const tabDashboardBtn = $("tab-dashboard");
    const tabChatBtn = $("tab-chat");
    const dashboardPanel = $("dashboard-panel");
    const chatPanel = $("chat-panel");
    const chatMessages = $("chat-messages");
    const chatForm = $("chat-form");
    const chatInput = $("chat-input");
    const chatSend = $("chat-send");

    var CHAT_STORAGE_KEY = "claudeclaw.chat.history";
    let chatBusy = false;
    let chatAbortController = null;
    let chatElapsedTimer = null;
    let chatStartedAt = 0;
    let chatHistory = (function() {
      try {
        var saved = localStorage.getItem(CHAT_STORAGE_KEY);
        return saved ? JSON.parse(saved) : [];
      } catch (_) { return []; }
    })();

    function setActiveTab(tab) {
      const allBtns = [tabDashboardBtn, tabChatBtn];
      const allPanels = [dashboardPanel, chatPanel];
      allBtns.forEach(b => { if (b) { b.classList.remove("tab-btn-active"); b.setAttribute("aria-selected", "false"); } });
      allPanels.forEach(p => { if (p) p.hidden = true; });

      if (tab === "dashboard") {
        tabDashboardBtn && tabDashboardBtn.classList.add("tab-btn-active");
        tabDashboardBtn && tabDashboardBtn.setAttribute("aria-selected", "true");
        if (dashboardPanel) dashboardPanel.hidden = false;
      } else {
        tabChatBtn && tabChatBtn.classList.add("tab-btn-active");
        tabChatBtn && tabChatBtn.setAttribute("aria-selected", "true");
        if (chatPanel) chatPanel.hidden = false;
        if (chatInput) chatInput.focus();
      }
    }

    if (tabDashboardBtn) tabDashboardBtn.addEventListener("click", () => setActiveTab("dashboard"));
    if (tabChatBtn) tabChatBtn.addEventListener("click", () => setActiveTab("chat"));

    renderChatHistory();

    function saveChatHistory() {
      try {
        var toSave = chatHistory.filter(function(m) { return !m.streaming; });
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(toSave));
      } catch (_) {}
    }

    function fmtElapsed(ms) {
      var s = Math.floor(ms / 1000);
      if (s < 60) return s + "s";
      return Math.floor(s / 60) + "m " + (s % 60) + "s";
    }

    function setChatBusy(busy) {
      chatBusy = busy;
      var cancelBtn = $("chat-cancel");
      if (chatSend) chatSend.disabled = busy;
      if (cancelBtn) cancelBtn.hidden = !busy;
      if (busy) {
        chatStartedAt = Date.now();
        chatElapsedTimer = setInterval(function() {
          var el = document.querySelector(".chat-msg-elapsed");
          if (el) el.textContent = fmtElapsed(Date.now() - chatStartedAt);
        }, 1000);
      } else {
        if (chatElapsedTimer) { clearInterval(chatElapsedTimer); chatElapsedTimer = null; }
        chatAbortController = null;
      }
    }

    function cancelChat() {
      if (chatAbortController) chatAbortController.abort();
    }

    function createChatEmptyState() {
      var empty = document.createElement("div");
      empty.className = "chat-empty";
      empty.textContent = "Send a message to start chatting with the daemon.";
      return empty;
    }

    function createChatMessageEl() {
      var msgEl = document.createElement("div");
      var roleEl = document.createElement("div");
      roleEl.className = "chat-msg-role";
      var textEl = document.createElement("div");
      textEl.className = "chat-msg-text";
      msgEl.appendChild(roleEl);
      msgEl.appendChild(textEl);
      return msgEl;
    }

    function syncChatMessageEl(msgEl, msg, elapsedMs) {
      var roleEl = msgEl.querySelector(".chat-msg-role");
      var textEl = msgEl.querySelector(".chat-msg-text");
      if (!roleEl || !textEl) {
        msgEl.textContent = "";
        roleEl = document.createElement("div");
        roleEl.className = "chat-msg-role";
        textEl = document.createElement("div");
        textEl.className = "chat-msg-text";
        msgEl.appendChild(roleEl);
        msgEl.appendChild(textEl);
      }

      var cls = "chat-msg " + (msg.role === "user" ? "chat-msg-user" : "chat-msg-assistant");
      if (msg.streaming) cls += " chat-msg-streaming";
      msgEl.className = cls;
      roleEl.textContent = msg.role === "user" ? "You" : "Claude";
      textEl.textContent = msg.text || "";

      var metaEl = msgEl.querySelector(".chat-msg-elapsed, .chat-msg-background");
      if (msg.streaming && chatBusy) {
        if (!metaEl || !metaEl.classList.contains("chat-msg-elapsed")) {
          if (metaEl) metaEl.remove();
          metaEl = document.createElement("div");
          metaEl.className = "chat-msg-elapsed";
          msgEl.appendChild(metaEl);
        }
        metaEl.textContent = fmtElapsed(elapsedMs);
      } else if (msg.background) {
        if (!metaEl || !metaEl.classList.contains("chat-msg-background")) {
          if (metaEl) metaEl.remove();
          metaEl = document.createElement("div");
          metaEl.className = "chat-msg-background";
          msgEl.appendChild(metaEl);
        }
        metaEl.textContent = "\u2699 working in background...";
      } else if (metaEl) {
        metaEl.remove();
      }
    }

    function renderChatHistory() {
      if (!chatMessages) return;
      if (!chatHistory.length) {
        if (
          chatMessages.children.length !== 1 ||
          !chatMessages.firstElementChild ||
          !chatMessages.firstElementChild.classList.contains("chat-empty")
        ) {
          chatMessages.textContent = "";
          chatMessages.appendChild(createChatEmptyState());
        }
        return;
      }

      if (chatMessages.firstElementChild && chatMessages.firstElementChild.classList.contains("chat-empty")) {
        chatMessages.textContent = "";
      }

      var elapsedMs = Date.now() - chatStartedAt;

      for (var i = 0; i < chatHistory.length; i++) {
        var msgEl = chatMessages.children[i];
        if (!msgEl || !msgEl.classList.contains("chat-msg")) {
          msgEl = createChatMessageEl();
          if (i >= chatMessages.children.length) {
            chatMessages.appendChild(msgEl);
          } else {
            chatMessages.insertBefore(msgEl, chatMessages.children[i]);
          }
        }
        syncChatMessageEl(msgEl, chatHistory[i], elapsedMs);
      }

      while (chatMessages.children.length > chatHistory.length) {
        chatMessages.removeChild(chatMessages.lastElementChild);
      }

      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function autoResizeChatInput() {
      if (!chatInput) return;
      chatInput.style.height = "auto";
      chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + "px";
    }

    async function sendChat() {
      if (chatBusy || !chatInput) return;
      var message = (chatInput.value || "").trim();
      if (!message) return;

      chatInput.value = "";
      autoResizeChatInput();
      setChatBusy(true);

      chatHistory.push({ role: "user", text: message });
      var assistantIdx = chatHistory.length;
      chatHistory.push({ role: "assistant", text: "", streaming: true });
      renderChatHistory();

      chatAbortController = new AbortController();

      try {
        var res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: message }),
          signal: chatAbortController.signal,
        });

        if (!res.body) throw new Error("No response body");

        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var buf = "";

        while (true) {
          var read = await reader.read();
          if (read.done) break;
          buf += dec.decode(read.value, { stream: true });
          var lines = buf.split("\n");
          buf = lines.pop() || "";
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            if (!line.startsWith("data: ")) continue;
            try {
              var ev = JSON.parse(line.slice(6));
              if (ev.type === "chunk") {
                chatHistory[assistantIdx].text += ev.text;
                renderChatHistory();
              } else if (ev.type === "unblock") {
                // Claude has acknowledged \u2014 unblock the input so user can send more messages
                // while the background task continues running
                setChatBusy(false);
                chatHistory[assistantIdx].background = true;
                renderChatHistory();
              } else if (ev.type === "done") {
                chatHistory[assistantIdx].streaming = false;
                chatHistory[assistantIdx].background = false;
                renderChatHistory();
                saveChatHistory();
              } else if (ev.type === "error") {
                chatHistory[assistantIdx].text = chatHistory[assistantIdx].text
                  ? chatHistory[assistantIdx].text + "\n\n[Error: " + ev.message + "]"
                  : "[Error: " + ev.message + "]";
                chatHistory[assistantIdx].streaming = false;
                chatHistory[assistantIdx].background = false;
                renderChatHistory();
                saveChatHistory();
              }
            } catch (_) {}
          }
        }
        chatHistory[assistantIdx].streaming = false;
        renderChatHistory();
        saveChatHistory();
      } catch (err) {
        var cancelled = err && err.name === "AbortError";
        chatHistory[assistantIdx].text = cancelled
          ? (chatHistory[assistantIdx].text || "[Cancelled]")
          : "[Failed: " + String(err) + "]";
        chatHistory[assistantIdx].streaming = false;
        renderChatHistory();
        saveChatHistory();
      } finally {
        setChatBusy(false);
        if (chatInput) chatInput.focus();
      }
    }

    if (chatForm) {
      chatForm.addEventListener("submit", function(e) {
        e.preventDefault();
        sendChat();
      });
    }

    if (chatInput) {
      chatInput.addEventListener("input", autoResizeChatInput);
      chatInput.addEventListener("keydown", function(e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendChat();
        }
      });
    }

    var chatCancelBtn = $("chat-cancel");
    if (chatCancelBtn) {
      chatCancelBtn.addEventListener("click", cancelChat);
    }

    // Update elapsed timer in-place every second (no full re-render = no blink).
    setInterval(function() {
      if (chatBusy && chatMessages) {
        var elapsedEl = chatMessages.querySelector(".chat-msg-elapsed");
        if (elapsedEl) elapsedEl.textContent = fmtElapsed(Date.now() - chatStartedAt);
      }
    }, 1000);`;

// src/ui/page/template.ts
function decodeUnicodeEscapes(text) {
  const decodedCodePoints = text.replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex) => {
    const codePoint = Number.parseInt(hex, 16);
    return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
  });
  return decodedCodePoints.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    const code = Number.parseInt(hex, 16);
    return Number.isFinite(code) ? String.fromCharCode(code) : _;
  });
}
function htmlPage() {
  const html = String.raw`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ClaudeClaw</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,500&family=Space+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
${pageStyles}
  </style>
</head>
<body>
  <div class="grain" aria-hidden="true"></div>
  <a
    class="repo-cta"
    href="https://github.com/moazbuilds/claudeclaw"
    target="_blank"
    rel="noopener noreferrer"
    aria-label="Star claudeclaw on GitHub"
  >
    <span class="repo-text">Like ClaudeClaw? Star it on GitHub</span>
    <span class="repo-star">\u2605</span>
  </a>
  <button class="settings-btn" id="settings-btn" type="button">Settings</button>
  <aside class="settings-modal" id="settings-modal" aria-live="polite">
    <div class="settings-head">
      <span>Settings</span>
      <button class="settings-close" id="settings-close" type="button" aria-label="Close settings">\u00D7</button>
    </div>
    <div class="settings-stack">
      <div class="setting-item">
        <div class="setting-main">
          <div class="settings-label">\u{1f493} Heartbeat</div>
          <div class="settings-meta" id="hb-info">syncing...</div>
        </div>
        <div class="setting-actions">
          <button class="hb-config" id="hb-config" type="button">Configure</button>
          <button class="hb-toggle" id="hb-toggle" type="button">Loading...</button>
        </div>
      </div>
      <div class="setting-item">
        <div class="setting-main">
          <div class="settings-label">\u{1f552} Clock</div>
          <div class="settings-meta" id="clock-info">24-hour format</div>
        </div>
        <button class="hb-toggle" id="clock-toggle" type="button">24h</button>
      </div>
      <div class="setting-item">
        <div class="setting-main">
          <div class="settings-label">\u{1f9fe} Advanced</div>
          <div class="settings-meta">Technical runtime and JSON files</div>
        </div>
        <button class="hb-toggle on" id="info-open" type="button">Info</button>
      </div>
    </div>
  </aside>
  <section class="info-modal" id="hb-modal" aria-live="polite" aria-hidden="true">
    <article class="hb-card">
      <div class="info-head">
        <span>Heartbeat Configuration</span>
        <button class="settings-close" id="hb-modal-close" type="button" aria-label="Close heartbeat configuration">\u00D7</button>
      </div>
      <form class="hb-form" id="hb-form">
        <label class="hb-field" for="hb-interval-input">
          <span class="hb-label">Interval (minutes)</span>
          <input class="hb-input" id="hb-interval-input" type="number" min="1" max="1440" step="1" required />
        </label>
        <label class="hb-field" for="hb-prompt-input">
          <span class="hb-label">Custom prompt</span>
          <textarea class="hb-textarea" id="hb-prompt-input" placeholder="What should heartbeat run?" required></textarea>
        </label>
        <div class="hb-actions">
          <div class="hb-status" id="hb-modal-status"></div>
          <div class="hb-buttons">
            <button class="hb-btn ghost" id="hb-cancel-btn" type="button">Cancel</button>
            <button class="hb-btn solid" id="hb-save-btn" type="submit">Save</button>
          </div>
        </div>
      </form>
    </article>
  </section>
  <section class="info-modal" id="info-modal" aria-live="polite" aria-hidden="true">
    <article class="info-card">
      <div class="info-head">
        <span>Advanced Technical Info</span>
        <button class="settings-close" id="info-close" type="button" aria-label="Close technical info">\u00D7</button>
      </div>
      <div class="info-body" id="info-body">
        <div class="info-section">
          <div class="info-title">Loading</div>
          <pre class="info-json">Loading technical data...</pre>
        </div>
      </div>
    </article>
  </section>
  <main class="stage">
    <nav class="tab-nav" role="tablist" aria-label="Main navigation">
      <button class="tab-btn tab-btn-active" id="tab-dashboard" type="button" role="tab" aria-selected="true" aria-controls="dashboard-panel">Dashboard</button>
      <button class="tab-btn" id="tab-chat" type="button" role="tab" aria-selected="false" aria-controls="chat-panel">Chat</button>
    </nav>
    <div id="dashboard-panel">
    <section class="hero">
      <div class="logo-art" role="img" aria-label="Lobster ASCII art logo">
        <div class="logo-top"><span>\u{1f99e}</span><span>\u{1f99e}</span></div>
        <pre class="logo-body">   \u2590\u259B\u2588\u2588\u2588\u259C\u258C
  \u259D\u259C\u2588\u2588\u2588\u2588\u2588\u259B\u2598
    \u2598\u2598 \u259D\u259D</pre>
      </div>
      <div class="typewriter" id="typewriter" aria-live="polite"></div>
      <div class="time" id="clock">--:--:--</div>
      <div class="date" id="date">Loading date...</div>
      <div class="message" id="message">Welcome back.</div>
      <section class="quick-job" id="quick-jobs-view">
        <div class="quick-job-head quick-job-head-row">
          <div>
            <div class="quick-job-title">Jobs List</div>
            <div class="quick-job-sub">Scheduled runs loaded from runtime jobs</div>
            <div class="quick-jobs-next" id="quick-jobs-next">Next job in --</div>
          </div>
          <button class="quick-open-create" id="quick-open-create" type="button">Create Job</button>
        </div>
        <div class="quick-jobs-list quick-jobs-list-main" id="quick-jobs-list">
          <div class="quick-jobs-empty">Loading jobs...</div>
        </div>
        <div class="quick-status" id="quick-jobs-status"></div>
      </section>
      <form class="quick-job quick-view-hidden" id="quick-job-form">
        <div class="quick-job-head">
          <div class="quick-job-title">Add Scheduled Job</div>
          <div class="quick-job-sub">Recurring cron with prompt payload</div>
        </div>
        <div class="quick-job-grid">
          <div class="quick-field quick-time-wrap">
            <div class="quick-label">Delay From Now (Minutes)</div>
            <div class="quick-input-wrap">
            <input class="quick-input" id="quick-job-offset" type="number" min="1" max="1440" step="1" placeholder="10" required />
              <label class="quick-check quick-check-inline" for="quick-job-recurring">
                <input id="quick-job-recurring" type="checkbox" checked />
                <span>Recurring</span>
              </label>
            </div>
            <div class="quick-time-buttons">
              <button class="quick-add" type="button" data-add-minutes="15">+15m</button>
              <button class="quick-add" type="button" data-add-minutes="30">+30m</button>
              <button class="quick-add" type="button" data-add-minutes="60">+1h</button>
              <button class="quick-add" type="button" data-add-minutes="180">+3h</button>
            </div>
            <div class="quick-preview" id="quick-job-preview">Runs in -- min</div>
          </div>
          <div class="quick-field">
            <div class="quick-label">Prompt</div>
            <textarea class="quick-prompt" id="quick-job-prompt" placeholder="Remind me to drink water." required></textarea>
            <div class="quick-prompt-meta">
              <span id="quick-job-count">0 chars</span>
              <span>Saved at computed clock time</span>
            </div>
          </div>
        </div>
        <div class="quick-job-actions">
          <button class="quick-submit" id="quick-job-submit" type="submit">Add to Jobs List</button>
          <div class="quick-status" id="quick-job-status"></div>
        </div>
        <div class="quick-form-foot">
          <button class="quick-back-jobs" id="quick-back-jobs" type="button">Back to Jobs List</button>
        </div>
      </form>
    </section>
    </div>
    <div id="chat-panel" class="chat-panel" hidden>
      <div id="chat-messages" class="chat-messages"></div>
      <div class="chat-input-area">
        <form id="chat-form" class="chat-form">
          <textarea
            id="chat-input"
            class="chat-input"
            placeholder="Message Claude..."
            rows="1"
            autocomplete="off"
          ></textarea>
          <button id="chat-cancel" class="chat-cancel" type="button" hidden>Cancel</button>
          <button id="chat-send" class="chat-send" type="submit">Send</button>
        </form>
      </div>
    </div>
  </main>

  <div class="dock-shell">
    <aside class="side-bubble" id="jobs-bubble" aria-live="polite">
      <div class="side-icon">\u{1f5c2}\uFE0F</div>
      <div class="side-value">-</div>
      <div class="side-label">Jobs</div>
    </aside>
    <footer class="dock" id="dock" aria-live="polite">
      <div class="pill">Connecting...</div>
    </footer>
    <aside class="side-bubble" id="uptime-bubble" aria-live="polite">
      <div class="side-icon">\u23F1\uFE0F</div>
      <div class="side-value">-</div>
      <div class="side-label">Uptime</div>
    </aside>
  </div>

  <script>
${pageScript}
  </script>
</body>
</html>`;
  return decodeUnicodeEscapes(html);
}
// src/ui/http.ts
function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
function clampInt(raw, fallback, min, max) {
  const n = raw ? Number(raw) : fallback;
  if (!Number.isFinite(n))
    return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

// src/ui/services/state.ts
init_sessions();
import { readFile as readFile3 } from "fs/promises";

// src/ui/constants.ts
import { join as join8 } from "path";
var HEARTBEAT_DIR5 = join8(process.cwd(), ".claude", "claudeclaw");
var LOGS_DIR3 = join8(HEARTBEAT_DIR5, "logs");
var JOBS_DIR3 = join8(HEARTBEAT_DIR5, "jobs");
var SETTINGS_FILE2 = join8(HEARTBEAT_DIR5, "settings.json");
var SESSION_FILE2 = join8(HEARTBEAT_DIR5, "session.json");
var STATE_FILE = join8(HEARTBEAT_DIR5, "state.json");

// src/ui/services/state.ts
function sanitizeSettings(snapshot) {
  return {
    timezone: snapshot.timezone,
    timezoneOffsetMinutes: snapshot.timezoneOffsetMinutes,
    heartbeat: snapshot.heartbeat,
    security: snapshot.security,
    telegram: {
      configured: Boolean(snapshot.telegram.token),
      allowedUserCount: snapshot.telegram.allowedUserIds.length
    },
    discord: {
      configured: Boolean(snapshot.discord.token),
      allowedUserCount: snapshot.discord.allowedUserIds.length
    },
    web: snapshot.web
  };
}
async function buildState(snapshot) {
  const now = Date.now();
  const session = await peekSession();
  return {
    daemon: {
      running: true,
      pid: snapshot.pid,
      startedAt: snapshot.startedAt,
      uptimeMs: now - snapshot.startedAt
    },
    heartbeat: {
      enabled: snapshot.settings.heartbeat.enabled,
      intervalMinutes: snapshot.settings.heartbeat.interval,
      nextAt: snapshot.heartbeatNextAt || null,
      nextInMs: snapshot.heartbeatNextAt ? Math.max(0, snapshot.heartbeatNextAt - now) : null
    },
    jobs: snapshot.jobs.map((j) => ({
      name: j.name,
      schedule: j.schedule,
      prompt: j.prompt
    })),
    security: snapshot.settings.security,
    telegram: {
      configured: Boolean(snapshot.settings.telegram.token),
      allowedUserCount: snapshot.settings.telegram.allowedUserIds.length
    },
    discord: {
      configured: Boolean(snapshot.settings.discord.token),
      allowedUserCount: snapshot.settings.discord.allowedUserIds.length
    },
    session: session ? {
      sessionIdShort: session.sessionId.slice(0, 8),
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt
    } : null,
    web: snapshot.settings.web
  };
}
async function buildTechnicalInfo(snapshot) {
  return {
    daemon: {
      pid: snapshot.pid,
      startedAt: snapshot.startedAt,
      uptimeMs: Math.max(0, Date.now() - snapshot.startedAt)
    },
    files: {
      settingsJson: await readJsonFile(SETTINGS_FILE2),
      sessionJson: await readJsonFile(SESSION_FILE2),
      stateJson: await readJsonFile(STATE_FILE)
    },
    snapshot
  };
}
async function readJsonFile(path) {
  try {
    const raw = await readFile3(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// src/ui/services/settings.ts
import { readFile as readFile4, writeFile as writeFile3 } from "fs/promises";
async function readHeartbeatSettings() {
  const raw = await readFile4(SETTINGS_FILE2, "utf-8");
  const data = JSON.parse(raw);
  if (!data.heartbeat || typeof data.heartbeat !== "object")
    data.heartbeat = {};
  return {
    enabled: Boolean(data.heartbeat.enabled),
    interval: Number(data.heartbeat.interval) || 15,
    prompt: typeof data.heartbeat.prompt === "string" ? data.heartbeat.prompt : "",
    excludeWindows: Array.isArray(data.heartbeat.excludeWindows) ? data.heartbeat.excludeWindows : []
  };
}
async function updateHeartbeatSettings(patch) {
  const raw = await readFile4(SETTINGS_FILE2, "utf-8");
  const data = JSON.parse(raw);
  if (!data.heartbeat || typeof data.heartbeat !== "object")
    data.heartbeat = {};
  if (typeof patch.enabled === "boolean") {
    data.heartbeat.enabled = patch.enabled;
  }
  if (typeof patch.interval === "number" && Number.isFinite(patch.interval)) {
    const clamped = Math.max(1, Math.min(1440, Math.round(patch.interval)));
    data.heartbeat.interval = clamped;
  }
  if (typeof patch.prompt === "string") {
    data.heartbeat.prompt = patch.prompt;
  }
  if (Array.isArray(patch.excludeWindows)) {
    data.heartbeat.excludeWindows = patch.excludeWindows;
  }
  await writeFile3(SETTINGS_FILE2, JSON.stringify(data, null, 2) + `
`);
  return {
    enabled: Boolean(data.heartbeat.enabled),
    interval: Number(data.heartbeat.interval) || 15,
    prompt: typeof data.heartbeat.prompt === "string" ? data.heartbeat.prompt : "",
    excludeWindows: Array.isArray(data.heartbeat.excludeWindows) ? data.heartbeat.excludeWindows : []
  };
}

// src/ui/services/jobs.ts
import { mkdir as mkdir3, writeFile as writeFile4 } from "fs/promises";
import { join as join9 } from "path";
async function createQuickJob(input) {
  const time = typeof input.time === "string" ? input.time.trim() : "";
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  const recurring = input.recurring == null ? input.daily == null ? true : Boolean(input.daily) : Boolean(input.recurring);
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new Error("Invalid time. Use HH:MM.");
  }
  if (!prompt) {
    throw new Error("Prompt is required.");
  }
  if (prompt.length > 1e4) {
    throw new Error("Prompt too long.");
  }
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(3, 5));
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("Time out of range.");
  }
  const schedule = `${minute} ${hour} * * *`;
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const name = `quick-${stamp}-${hour.toString().padStart(2, "0")}${minute.toString().padStart(2, "0")}`;
  const path = join9(JOBS_DIR3, `${name}.md`);
  const content = `---
schedule: "${schedule}"
recurring: ${recurring ? "true" : "false"}
---
${prompt}
`;
  await mkdir3(JOBS_DIR3, { recursive: true });
  await writeFile4(path, content, "utf-8");
  return { name, schedule, recurring };
}
async function deleteJob(name) {
  const jobName = String(name || "").trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(jobName)) {
    throw new Error("Invalid job name.");
  }
  const path = join9(JOBS_DIR3, `${jobName}.md`);
  await Bun.file(path).delete();
}

// src/ui/services/logs.ts
import { readFile as readFile5, readdir as readdir3, stat } from "fs/promises";
import { join as join10 } from "path";
async function readLogs(tail) {
  const daemonLog = await readTail(join10(LOGS_DIR3, "daemon.log"), tail);
  const runs = await readRecentRunLogs(tail);
  return { daemonLog, runs };
}
async function readRecentRunLogs(tail) {
  let files = [];
  try {
    files = await readdir3(LOGS_DIR3);
  } catch {
    return [];
  }
  const candidates = files.filter((f) => f.endsWith(".log") && f !== "daemon.log").slice(0, 200);
  const withStats = await Promise.all(candidates.map(async (name) => {
    const path = join10(LOGS_DIR3, name);
    try {
      const s = await stat(path);
      return { name, path, mtime: s.mtimeMs };
    } catch {
      return null;
    }
  }));
  return await Promise.all(withStats.filter((x) => Boolean(x)).sort((a, b) => b.mtime - a.mtime).slice(0, 5).map(async ({ name, path }) => ({
    file: name,
    lines: await readTail(path, tail)
  })));
}
async function readTail(path, lines) {
  try {
    const text = await readFile5(path, "utf-8");
    const all = text.split(/\r?\n/);
    return all.slice(Math.max(0, all.length - lines)).filter(Boolean);
  } catch {
    return [];
  }
}

// src/ui/server.ts
function startWebUi(opts) {
  const server = Bun.serve({
    hostname: opts.host,
    port: opts.port,
    idleTimeout: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(htmlPage(), {
          headers: { "Content-Type": "text/html; charset=utf-8" }
        });
      }
      if (url.pathname === "/api/health") {
        return json({ ok: true, now: Date.now() });
      }
      if (url.pathname === "/api/state") {
        return json(await buildState(opts.getSnapshot()));
      }
      if (url.pathname === "/api/settings") {
        return json(sanitizeSettings(opts.getSnapshot().settings));
      }
      if (url.pathname === "/api/settings/heartbeat" && req.method === "POST") {
        try {
          const body = await req.json();
          const payload = body;
          const patch = {};
          if ("enabled" in payload)
            patch.enabled = Boolean(payload.enabled);
          if ("interval" in payload) {
            const iv = Number(payload.interval);
            if (!Number.isFinite(iv))
              throw new Error("interval must be numeric");
            patch.interval = iv;
          }
          if ("prompt" in payload)
            patch.prompt = String(payload.prompt ?? "");
          if ("excludeWindows" in payload) {
            if (!Array.isArray(payload.excludeWindows)) {
              throw new Error("excludeWindows must be an array");
            }
            patch.excludeWindows = payload.excludeWindows.filter((entry) => entry && typeof entry === "object").map((entry) => {
              const row = entry;
              const start = String(row.start ?? "").trim();
              const end = String(row.end ?? "").trim();
              const days = Array.isArray(row.days) ? row.days.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : undefined;
              return {
                start,
                end,
                ...days && days.length > 0 ? { days } : {}
              };
            });
          }
          if (!("enabled" in patch) && !("interval" in patch) && !("prompt" in patch) && !("excludeWindows" in patch)) {
            throw new Error("no heartbeat fields provided");
          }
          const next = await updateHeartbeatSettings(patch);
          if (opts.onHeartbeatEnabledChanged && "enabled" in patch) {
            await opts.onHeartbeatEnabledChanged(Boolean(patch.enabled));
          }
          if (opts.onHeartbeatSettingsChanged) {
            await opts.onHeartbeatSettingsChanged(patch);
          }
          return json({ ok: true, heartbeat: next });
        } catch (err) {
          return json({ ok: false, error: String(err) });
        }
      }
      if (url.pathname === "/api/settings/heartbeat" && req.method === "GET") {
        try {
          return json({ ok: true, heartbeat: await readHeartbeatSettings() });
        } catch (err) {
          return json({ ok: false, error: String(err) });
        }
      }
      if (url.pathname === "/api/technical-info") {
        return json(await buildTechnicalInfo(opts.getSnapshot()));
      }
      if (url.pathname === "/api/jobs/quick" && req.method === "POST") {
        try {
          const body = await req.json();
          const result = await createQuickJob(body);
          if (opts.onJobsChanged)
            await opts.onJobsChanged();
          return json({ ok: true, ...result });
        } catch (err) {
          return json({ ok: false, error: String(err) });
        }
      }
      if (url.pathname.startsWith("/api/jobs/") && req.method === "DELETE") {
        try {
          const encodedName = url.pathname.slice("/api/jobs/".length);
          const name = decodeURIComponent(encodedName);
          await deleteJob(name);
          if (opts.onJobsChanged)
            await opts.onJobsChanged();
          return json({ ok: true });
        } catch (err) {
          return json({ ok: false, error: String(err) });
        }
      }
      if (url.pathname === "/api/jobs") {
        const jobs = opts.getSnapshot().jobs.map((j) => ({
          name: j.name,
          schedule: j.schedule,
          promptPreview: j.prompt.slice(0, 160)
        }));
        return json({ jobs });
      }
      if (url.pathname === "/api/logs") {
        const tail = clampInt(url.searchParams.get("tail"), 200, 20, 2000);
        return json(await readLogs(tail));
      }
      if (url.pathname === "/api/chat" && req.method === "POST") {
        if (!opts.onChat)
          return json({ ok: false, error: "chat not configured" });
        try {
          const body = await req.json();
          const message = String(body?.message ?? "").trim();
          if (!message)
            return json({ ok: false, error: "message required" });
          const encoder = new TextEncoder;
          const onChat = opts.onChat;
          const stream = new ReadableStream({
            async start(controller) {
              const send = (data) => {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}

`));
              };
              try {
                await onChat(message, (chunk) => send({ type: "chunk", text: chunk }), () => send({ type: "unblock" }));
                send({ type: "done" });
              } catch (err) {
                send({ type: "error", message: String(err) });
              } finally {
                controller.close();
              }
            }
          });
          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              "X-Accel-Buffering": "no"
            }
          });
        } catch (err) {
          return json({ ok: false, error: String(err) });
        }
      }
      return new Response("Not found", { status: 404 });
    }
  });
  return {
    stop: () => server.stop(),
    host: opts.host,
    port: server.port
  };
}
// src/commands/start.ts
var CLAUDE_DIR = join15(process.cwd(), ".claude");
var HEARTBEAT_DIR6 = join15(CLAUDE_DIR, "claudeclaw");
var STATUSLINE_FILE = join15(CLAUDE_DIR, "statusline.cjs");
var CLAUDE_SETTINGS_FILE = join15(CLAUDE_DIR, "settings.json");
var PREFLIGHT_SCRIPT = fileURLToPath2(new URL("../preflight.ts", import.meta.url));
var STATUSLINE_SCRIPT = `#!/usr/bin/env node
const { readFileSync } = require("fs");
const { join } = require("path");

const DIR = join(__dirname, "claudeclaw");
const STATE_FILE = join(DIR, "state.json");
const PID_FILE = join(DIR, "daemon.pid");

const R = "\\x1b[0m";
const DIM = "\\x1b[2m";
const RED = "\\x1b[31m";
const GREEN = "\\x1b[32m";

function fmt(ms) {
  if (ms <= 0) return GREEN + "now!" + R;
  var s = Math.floor(ms / 1000);
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  if (h > 0) return h + "h " + m + "m";
  if (m > 0) return m + "m";
  return (s % 60) + "s";
}

function alive() {
  try {
    var pid = readFileSync(PID_FILE, "utf-8").trim();
    process.kill(Number(pid), 0);
    return true;
  } catch { return false; }
}

var B = DIM + "\\u2502" + R;
var TL = DIM + "\\u256d" + R;
var TR = DIM + "\\u256e" + R;
var BL = DIM + "\\u2570" + R;
var BR = DIM + "\\u256f" + R;
var H = DIM + "\\u2500" + R;
var HEADER = TL + H.repeat(6) + " \\ud83e\\udd9e ClaudeClaw \\ud83e\\udd9e " + H.repeat(6) + TR;
var FOOTER = BL + H.repeat(30) + BR;

if (!alive()) {
  process.stdout.write(
    HEADER + "\\n" +
    B + "        " + RED + "\\u25cb offline" + R + "              " + B + "\\n" +
    FOOTER
  );
  process.exit(0);
}

try {
  var state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  var now = Date.now();
  var info = [];

  if (state.heartbeat) {
    info.push("\\ud83d\\udc93 " + fmt(state.heartbeat.nextAt - now));
  }

  var jc = (state.jobs || []).length;
  info.push("\\ud83d\\udccb " + jc + " job" + (jc !== 1 ? "s" : ""));
  info.push(GREEN + "\\u25cf live" + R);

  if (state.telegram) {
    info.push(GREEN + "\\ud83d\\udce1" + R);
  }

  if (state.discord) {
    info.push(GREEN + "\\ud83c\\udfae" + R);
  }

  var mid = " " + info.join(" " + B + " ") + " ";

  process.stdout.write(HEADER + "\\n" + B + mid + B + "\\n" + FOOTER);
} catch {
  process.stdout.write(
    HEADER + "\\n" +
    B + DIM + "         waiting...         " + R + B + "\\n" +
    FOOTER
  );
}
`;
var ALL_DAYS2 = [0, 1, 2, 3, 4, 5, 6];
function parseClockMinutes(value) {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match)
    return null;
  return Number(match[1]) * 60 + Number(match[2]);
}
function isHeartbeatExcludedNow(config, timezoneOffsetMinutes) {
  return isHeartbeatExcludedAt(config, timezoneOffsetMinutes, new Date);
}
function isHeartbeatExcludedAt(config, timezoneOffsetMinutes, at) {
  if (!Array.isArray(config.excludeWindows) || config.excludeWindows.length === 0)
    return false;
  const local = getDayAndMinuteAtOffset(at, timezoneOffsetMinutes);
  for (const window of config.excludeWindows) {
    const start = parseClockMinutes(window.start);
    const end = parseClockMinutes(window.end);
    if (start == null || end == null)
      continue;
    const days = Array.isArray(window.days) && window.days.length > 0 ? window.days : ALL_DAYS2;
    const sameDay = start < end;
    if (sameDay) {
      if (days.includes(local.day) && local.minute >= start && local.minute < end)
        return true;
      continue;
    }
    if (start === end) {
      if (days.includes(local.day))
        return true;
      continue;
    }
    if (local.minute >= start && days.includes(local.day))
      return true;
    const previousDay = (local.day + 6) % 7;
    if (local.minute < end && days.includes(previousDay))
      return true;
  }
  return false;
}
function nextAllowedHeartbeatAt(config, timezoneOffsetMinutes, intervalMs, fromMs) {
  const interval = Math.max(60000, Math.round(intervalMs));
  let candidate = fromMs + interval;
  let guard = 0;
  while (isHeartbeatExcludedAt(config, timezoneOffsetMinutes, new Date(candidate)) && guard < 20000) {
    candidate += interval;
    guard++;
  }
  return candidate;
}
async function setupStatusline() {
  await mkdir7(CLAUDE_DIR, { recursive: true });
  await writeFile5(STATUSLINE_FILE, STATUSLINE_SCRIPT);
  let settings = {};
  try {
    settings = await Bun.file(CLAUDE_SETTINGS_FILE).json();
  } catch {}
  settings.statusLine = {
    type: "command",
    command: "node .claude/statusline.cjs"
  };
  await writeFile5(CLAUDE_SETTINGS_FILE, JSON.stringify(settings, null, 2) + `
`);
}
async function teardownStatusline() {
  try {
    const settings = await Bun.file(CLAUDE_SETTINGS_FILE).json();
    delete settings.statusLine;
    await writeFile5(CLAUDE_SETTINGS_FILE, JSON.stringify(settings, null, 2) + `
`);
  } catch {}
  try {
    await unlink3(STATUSLINE_FILE);
  } catch {}
}
async function start(args = []) {
  let hasPromptFlag = false;
  let hasTriggerFlag = false;
  let telegramFlag = false;
  let discordFlag = false;
  let debugFlag = false;
  let webFlag = false;
  let replaceExistingFlag = false;
  let webPortFlag = null;
  const payloadParts = [];
  for (let i = 0;i < args.length; i++) {
    const arg = args[i];
    if (arg === "--prompt") {
      hasPromptFlag = true;
    } else if (arg === "--trigger") {
      hasTriggerFlag = true;
    } else if (arg === "--telegram") {
      telegramFlag = true;
    } else if (arg === "--discord") {
      discordFlag = true;
    } else if (arg === "--debug") {
      debugFlag = true;
    } else if (arg === "--web") {
      webFlag = true;
    } else if (arg === "--replace-existing") {
      replaceExistingFlag = true;
    } else if (arg === "--web-port") {
      const raw = args[i + 1];
      if (!raw) {
        console.error("`--web-port` requires a numeric value.");
        process.exit(1);
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
        console.error("`--web-port` must be a valid TCP port (1-65535).");
        process.exit(1);
      }
      webPortFlag = parsed;
      i++;
    } else {
      payloadParts.push(arg);
    }
  }
  const payload = payloadParts.join(" ").trim();
  if (hasPromptFlag && !payload) {
    console.error("Usage: claudeclaw start --prompt <prompt> [--trigger] [--telegram] [--discord] [--debug] [--web] [--web-port <port>] [--replace-existing]");
    process.exit(1);
  }
  if (!hasPromptFlag && payload) {
    console.error("Prompt text requires `--prompt`.");
    process.exit(1);
  }
  if (telegramFlag && !hasTriggerFlag) {
    console.error("`--telegram` with `start` requires `--trigger`.");
    process.exit(1);
  }
  if (discordFlag && !hasTriggerFlag) {
    console.error("`--discord` with `start` requires `--trigger`.");
    process.exit(1);
  }
  if (hasPromptFlag && !hasTriggerFlag && (webFlag || webPortFlag !== null)) {
    console.error("`--web` is daemon-only. Remove `--prompt`, or add `--trigger`.");
    process.exit(1);
  }
  if (hasPromptFlag && !hasTriggerFlag) {
    const existingPid2 = await checkExistingDaemon();
    if (existingPid2) {
      console.error(`\x1B[31mAborted: daemon already running in this directory (PID ${existingPid2})\x1B[0m`);
      console.error("Use `claudeclaw send <message> [--telegram] [--discord]` while daemon is running.");
      process.exit(1);
    }
    await initConfig();
    await loadSettings();
    await ensureProjectClaudeMd();
    const result = await runUserMessage("prompt", payload);
    console.log(result.stdout);
    if (result.exitCode !== 0)
      process.exit(result.exitCode);
    return;
  }
  const existingPid = await checkExistingDaemon();
  if (existingPid) {
    if (!replaceExistingFlag) {
      console.error(`\x1B[31mAborted: daemon already running in this directory (PID ${existingPid})\x1B[0m`);
      console.error(`Use --stop first, or kill PID ${existingPid} manually.`);
      process.exit(1);
    }
    console.log(`Replacing existing daemon (PID ${existingPid})...`);
    try {
      process.kill(existingPid, "SIGTERM");
    } catch {}
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      try {
        process.kill(existingPid, 0);
        await Bun.sleep(100);
      } catch {
        break;
      }
    }
    await cleanupPidFile();
  }
  await initConfig();
  const settings = await loadSettings();
  await ensureProjectClaudeMd();
  const jobs = await loadJobs();
  const webEnabled = webFlag || webPortFlag !== null || settings.web.enabled;
  const webPort = webPortFlag ?? settings.web.port;
  await setupStatusline();
  await writePidFile();
  let web = null;
  let discordStopGateway = null;
  async function shutdown() {
    if (discordStopGateway)
      discordStopGateway();
    if (web)
      web.stop();
    await teardownStatusline();
    await cleanupPidFile();
    process.exit(0);
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  console.log("ClaudeClaw daemon started");
  console.log(`  PID: ${process.pid}`);
  console.log(`  Security: ${settings.security.level}`);
  if (settings.security.allowedTools.length > 0)
    console.log(`    + allowed: ${settings.security.allowedTools.join(", ")}`);
  if (settings.security.disallowedTools.length > 0)
    console.log(`    - blocked: ${settings.security.disallowedTools.join(", ")}`);
  console.log(`  Heartbeat: ${settings.heartbeat.enabled ? `every ${settings.heartbeat.interval}m` : "disabled"}`);
  console.log(`  Web UI: ${webEnabled ? `http://${settings.web.host}:${webPort}` : "disabled"}`);
  if (debugFlag)
    console.log("  Debug: enabled");
  console.log(`  Jobs loaded: ${jobs.length}`);
  jobs.forEach((j) => console.log(`    - ${j.name} [${j.schedule}]`));
  let currentSettings = settings;
  let currentJobs = jobs;
  let nextHeartbeatAt = 0;
  let heartbeatTimer2 = null;
  const daemonStartedAt = Date.now();
  let telegramSend = null;
  let telegramToken = "";
  async function initTelegram(token) {
    if (token && token !== telegramToken) {
      const { startPolling: startPolling2, sendMessage: sendMessage3 } = await Promise.resolve().then(() => (init_telegram(), exports_telegram));
      startPolling2(debugFlag);
      telegramSend = (chatId, text) => sendMessage3(token, chatId, text);
      telegramToken = token;
      console.log(`[${ts()}] Telegram: enabled`);
    } else if (!token && telegramToken) {
      telegramSend = null;
      telegramToken = "";
      console.log(`[${ts()}] Telegram: disabled`);
    }
  }
  await initTelegram(currentSettings.telegram.token);
  if (!telegramToken)
    console.log("  Telegram: not configured");
  let discordSendToUser = null;
  let discordToken = "";
  async function initDiscord(token) {
    if (token && token !== discordToken) {
      const { startGateway: startGateway2, sendMessageToUser: sendMessageToUser2, stopGateway: stopGateway2 } = await Promise.resolve().then(() => (init_discord(), exports_discord));
      if (discordToken)
        stopGateway2();
      startGateway2(debugFlag);
      discordStopGateway = stopGateway2;
      discordSendToUser = (userId, text) => sendMessageToUser2(token, userId, text);
      discordToken = token;
      console.log(`[${ts()}] Discord: enabled`);
    } else if (!token && discordToken) {
      if (discordStopGateway)
        discordStopGateway();
      discordStopGateway = null;
      discordSendToUser = null;
      discordToken = "";
      console.log(`[${ts()}] Discord: disabled`);
    }
  }
  await initDiscord(currentSettings.discord.token);
  if (!discordToken)
    console.log("  Discord: not configured");
  function isAddrInUse(err) {
    if (!err || typeof err !== "object")
      return false;
    const code = "code" in err ? String(err.code) : "";
    const message = "message" in err ? String(err.message) : "";
    return code === "EADDRINUSE" || message.includes("EADDRINUSE");
  }
  function startWebWithFallback(host, preferredPort) {
    const maxAttempts = 10;
    let lastError;
    for (let i = 0;i < maxAttempts; i++) {
      const candidatePort = preferredPort + i;
      try {
        return startWebUi({
          host,
          port: candidatePort,
          getSnapshot: () => ({
            pid: process.pid,
            startedAt: daemonStartedAt,
            heartbeatNextAt: nextHeartbeatAt,
            settings: currentSettings,
            jobs: currentJobs
          }),
          onHeartbeatEnabledChanged: (enabled) => {
            if (currentSettings.heartbeat.enabled === enabled)
              return;
            currentSettings.heartbeat.enabled = enabled;
            scheduleHeartbeat();
            updateState();
            console.log(`[${ts()}] Heartbeat ${enabled ? "enabled" : "disabled"} from Web UI`);
          },
          onHeartbeatSettingsChanged: (patch) => {
            let changed = false;
            if (typeof patch.enabled === "boolean" && currentSettings.heartbeat.enabled !== patch.enabled) {
              currentSettings.heartbeat.enabled = patch.enabled;
              changed = true;
            }
            if (typeof patch.interval === "number" && Number.isFinite(patch.interval)) {
              const interval = Math.max(1, Math.min(1440, Math.round(patch.interval)));
              if (currentSettings.heartbeat.interval !== interval) {
                currentSettings.heartbeat.interval = interval;
                changed = true;
              }
            }
            if (typeof patch.prompt === "string" && currentSettings.heartbeat.prompt !== patch.prompt) {
              currentSettings.heartbeat.prompt = patch.prompt;
              changed = true;
            }
            if (Array.isArray(patch.excludeWindows)) {
              const prev = JSON.stringify(currentSettings.heartbeat.excludeWindows);
              const next = JSON.stringify(patch.excludeWindows);
              if (prev !== next) {
                currentSettings.heartbeat.excludeWindows = patch.excludeWindows;
                changed = true;
              }
            }
            if (!changed)
              return;
            scheduleHeartbeat();
            updateState();
            console.log(`[${ts()}] Heartbeat settings updated from Web UI`);
          },
          onJobsChanged: async () => {
            currentJobs = await loadJobs();
            scheduleHeartbeat();
            updateState();
            console.log(`[${ts()}] Jobs reloaded from Web UI`);
          },
          onChat: async (message, onChunk, onUnblock) => {
            await streamUserMessage("chat", message, onChunk, onUnblock);
          }
        });
      } catch (err) {
        lastError = err;
        if (!isAddrInUse(err) || i === maxAttempts - 1)
          throw err;
      }
    }
    throw lastError;
  }
  if (webEnabled) {
    currentSettings.web.enabled = true;
    web = startWebWithFallback(currentSettings.web.host, webPort);
    currentSettings.web.port = web.port;
    console.log(`[${new Date().toLocaleTimeString()}] Web UI listening on http://${web.host}:${web.port}`);
  }
  function ts() {
    return new Date().toLocaleTimeString();
  }
  function startPreflightInBackground(projectPath) {
    try {
      const proc = Bun.spawn([process.execPath, "run", PREFLIGHT_SCRIPT, projectPath], {
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit"
      });
      proc.unref();
      console.log(`[${ts()}] Plugin preflight started in background`);
    } catch (err) {
      console.error(`[${ts()}] Failed to start plugin preflight:`, err);
    }
  }
  function forwardToTelegram(label, result) {
    if (!telegramSend || currentSettings.telegram.allowedUserIds.length === 0)
      return;
    const text = result.exitCode === 0 ? `${label ? `[${label}]
` : ""}${result.stdout || "(empty)"}` : `${label ? `[${label}] ` : ""}error (exit ${result.exitCode}): ${result.stderr || "Unknown"}`;
    for (const userId of currentSettings.telegram.allowedUserIds) {
      telegramSend(userId, text).catch((err) => console.error(`[Telegram] Failed to forward to ${userId}: ${err}`));
    }
  }
  function forwardToDiscord(label, result) {
    if (!discordSendToUser || currentSettings.discord.allowedUserIds.length === 0)
      return;
    const text = result.exitCode === 0 ? `${label ? `[${label}]
` : ""}${result.stdout || "(empty)"}` : `${label ? `[${label}] ` : ""}error (exit ${result.exitCode}): ${result.stderr || "Unknown"}`;
    for (const userId of currentSettings.discord.allowedUserIds) {
      discordSendToUser(userId, text).catch((err) => console.error(`[Discord] Failed to forward to ${userId}: ${err}`));
    }
  }
  function scheduleHeartbeat() {
    if (heartbeatTimer2)
      clearTimeout(heartbeatTimer2);
    heartbeatTimer2 = null;
    if (!currentSettings.heartbeat.enabled) {
      nextHeartbeatAt = 0;
      return;
    }
    const ms = currentSettings.heartbeat.interval * 60000;
    nextHeartbeatAt = nextAllowedHeartbeatAt(currentSettings.heartbeat, currentSettings.timezoneOffsetMinutes, ms, Date.now());
    function tick() {
      if (isHeartbeatExcludedNow(currentSettings.heartbeat, currentSettings.timezoneOffsetMinutes)) {
        console.log(`[${ts()}] Heartbeat skipped (excluded window)`);
        nextHeartbeatAt = nextAllowedHeartbeatAt(currentSettings.heartbeat, currentSettings.timezoneOffsetMinutes, ms, Date.now());
        return;
      }
      Promise.all([
        resolvePrompt(currentSettings.heartbeat.prompt),
        loadHeartbeatPromptTemplate()
      ]).then(([prompt, template]) => {
        const userPromptSection = prompt.trim() ? `User custom heartbeat prompt:
${prompt.trim()}` : "";
        const mergedPrompt = [template.trim(), userPromptSection].filter((part) => part.length > 0).join(`

`);
        if (!mergedPrompt)
          return null;
        return run("heartbeat", mergedPrompt);
      }).then((r) => {
        if (!r)
          return;
        const shouldForward = currentSettings.heartbeat.forwardToTelegram || !r.stdout.trim().startsWith("HEARTBEAT_OK");
        if (shouldForward) {
          forwardToTelegram("", r);
          forwardToDiscord("", r);
        }
      });
      nextHeartbeatAt = nextAllowedHeartbeatAt(currentSettings.heartbeat, currentSettings.timezoneOffsetMinutes, ms, Date.now());
    }
    heartbeatTimer2 = setTimeout(function runAndReschedule() {
      tick();
      heartbeatTimer2 = setTimeout(runAndReschedule, ms);
    }, ms);
  }
  if (hasTriggerFlag) {
    const triggerPrompt = hasPromptFlag ? payload : "Wake up, my friend!";
    const triggerResult = await run("trigger", triggerPrompt);
    console.log(triggerResult.stdout);
    if (telegramFlag)
      forwardToTelegram("", triggerResult);
    if (discordFlag)
      forwardToDiscord("", triggerResult);
    if (triggerResult.exitCode !== 0) {
      console.error(`[${ts()}] Startup trigger failed (exit ${triggerResult.exitCode}). Daemon will continue running.`);
    }
  } else {
    await bootstrap();
  }
  startPreflightInBackground(process.cwd());
  if (currentSettings.heartbeat.enabled)
    scheduleHeartbeat();
  setInterval(async () => {
    try {
      const newSettings = await reloadSettings();
      const newJobs = await loadJobs();
      const hbChanged = newSettings.heartbeat.enabled !== currentSettings.heartbeat.enabled || newSettings.heartbeat.interval !== currentSettings.heartbeat.interval || newSettings.heartbeat.prompt !== currentSettings.heartbeat.prompt || newSettings.timezoneOffsetMinutes !== currentSettings.timezoneOffsetMinutes || newSettings.timezone !== currentSettings.timezone || JSON.stringify(newSettings.heartbeat.excludeWindows) !== JSON.stringify(currentSettings.heartbeat.excludeWindows);
      const secChanged = newSettings.security.level !== currentSettings.security.level || newSettings.security.allowedTools.join(",") !== currentSettings.security.allowedTools.join(",") || newSettings.security.disallowedTools.join(",") !== currentSettings.security.disallowedTools.join(",");
      if (secChanged) {
        console.log(`[${ts()}] Security level changed \u2192 ${newSettings.security.level}`);
      }
      if (hbChanged) {
        console.log(`[${ts()}] Config change detected \u2014 heartbeat: ${newSettings.heartbeat.enabled ? `every ${newSettings.heartbeat.interval}m` : "disabled"}`);
        currentSettings = newSettings;
        scheduleHeartbeat();
      } else {
        currentSettings = newSettings;
      }
      if (web) {
        currentSettings.web.enabled = true;
        currentSettings.web.port = web.port;
      }
      const jobNames = newJobs.map((j) => `${j.name}:${j.schedule}:${j.prompt}`).sort().join("|");
      const oldJobNames = currentJobs.map((j) => `${j.name}:${j.schedule}:${j.prompt}`).sort().join("|");
      if (jobNames !== oldJobNames) {
        console.log(`[${ts()}] Jobs reloaded: ${newJobs.length} job(s)`);
        newJobs.forEach((j) => console.log(`    - ${j.name} [${j.schedule}]`));
      }
      currentJobs = newJobs;
      await initTelegram(newSettings.telegram.token);
      await initDiscord(newSettings.discord.token);
    } catch (err) {
      console.error(`[${ts()}] Hot-reload error:`, err);
    }
  }, 30000);
  function updateState() {
    const now = new Date;
    const state = {
      heartbeat: currentSettings.heartbeat.enabled ? { nextAt: nextHeartbeatAt } : undefined,
      jobs: currentJobs.map((job) => ({
        name: job.name,
        nextAt: nextCronMatch(job.schedule, now, currentSettings.timezoneOffsetMinutes).getTime()
      })),
      security: currentSettings.security.level,
      telegram: !!currentSettings.telegram.token,
      discord: !!currentSettings.discord.token,
      startedAt: daemonStartedAt,
      web: {
        enabled: !!web,
        host: currentSettings.web.host,
        port: currentSettings.web.port
      }
    };
    writeState(state);
  }
  updateState();
  setInterval(() => {
    const now = new Date;
    for (const job of currentJobs) {
      if (cronMatches(job.schedule, now, currentSettings.timezoneOffsetMinutes)) {
        resolvePrompt(job.prompt).then((prompt) => run(job.name, prompt)).then((r) => {
          if (job.notify === false)
            return;
          if (job.notify === "error" && r.exitCode === 0)
            return;
          forwardToTelegram(job.name, r);
          forwardToDiscord(job.name, r);
        }).finally(async () => {
          if (job.recurring)
            return;
          try {
            await clearJobSchedule(job.name);
            console.log(`[${ts()}] Cleared schedule for one-time job: ${job.name}`);
          } catch (err) {
            console.error(`[${ts()}] Failed to clear schedule for ${job.name}:`, err);
          }
        });
      }
    }
    updateState();
  }, 60000);
}

// src/commands/stop.ts
import { writeFile as writeFile6, unlink as unlink4, readdir as readdir6, readFile as readFile10 } from "fs/promises";
import { join as join16 } from "path";
import { homedir as homedir4 } from "os";
var CLAUDE_DIR2 = join16(process.cwd(), ".claude");
var HEARTBEAT_DIR7 = join16(CLAUDE_DIR2, "claudeclaw");
var STATUSLINE_FILE2 = join16(CLAUDE_DIR2, "statusline.cjs");
var CLAUDE_SETTINGS_FILE2 = join16(CLAUDE_DIR2, "settings.json");
async function teardownStatusline2() {
  try {
    const settings = await Bun.file(CLAUDE_SETTINGS_FILE2).json();
    delete settings.statusLine;
    await writeFile6(CLAUDE_SETTINGS_FILE2, JSON.stringify(settings, null, 2) + `
`);
  } catch {}
  try {
    await unlink4(STATUSLINE_FILE2);
  } catch {}
}
async function stop() {
  const pidFile = getPidPath();
  let pid;
  try {
    pid = (await Bun.file(pidFile).text()).trim();
  } catch {
    console.log("No daemon is running (PID file not found).");
    process.exit(0);
  }
  try {
    process.kill(Number(pid), "SIGTERM");
    console.log(`Stopped daemon (PID ${pid}).`);
  } catch {
    console.log(`Daemon process ${pid} already dead.`);
  }
  await cleanupPidFile();
  await teardownStatusline2();
  try {
    await unlink4(join16(HEARTBEAT_DIR7, "state.json"));
  } catch {}
  process.exit(0);
}
async function stopAll() {
  const projectsDir = join16(homedir4(), ".claude", "projects");
  let dirs;
  try {
    dirs = await readdir6(projectsDir);
  } catch {
    console.log("No projects found.");
    process.exit(0);
  }
  let found = 0;
  for (const dir of dirs) {
    const projectPath = "/" + dir.slice(1).replace(/-/g, "/");
    const pidFile = join16(projectPath, ".claude", "claudeclaw", "daemon.pid");
    let pid;
    try {
      pid = (await readFile10(pidFile, "utf-8")).trim();
      process.kill(Number(pid), 0);
    } catch {
      continue;
    }
    found++;
    try {
      process.kill(Number(pid), "SIGTERM");
      console.log(`\x1B[33m\u25A0 Stopped\x1B[0m PID ${pid} \u2014 ${projectPath}`);
      try {
        await unlink4(pidFile);
      } catch {}
    } catch {
      console.log(`\x1B[31m\u2717 Failed to stop\x1B[0m PID ${pid} \u2014 ${projectPath}`);
    }
  }
  if (found === 0) {
    console.log("No running daemons found.");
  }
  process.exit(0);
}

// src/commands/clear.ts
init_sessions();
async function clear() {
  const backup = await backupSession();
  if (backup) {
    console.log(`Session backed up \u2192 ${backup}`);
  } else {
    console.log("No active session to back up.");
  }
  const pid = await checkExistingDaemon();
  if (pid) {
    console.log("Stopping daemon so next start creates a fresh session...");
    await stop();
  } else {
    console.log("No daemon running. Next start will create a new session.");
    process.exit(0);
  }
}

// src/commands/status.ts
import { join as join17 } from "path";
import { readdir as readdir7, readFile as readFile11 } from "fs/promises";
import { homedir as homedir5 } from "os";
var CLAUDE_DIR3 = join17(process.cwd(), ".claude");
var HEARTBEAT_DIR8 = join17(CLAUDE_DIR3, "claudeclaw");
var PID_FILE2 = join17(HEARTBEAT_DIR8, "daemon.pid");
var STATE_FILE2 = join17(HEARTBEAT_DIR8, "state.json");
var SETTINGS_FILE3 = join17(HEARTBEAT_DIR8, "settings.json");
var JOBS_DIR4 = join17(HEARTBEAT_DIR8, "jobs");
function formatCountdown(ms) {
  if (ms <= 0)
    return "now!";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s % 3600 / 60);
  if (h > 0)
    return `${h}h ${m}m`;
  if (m > 0)
    return `${m}m`;
  return "<1m";
}
function decodePath(encoded) {
  return "/" + encoded.slice(1).replace(/-/g, "/");
}
async function findAllDaemons() {
  const projectsDir = join17(homedir5(), ".claude", "projects");
  const results = [];
  let dirs;
  try {
    dirs = await readdir7(projectsDir);
  } catch {
    return results;
  }
  for (const dir of dirs) {
    const candidatePath = decodePath(dir);
    const pidFile = join17(candidatePath, ".claude", "claudeclaw", "daemon.pid");
    try {
      const pid = (await readFile11(pidFile, "utf-8")).trim();
      process.kill(Number(pid), 0);
      results.push({ path: candidatePath, pid });
    } catch {}
  }
  return results;
}
async function showAll() {
  const daemons = await findAllDaemons();
  if (daemons.length === 0) {
    console.log(`\x1B[31m\u25CB No running daemons found\x1B[0m`);
    return;
  }
  console.log(`Found ${daemons.length} running daemon(s):
`);
  for (const d of daemons) {
    console.log(`\x1B[32m\u25CF Running\x1B[0m PID ${d.pid} \u2014 ${d.path}`);
  }
}
async function showStatus() {
  let daemonRunning = false;
  let pid = "";
  try {
    pid = (await Bun.file(PID_FILE2).text()).trim();
    process.kill(Number(pid), 0);
    daemonRunning = true;
  } catch {}
  if (!daemonRunning) {
    console.log(`\x1B[31m\u25CB Daemon is not running\x1B[0m`);
    return false;
  }
  console.log(`\x1B[32m\u25CF Daemon is running\x1B[0m (PID ${pid})`);
  try {
    const settings = await Bun.file(SETTINGS_FILE3).json();
    const hb = settings.heartbeat;
    const timezone = typeof settings?.timezone === "string" && settings.timezone.trim() ? settings.timezone.trim() : Intl.DateTimeFormat().resolvedOptions().timeZone || "system";
    const windows = Array.isArray(hb?.excludeWindows) ? hb.excludeWindows : [];
    console.log(`  Heartbeat: ${hb.enabled ? `every ${hb.interval}m` : "disabled"}`);
    if (hb.enabled) {
      console.log(`  Heartbeat timezone: ${timezone}`);
      console.log(`  Quiet windows: ${windows.length > 0 ? windows.length : "none"}`);
    }
  } catch {}
  try {
    const files = await readdir7(JOBS_DIR4);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    if (mdFiles.length > 0) {
      console.log(`  Jobs: ${mdFiles.length}`);
      for (const f of mdFiles) {
        const content = await Bun.file(join17(JOBS_DIR4, f)).text();
        const match = content.match(/schedule:\s*["']?([^"'\n]+)/);
        const schedule = match ? match[1].trim() : "unknown";
        console.log(`    - ${f.replace(/\.md$/, "")} [${schedule}]`);
      }
    }
  } catch {}
  try {
    const state = await Bun.file(STATE_FILE2).json();
    const now = Date.now();
    console.log("");
    if (state.heartbeat) {
      console.log(`  \x1B[31m\u2665\x1B[0m Next heartbeat: ${formatCountdown(state.heartbeat.nextAt - now)}`);
    }
    for (const job of state.jobs || []) {
      console.log(`  \u2192 ${job.name}: ${formatCountdown(job.nextAt - now)}`);
    }
  } catch {}
  return true;
}
async function status(args) {
  if (args.includes("--all")) {
    await showAll();
  } else {
    await showStatus();
  }
}

// src/index.ts
init_telegram();
init_discord();

// src/commands/send.ts
init_runner();
init_sessions();
init_config();
async function send(args) {
  const telegramFlag = args.includes("--telegram");
  const discordFlag = args.includes("--discord");
  const message = args.filter((a) => a !== "--telegram" && a !== "--discord").join(" ");
  if (!message) {
    console.error("Usage: claudeclaw send <message> [--telegram] [--discord]");
    process.exit(1);
  }
  await initConfig();
  await loadSettings();
  const session = await getSession();
  if (!session) {
    console.error("No active session. Start the daemon first.");
    process.exit(1);
  }
  const result = await runUserMessage("send", message);
  console.log(result.stdout);
  if (telegramFlag) {
    const settings = await loadSettings();
    const token = settings.telegram.token;
    const userIds = settings.telegram.allowedUserIds;
    if (!token || userIds.length === 0) {
      console.error("Telegram is not configured in settings.");
      process.exit(1);
    }
    const text = result.exitCode === 0 ? result.stdout || "(empty)" : `error (exit ${result.exitCode}): ${result.stderr || "Unknown"}`;
    for (const userId of userIds) {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: userId, text })
      });
      if (!res.ok) {
        console.error(`Failed to send to Telegram user ${userId}: ${res.statusText}`);
      }
    }
    console.log("Sent to Telegram.");
  }
  if (discordFlag) {
    const settings = await loadSettings();
    const dToken = settings.discord.token;
    const dUserIds = settings.discord.allowedUserIds;
    if (!dToken || dUserIds.length === 0) {
      console.error("Discord is not configured in settings.");
      process.exit(1);
    }
    const dText = result.exitCode === 0 ? result.stdout || "(empty)" : `error (exit ${result.exitCode}): ${result.stderr || "Unknown"}`;
    for (const userId of dUserIds) {
      const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
        method: "POST",
        headers: {
          Authorization: `Bot ${dToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ recipient_id: userId })
      });
      if (!dmRes.ok) {
        console.error(`Failed to create DM for Discord user ${userId}: ${dmRes.statusText}`);
        continue;
      }
      const { id: channelId } = await dmRes.json();
      const msgRes = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bot ${dToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ content: dText.slice(0, 2000) })
      });
      if (!msgRes.ok) {
        console.error(`Failed to send to Discord user ${userId}: ${msgRes.statusText}`);
      }
    }
    console.log("Sent to Discord.");
  }
  if (result.exitCode !== 0)
    process.exit(result.exitCode);
}

// src/index.ts
var args = process.argv.slice(2);
var command = args[0];
if (command === "--stop-all") {
  stopAll();
} else if (command === "--stop") {
  stop();
} else if (command === "--clear") {
  clear();
} else if (command === "start") {
  start(args.slice(1));
} else if (command === "status") {
  status(args.slice(1));
} else if (command === "telegram") {
  telegram();
} else if (command === "discord") {
  discord();
} else if (command === "send") {
  send(args.slice(1));
} else {
  start();
}
