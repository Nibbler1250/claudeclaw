import { spawn as nodeSpawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { getSession, createSession, resetSession, incrementTurn, markCompactWarned } from "./sessions";
import {
  getThreadSession,
  createThreadSession,
  removeThreadSession,
  incrementThreadTurn,
  markThreadCompactWarned,
} from "./sessionManager";
import { getSettings, type ModelConfig, type SecurityConfig } from "./config";
import { buildClockPromptPrefix } from "./timezone";
import { selectModel } from "./model-router";

const LOGS_DIR = join(process.cwd(), ".claude/claudeclaw/logs");
// Resolve prompts relative to the claudeclaw installation, not the project dir
const PROMPTS_DIR = join(import.meta.dir, "..", "prompts");
const HEARTBEAT_PROMPT_FILE = join(PROMPTS_DIR, "heartbeat", "HEARTBEAT.md");
// Project-level prompt overrides live here (gitignored, user-owned)
const PROJECT_PROMPTS_DIR = join(process.cwd(), ".claude", "claudeclaw", "prompts");
const PROJECT_CLAUDE_MD = join(process.cwd(), "CLAUDE.md");
const LEGACY_PROJECT_CLAUDE_MD = join(process.cwd(), ".claude", "CLAUDE.md");
const CLAUDECLAW_BLOCK_START = "<!-- claudeclaw:managed:start -->";
const CLAUDECLAW_BLOCK_END = "<!-- claudeclaw:managed:end -->";

/**
 * Compact configuration.
 * COMPACT_WARN_THRESHOLD: notify user that context is getting large.
 * COMPACT_TIMEOUT_ENABLED: whether to auto-compact on timeout (exit 124).
 */
const COMPACT_WARN_THRESHOLD = 25;
const COMPACT_TIMEOUT_ENABLED = true;

export type CompactEvent =
  | { type: "warn"; turnCount: number }
  | { type: "auto-compact-start" }
  | { type: "auto-compact-done"; success: boolean }
  | { type: "auto-compact-retry"; success: boolean; stdout: string; stderr: string; exitCode: number };

type CompactEventListener = (event: CompactEvent) => void;
const compactListeners: CompactEventListener[] = [];

/** Register a listener for compact-related events (warnings, auto-compact notifications). */
export function onCompactEvent(listener: CompactEventListener): void {
  compactListeners.push(listener);
}

function emitCompactEvent(event: CompactEvent): void {
  for (const listener of compactListeners) {
    try { listener(event); } catch {}
  }
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const RATE_LIMIT_PATTERN = /you.ve hit your limit|out of extra usage/i;

// Serial queue — prevents concurrent --resume on the same session
// Global queue for non-thread messages (backward compatible)
let globalQueue: Promise<unknown> = Promise.resolve();
// Per-thread queues — each thread runs independently in parallel
const threadQueues = new Map<string, Promise<unknown>>();

function enqueue<T>(fn: () => Promise<T>, threadId?: string): Promise<T> {
  if (threadId) {
    const current = threadQueues.get(threadId) ?? Promise.resolve();
    const task = current.then(fn, fn);
    threadQueues.set(threadId, task.catch(() => {}));
    return task;
  }
  const task = globalQueue.then(fn, fn);
  globalQueue = task.catch(() => {});
  return task;
}

function extractRateLimitMessage(stdout: string, stderr: string): string | null {
  const candidates = [stdout, stderr];
  for (const text of candidates) {
    const trimmed = text.trim();
    if (trimmed && RATE_LIMIT_PATTERN.test(trimmed)) return trimmed;
  }
  return null;
}

function sameModelConfig(a: ModelConfig, b: ModelConfig): boolean {
  return a.model.trim().toLowerCase() === b.model.trim().toLowerCase() && a.api.trim() === b.api.trim();
}

function hasModelConfig(value: ModelConfig): boolean {
  return value.model.trim().length > 0 || value.api.trim().length > 0;
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "ENOENT") return true;
  const message = String((error as { message?: unknown }).message ?? "");
  return /enoent|no such file or directory/i.test(message);
}

function buildChildEnv(baseEnv: Record<string, string>, model: string, api: string): Record<string, string> {
  const childEnv: Record<string, string> = { ...baseEnv };
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

/** Default timeout for a single Claude Code invocation (5 minutes). */
const CLAUDE_TIMEOUT_MS = 5 * 60 * 1000;

async function runClaudeOnce(
  baseArgs: string[],
  model: string,
  api: string,
  baseEnv: Record<string, string>,
  timeoutMs: number = CLAUDE_TIMEOUT_MS
): Promise<{ rawStdout: string; stderr: string; exitCode: number }> {
  const args = [...baseArgs];
  const normalizedModel = model.trim().toLowerCase();
  if (model.trim() && normalizedModel !== "glm") args.push("--model", model.trim());

  console.log(`[SPAWN-NODE] args count: ${args.length}, append-prompt-len: ${args[args.indexOf("--append-system-prompt")+1]?.length || 0}`);
  const childEnv = buildChildEnv(baseEnv, model, api);
  const [cmd, ...spawnArgs] = args;

  // VERBOSE DIAG
  const diagId = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const diagFile = join(LOGS_DIR, `diag-${diagId}.log`);
  const diagLines: string[] = [];
  const diag = (msg: string) => {
    diagLines.push(`[${new Date().toISOString()}] ${msg}`);
  };
  diag(`cmd=${args[0]} argc=${args.length} cwd=${process.cwd()}`);
  const resumeIdx = args.indexOf("--resume");
  if (resumeIdx >= 0) diag(`resume=${args[resumeIdx + 1]}`);
  diag(`model=${model} hasAuth=${!!childEnv.ANTHROPIC_AUTH_TOKEN || !!childEnv.CLAUDE_CODE_OAUTH_TOKEN} baseUrl=${childEnv.ANTHROPIC_BASE_URL || "default"}`);

  return new Promise((resolve) => {
    const startMs = Date.now();
    const proc = nodeSpawn(cmd, spawnArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
    });
    diag(`spawned pid=${proc.pid}`);

    let rawStdout = "";
    let stderr = "";
    let settled = false;

    proc.stdout!.on("data", (chunk: Buffer) => { rawStdout += chunk.toString(); });
    proc.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { proc.kill("SIGTERM"); } catch {}
        setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 5000);
        diag(`TIMEOUT after ${timeoutMs/1000}s`);
        writeFile(diagFile, diagLines.join("\n") + "\n").catch(() => {});
        console.error(`[${new Date().toLocaleTimeString()}] Claude session timed out after ${timeoutMs / 1000}s`);
        resolve({ rawStdout: "", stderr: "timeout", exitCode: 124 });
      }
    }, timeoutMs);

    proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const finalCode = code ?? 1;
        const elapsed = Date.now() - startMs;
        diag(`close code=${finalCode} signal=${signal} elapsed=${elapsed}ms stdout.len=${rawStdout.length} stderr.len=${stderr.length}`);
        diag(`stdout.first300=${JSON.stringify(rawStdout.slice(0, 300))}`);
        diag(`stderr.full=${JSON.stringify(stderr)}`);
        if (finalCode !== 0 || rawStdout.length === 0) {
          writeFile(diagFile, diagLines.join("\n") + "\n").catch(() => {});
        }
        console.log(`[${new Date().toLocaleTimeString()}] node-spawn exit=${finalCode}, stdout=${rawStdout.length}, stderr=${stderr.slice(0,500)}, diag=${finalCode !== 0 ? diagId : "ok"}`);
        resolve({ rawStdout, stderr, exitCode: finalCode });
      }
    });

    proc.on("error", (err: Error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        console.error(`[${new Date().toLocaleTimeString()}] spawn error: ${err.message}`);
        resolve({ rawStdout: "", stderr: err.message, exitCode: 124 });
      }
    });
  });
}

const PROJECT_DIR = process.cwd();

const DIR_SCOPE_PROMPT = [
  `CRITICAL SECURITY CONSTRAINT: You are scoped to the project directory: ${PROJECT_DIR}`,
  "You MUST NOT read, write, edit, or delete any file outside this directory.",
  "You MUST NOT run bash commands that modify anything outside this directory (no cd /, no /etc, no ~/, no ../.. escapes).",
  "If a request requires accessing files outside the project, refuse and explain why.",
].join("\n");

export async function ensureProjectClaudeMd(): Promise<void> {
  // Preflight-only initialization: never rewrite an existing project CLAUDE.md.
  if (existsSync(PROJECT_CLAUDE_MD)) return;

  const promptContent = (await loadPrompts()).trim();
  const managedBlock = [
    CLAUDECLAW_BLOCK_START,
    promptContent,
    CLAUDECLAW_BLOCK_END,
  ].join("\n");

  let content = "";

  if (existsSync(LEGACY_PROJECT_CLAUDE_MD)) {
    try {
      const legacy = await readFile(LEGACY_PROJECT_CLAUDE_MD, "utf8");
      content = legacy.trim();
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] Failed to read legacy .claude/CLAUDE.md:`, e);
      return;
    }
  }

  const normalized = content.trim();
  const hasManagedBlock =
    normalized.includes(CLAUDECLAW_BLOCK_START) && normalized.includes(CLAUDECLAW_BLOCK_END);
  const managedPattern = new RegExp(
    `${CLAUDECLAW_BLOCK_START}[\\s\\S]*?${CLAUDECLAW_BLOCK_END}`,
    "m"
  );

  const merged = hasManagedBlock
    ? `${normalized.replace(managedPattern, managedBlock)}\n`
    : normalized
      ? `${normalized}\n\n${managedBlock}\n`
      : `${managedBlock}\n`;

  try {
    await writeFile(PROJECT_CLAUDE_MD, merged, "utf8");
  } catch (e) {
    console.error(`[${new Date().toLocaleTimeString()}] Failed to write project CLAUDE.md:`, e);
  }
}

function buildSecurityArgs(security: SecurityConfig): string[] {
  const args: string[] = ["--dangerously-skip-permissions"];

  switch (security.level) {
    case "locked":
      args.push("--tools", "Read,Grep,Glob");
      break;
    case "strict":
      args.push("--disallowedTools", "Bash,WebSearch,WebFetch");
      break;
    case "moderate":
      // all tools available, scoped to project dir via system prompt
      break;
    case "unrestricted":
      // all tools, no directory restriction
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

/** Load and concatenate all prompt files from the prompts/ directory. */
async function loadPrompts(): Promise<string> {
  const selectedPromptFiles = [
    join(PROMPTS_DIR, "IDENTITY.md"),
    join(PROMPTS_DIR, "USER.md"),
    join(PROMPTS_DIR, "SOUL.md"),
  ];
  const parts: string[] = [];

  for (const file of selectedPromptFiles) {
    try {
      const content = await Bun.file(file).text();
      if (content.trim()) parts.push(content.trim());
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] Failed to read prompt file ${file}:`, e);
    }
  }

  return parts.join("\n\n");
}

/**
 * Load the heartbeat prompt template.
 * Project-level override takes precedence: place a file at
 * .claude/claudeclaw/prompts/HEARTBEAT.md to fully replace the built-in template.
 */
export async function loadHeartbeatPromptTemplate(): Promise<string> {
  const projectOverride = join(PROJECT_PROMPTS_DIR, "HEARTBEAT.md");
  for (const file of [projectOverride, HEARTBEAT_PROMPT_FILE]) {
    try {
      const content = await Bun.file(file).text();
      if (content.trim()) return content.trim();
    } catch (e) {
      if (!isNotFoundError(e)) {
        console.warn(`[${new Date().toLocaleTimeString()}] Failed to read heartbeat prompt file ${file}:`, e);
      }
    }
  }
  return "";
}

/** Run /compact on the current session to reduce context size. */
export async function runCompact(
  sessionId: string,
  model: string,
  api: string,
  baseEnv: Record<string, string>,
  securityArgs: string[],
  timeoutMs: number
): Promise<boolean> {
  const compactArgs = [
    "claude", "-p", "/compact",
    "--output-format", "text",
    "--resume", sessionId,
    ...securityArgs,
  ];
  console.log(`[${new Date().toLocaleTimeString()}] Running /compact on session ${sessionId.slice(0, 8)}...`);
  const result = await runClaudeOnce(compactArgs, model, api, baseEnv, timeoutMs);
  const success = result.exitCode === 0;
  console.log(`[${new Date().toLocaleTimeString()}] Compact ${success ? "succeeded" : `failed (exit ${result.exitCode})`}`);
  return success;
}

/**
 * High-level compact: resolves session + settings internally.
 * Returns { success, message }.
 */
export async function compactCurrentSession(): Promise<{ success: boolean; message: string }> {
  const existing = await getSession();
  if (!existing) return { success: false, message: "No active session to compact." };

  const settings = getSettings();
  const securityArgs = buildSecurityArgs(settings.security);
  const { CLAUDECODE: _, ...cleanEnv } = process.env;
  const baseEnv = { ...cleanEnv } as Record<string, string>;
  const timeoutMs = (settings as any).sessionTimeoutMs || CLAUDE_TIMEOUT_MS;

  const ok = await runCompact(
    existing.sessionId,
    settings.model,
    settings.api,
    baseEnv,
    securityArgs,
    timeoutMs
  );

  return ok
    ? { success: true, message: `✅ Session compact complete (${existing.sessionId.slice(0, 8)})` }
    : { success: false, message: `❌ Compact failed (${existing.sessionId.slice(0, 8)})` };
}

async function execClaude(name: string, prompt: string, threadId?: string): Promise<RunResult> {
  await mkdir(LOGS_DIR, { recursive: true });

  const existing = threadId
    ? await getThreadSession(threadId)
    : await getSession();
  const isNew = !existing;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = join(LOGS_DIR, `${name}-${timestamp}.log`);

  const settings = getSettings();
  const { security, model, api, fallback, agentic } = settings;

  // Determine which model to use based on agentic routing
  let primaryConfig: ModelConfig;
  let taskType = "unknown";
  let routingReasoning = "";

  if (agentic.enabled) {
    const routing = selectModel(prompt, agentic.modes, agentic.defaultMode);
    primaryConfig = { model: routing.model, api };
    taskType = routing.taskType;
    routingReasoning = routing.reasoning;
    console.log(
      `[${new Date().toLocaleTimeString()}] Agentic routing: ${routing.taskType} → ${routing.model} (${routing.reasoning})`
    );
  } else {
    primaryConfig = { model, api };
  }

  const fallbackConfig: ModelConfig = {
    model: fallback?.model ?? "",
    api: fallback?.api ?? "",
  };
  const securityArgs = buildSecurityArgs(security);
  const timeoutMs = (settings as any).sessionTimeoutMs || CLAUDE_TIMEOUT_MS;

  console.log(
    `[${new Date().toLocaleTimeString()}] Running: ${name} (${isNew ? "new session" : `resume ${existing.sessionId.slice(0, 8)}`}, security: ${security.level})`
  );

  // New session: use json output to capture Claude's session_id
  // Resumed session: use text output with --resume
  const outputFormat = "json";
  const args = ["claude", "-p", prompt, "--output-format", outputFormat, ...securityArgs];

  if (!isNew) {
    args.push("--resume", existing.sessionId);
  }

  // Build the appended system prompt: prompt files + directory scoping
  // This is passed on EVERY invocation (not just new sessions) because
  // --append-system-prompt does not persist across --resume.
  const promptContent = await loadPrompts();
  const appendParts: string[] = [
    "You are running inside ClaudeClaw.",
  ];
  if (promptContent) appendParts.push(promptContent);

  // Load the project's CLAUDE.md if it exists
  if (existsSync(PROJECT_CLAUDE_MD)) {
    try {
      const claudeMd = await Bun.file(PROJECT_CLAUDE_MD).text();
      if (claudeMd.trim()) appendParts.push(claudeMd.trim());
    } catch (e) {
      console.error(`[${new Date().toLocaleTimeString()}] Failed to read project CLAUDE.md:`, e);
    }
  }

  if (security.level !== "unrestricted") appendParts.push(DIR_SCOPE_PROMPT);
  if (appendParts.length > 0) {
    args.push("--append-system-prompt", appendParts.join("\n\n"));
  }

  // Strip CLAUDECODE env var so child claude processes don't think they're nested
  const { CLAUDECODE: _, ...cleanEnv } = process.env;
  const baseEnv = { ...cleanEnv } as Record<string, string>;

  let exec = await runClaudeOnce(args, primaryConfig.model, primaryConfig.api, baseEnv, timeoutMs);
  const primaryRateLimit = extractRateLimitMessage(exec.rawStdout, exec.stderr);
  let usedFallback = false;

  if (primaryRateLimit && hasModelConfig(fallbackConfig) && !sameModelConfig(primaryConfig, fallbackConfig)) {
    console.warn(
      `[${new Date().toLocaleTimeString()}] Claude limit reached; retrying with fallback${fallbackConfig.model ? ` (${fallbackConfig.model})` : ""}...`
    );
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

  // For new sessions, parse the JSON to extract session_id and result text.
  // Also attempt JSON parse if exitCode != 0 but output looks like a successful JSON result —
  // guards against Bun race condition where proc.exitCode reads as null → 1 even on success.
  const looksLikeJsonResult = rawStdout.trimStart().startsWith("{") && rawStdout.includes('"session_id"');
  if (!rateLimitMessage && (exitCode === 0 || looksLikeJsonResult)) {
    try {
      const json = JSON.parse(rawStdout);
      if (json.session_id) {
        sessionId = json.session_id;
        stdout = json.result ?? "";
        // If JSON parse succeeded and is_error is false, treat as success regardless of exitCode
        if (!json.is_error) {
          exitCode = 0;
        }
        // Save the real session ID from Claude Code
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

  // Guard against Bun proc.exitCode race condition: if claude produced output
  // and no stderr, treat as success even if Bun reported exit code 1.
  if (exitCode !== 0 && stdout.trim() && !stderr.trim() && !rateLimitMessage) {
    console.log(`[${new Date().toLocaleTimeString()}] Overriding exit code ${exitCode} → 0 (stdout present, no stderr)`);
    exitCode = 0;
  }

  const result: RunResult = {
    stdout,
    stderr,
    exitCode,
  };

  const output = [
    `# ${name}`,
    `Date: ${new Date().toISOString()}`,
    `Session: ${sessionId} (${isNew ? "new" : "resumed"})`,
    `Model config: ${usedFallback ? "fallback" : "primary"}`,
    ...(agentic.enabled ? [`Task type: ${taskType}`, `Routing: ${routingReasoning}`] : []),
    `Prompt: ${prompt}`,
    `Exit code: ${result.exitCode}`,
    "",
    "## Output",
    stdout,
    ...(stderr ? ["## Stderr", stderr] : []),
  ].join("\n");

  await Bun.write(logFile, output);
  console.log(`[${new Date().toLocaleTimeString()}] Done: ${name} → ${logFile}`);

  // --- Auto-recovery: if resume failed (exit != 0, no output), nuke session & retry as new ---
  console.log(`[${new Date().toLocaleTimeString()}] Post-run: isNew=${isNew}, exitCode=${exitCode}, stdoutLen=${stdout.length}, stdoutTrimmed="${stdout.trim().slice(0, 50)}", stderrLen=${stderr.length}`);
  if (!isNew && exitCode !== 0 && !stdout.trim()) {
    console.log(`[${new Date().toLocaleTimeString()}] Resume failed (exit ${exitCode}, no output) — nuking session and retrying as new`);
    if (threadId) {
      await removeThreadSession(threadId);
    } else {
      await resetSession();
    }
    // Rebuild args for a fresh session (json output, no --resume)
    const freshArgs = ["claude", "-p", prompt, "--output-format", "json", ...securityArgs];
    if (appendParts.length > 0) {
      freshArgs.push("--append-system-prompt", appendParts.join("\n\n"));
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
          if (!json.is_error) freshExitCode = 0;
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

  // --- Auto-compact on timeout (exit 124) ---
  if (COMPACT_TIMEOUT_ENABLED && exitCode === 124 && !isNew && existing) {
    emitCompactEvent({ type: "auto-compact-start" });
    const compactOk = await runCompact(
      existing.sessionId,
      primaryConfig.model,
      primaryConfig.api,
      baseEnv,
      securityArgs,
      timeoutMs
    );
    emitCompactEvent({ type: "auto-compact-done", success: compactOk });

    if (compactOk) {
      console.log(`[${new Date().toLocaleTimeString()}] Retrying ${name} after compact...`);
      const retryExec = await runClaudeOnce(args, primaryConfig.model, primaryConfig.api, baseEnv, timeoutMs);
      const retryResult: RunResult = {
        stdout: retryExec.rawStdout,
        stderr: retryExec.stderr,
        exitCode: retryExec.exitCode,
      };
      emitCompactEvent({
        type: "auto-compact-retry",
        success: retryExec.exitCode === 0,
        stdout: retryResult.stdout,
        stderr: retryResult.stderr,
        exitCode: retryResult.exitCode,
      });

      if (retryExec.exitCode === 0) {
        const count = threadId ? await incrementThreadTurn(threadId) : await incrementTurn();
        console.log(`[${new Date().toLocaleTimeString()}] Turn count: ${count} (after compact + retry)`);
      }
      return retryResult;
    }
  }

  // --- Turn tracking & compact warning ---
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

export async function run(name: string, prompt: string, threadId?: string): Promise<RunResult> {
  return enqueue(() => execClaude(name, prompt, threadId), threadId);
}

async function streamClaude(
  name: string,
  prompt: string,
  onChunk: (text: string) => void,
  onUnblock: () => void
): Promise<void> {
  await mkdir(LOGS_DIR, { recursive: true });

  const existing = await getSession();
  const { security, model, api } = getSettings();
  const securityArgs = buildSecurityArgs(security);

  // stream-json gives us events as they happen — text before tool calls,
  // so we can unblock the UI as soon as Claude acknowledges, not after sub-agents finish.
  // --verbose is required for stream-json to produce output in -p (print) mode.
  const args = ["claude", "-p", prompt, "--output-format", "stream-json", "--verbose", ...securityArgs];

  if (existing) args.push("--resume", existing.sessionId);

  const promptContent = await loadPrompts();
  const appendParts: string[] = ["You are running inside ClaudeClaw."];
  if (promptContent) appendParts.push(promptContent);

  if (existsSync(PROJECT_CLAUDE_MD)) {
    try {
      const claudeMd = await Bun.file(PROJECT_CLAUDE_MD).text();
      if (claudeMd.trim()) appendParts.push(claudeMd.trim());
    } catch {}
  }

  if (security.level !== "unrestricted") appendParts.push(DIR_SCOPE_PROMPT);
  if (appendParts.length > 0) {
    args.push("--append-system-prompt", appendParts.join("\n\n"));
  }

  const normalizedModel = model.trim().toLowerCase();
  if (model.trim() && normalizedModel !== "glm") args.push("--model", model.trim());

  const { CLAUDECODE: _, ...cleanEnv } = process.env;
  const childEnv = buildChildEnv(cleanEnv as Record<string, string>, model, api);

  console.log(`[${new Date().toLocaleTimeString()}] Running: ${name} (stream-json, session: ${existing?.sessionId?.slice(0, 8) ?? "new"})`);

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
    env: childEnv,
  });

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
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
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // Parse complete newline-delimited JSON events
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;

        if (event.type === "system" && (event.subtype === "init" || event.session_id)) {
          // Capture session ID for new sessions
          const sid = event.session_id as string | undefined;
          if (sid && !existing) {
            await createSession(sid);
            console.log(`[${new Date().toLocaleTimeString()}] Session created (stream-json): ${sid}`);
          }
        } else if (event.type === "assistant") {
          // Text and tool_use blocks from the assistant
          type ContentBlock = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> };
          const msg = event.message as { content?: ContentBlock[] } | undefined;
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
          if (hasActivity) maybeUnblock();
        } else if (event.type === "tool_use") {
          // Top-level tool_use event (some stream-json versions) — unblock the UI
          maybeUnblock();
        } else if (event.type === "result") {
          // Final result event — emit text as fallback if no assistant text was seen
          const resultText = (event as Record<string, unknown>).result as string | undefined;
          if (resultText && !textEmitted) {
            onChunk(resultText);
          }
          maybeUnblock();
        }
      } catch {}
    }
  }

  await proc.exited;
  // Ensure unblock fires even if something unexpected happened
  maybeUnblock();

  console.log(`[${new Date().toLocaleTimeString()}] Done: ${name}`);
}

export async function streamUserMessage(
  name: string,
  prompt: string,
  onChunk: (text: string) => void,
  onUnblock: () => void
): Promise<void> {
  return enqueue(() => streamClaude(name, prefixUserMessageWithClock(prompt), onChunk, onUnblock));
}

function prefixUserMessageWithClock(prompt: string): string {
  try {
    const settings = getSettings();
    const prefix = buildClockPromptPrefix(new Date(), settings.timezoneOffsetMinutes);
    return `${prefix}\n${prompt}`;
  } catch {
    const prefix = buildClockPromptPrefix(new Date(), 0);
    return `${prefix}\n${prompt}`;
  }
}

export async function runUserMessage(name: string, prompt: string, threadId?: string): Promise<RunResult> {
  return run(name, prefixUserMessageWithClock(prompt), threadId);
}

/**
 * Bootstrap the session: fires Claude with the system prompt so the
 * session is created immediately. No-op if a session already exists.
 */
export async function bootstrap(): Promise<void> {
  const existing = await getSession();
  if (existing) return;

  console.log(`[${new Date().toLocaleTimeString()}] Bootstrapping new session...`);
  await execClaude("bootstrap", "Wakeup, my friend!");
  console.log(`[${new Date().toLocaleTimeString()}] Bootstrap complete — session is live.`);
}
