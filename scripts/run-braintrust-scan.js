// Standalone runner for the Braintrust ID-range scan — the same
// /api/todo/scan endpoint the Braintrust tab's "Scan range" button uses,
// runnable from the command line instead of the browser.
//
// This endpoint isn't streamed/resumable like the GitHub and HackerRank
// scans — it checks the whole range in one request and returns a summary,
// so this script is just a thin wrapper around that one call.
//
// Requires the Next.js server (dev or start) already running.
//
// Usage:
//   node scripts/run-braintrust-scan.js --startId 100 --endId 200
//   node scripts/run-braintrust-scan.js --startId 100 --endId 200 --base-url http://localhost:3000

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const key = raw.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = (args["base-url"] || "http://localhost:3000").replace(/\/$/, "");

  const startId = Number(args.startId);
  const endId = Number(args.endId);
  if (!Number.isFinite(startId) || !Number.isFinite(endId) || startId > endId) {
    console.error(
      "Usage: node scripts/run-braintrust-scan.js --startId 100 --endId 200"
    );
    process.exit(1);
  }

  console.log(`\n→ POST ${baseUrl}/api/todo/scan  (startId=${startId}, endId=${endId})`);
  console.log("Working — this can take a while for wider ranges (checks GitHub for missing emails)...");

  const res = await fetch(`${baseUrl}/api/todo/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startId, endId }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`Request failed (${res.status}):`, body.error || body);
    process.exit(1);
  }

  console.log(`\nResults for ${startId}–${endId}:`);
  console.log(`  Matches condition: ${body.scanned}`);
  console.log(`  Already found:     ${body.alreadyMatched}`);
  console.log(`  Newly queued:      ${body.newlyQueued}`);
  console.log(`  Already queued:    ${body.alreadyQueued}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
