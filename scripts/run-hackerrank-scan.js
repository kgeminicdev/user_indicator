// Standalone runner for the HackerRank leaderboard scan.
//
// Runs the same /api/hackerrank/scan endpoint the HackerRank tab uses, but
// as a plain long-running process instead of a browser tab — so a full
// leaderboard scan keeps going without a browser open. Mirrors
// scripts/run-github-search.js.
//
// A scan covers every page of the given skill's leaderboard — the total
// page count is read from the API itself (its own reported total user
// count), not something you pick.
//
// Requires the Next.js server (dev or start) already running.
//
// Usage:
//   node scripts/run-hackerrank-scan.js --skill python
//   node scripts/run-hackerrank-scan.js --resumeId 3
//   node scripts/run-hackerrank-scan.js --skill python --base-url http://localhost:3000

const GENERIC_RETRY_BASE_MS = 30000;
const GENERIC_RETRY_MAX_MS = 120000;

// Tracked so Ctrl+C can print exactly where the scan stopped.
let currentScanId = null;
let lastProgress = null;
let baseUrlForStatus = "";

function printStatus(reason) {
  console.log(`\n\n[stopped] ${reason}`);
  if (currentScanId == null) {
    console.log("No scan has been started yet — nothing to resume.");
    return;
  }
  console.log(`Scan #${currentScanId} — last known progress:`);
  console.log(lastProgress ? JSON.stringify(lastProgress, null, 2) : "(no progress event received yet)");
  console.log(
    `\nProgress is checkpointed in the database. Resume with:\n  node scripts/run-hackerrank-scan.js --resumeId ${currentScanId}` +
      (baseUrlForStatus && baseUrlForStatus !== "http://localhost:3000"
        ? ` --base-url ${baseUrlForStatus}`
        : "")
  );
}

process.on("SIGINT", () => {
  printStatus("interrupted (Ctrl+C)");
  process.exit(0);
});
process.on("SIGTERM", () => {
  printStatus("terminated");
  process.exit(0);
});

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true; // boolean flag
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOnce(baseUrl, params) {
  const url = `${baseUrl}/api/hackerrank/scan?${params}`;
  console.log(`\n→ GET ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIndex;
    while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);

      let event = "message";
      let data = "";
      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data = line.slice(6);
      }
      if (!data) continue;
      const parsed = JSON.parse(data);

      if (event === "progress") {
        lastProgress = parsed;
        if (parsed.scanId != null) currentScanId = parsed.scanId;
        console.log(`[progress] ${JSON.stringify(parsed)}`);
      } else if (event === "done") {
        lastProgress = parsed;
        if (parsed.scanId != null) currentScanId = parsed.scanId;
        console.log(`[done] ${JSON.stringify(parsed, null, 2)}`);
        return { type: "done", data: parsed };
      } else if (event === "error") {
        if (parsed.scanId != null) currentScanId = parsed.scanId;
        return { type: "error", data: parsed };
      }
    }
  }

  return { type: "error", data: { message: "Stream ended without a done/error event" } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = (args["base-url"] || "http://localhost:3000").replace(/\/$/, "");
  baseUrlForStatus = baseUrl;

  let params;
  if (args.resumeId) {
    currentScanId = Number(args.resumeId);
    params = new URLSearchParams({ resumeId: String(args.resumeId) });
  } else {
    if (!args.skill) {
      console.error("Usage: node scripts/run-hackerrank-scan.js --skill python");
      process.exit(1);
    }
    params = new URLSearchParams({ skill: String(args.skill) });
  }

  let attempt = 0;

  for (;;) {
    let result;
    try {
      result = await runOnce(baseUrl, params);
    } catch (err) {
      // A raw network error (e.g. Node's fetch throwing "terminated" when
      // the dev server hot-reloads and drops the SSE connection mid-stream)
      // carries no scanId of its own — fall back to the last one we saw
      // from a progress event so auto-resume still works.
      result = { type: "error", data: { message: err.message, scanId: currentScanId } };
    }

    if (result.type === "done") {
      console.log("\nScan complete.");
      process.exit(0);
    }

    const { scanId, message } = result.data;
    console.error(`\n[error] ${message || "unknown error"}`);

    if (scanId == null) {
      console.error("No scanId to resume from — cannot continue automatically. Exiting.");
      process.exit(1);
    }

    attempt++;
    const delayMs = Math.min(GENERIC_RETRY_BASE_MS * attempt, GENERIC_RETRY_MAX_MS);

    const resumeAt = new Date(Date.now() + delayMs);
    console.log(
      `Resuming scan #${scanId} at ${resumeAt.toLocaleTimeString()} (attempt ${attempt})...`
    );
    await sleep(delayMs);
    params = new URLSearchParams({ resumeId: String(scanId) });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
