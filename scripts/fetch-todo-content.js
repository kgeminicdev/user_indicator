// Backfills content for To Do entries that were added without it — Add to
// To Do skips the slow LinkedIn/Vee profile fetch so it stays instant; this
// script (meant to run periodically, e.g. every 30 minutes) fills in the
// content for whatever's still missing it.
//
// Requires the Next.js server (dev or start) already running.
//
// Usage:
//   node scripts/fetch-todo-content.js
//   node scripts/fetch-todo-content.js --base-url http://localhost:3000
//
// To run it every 30 minutes on Windows, register it once with:
//   schtasks /create /tn "TodoContentRefill" /sc minute /mo 30 ^
//     /tr "node E:\Work\user_indicator\scripts\fetch-todo-content.js"

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

  console.log(`\n→ POST ${baseUrl}/api/todo-entries/fetch-content`);
  const res = await fetch(`${baseUrl}/api/todo-entries/fetch-content`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`Request failed (${res.status}):`, body.error || body);
    process.exit(1);
  }

  console.log(
    `Processed ${body.processed}, updated ${body.updated}, failed ${body.failed}.`
  );
  if (body.failures?.length > 0) {
    console.log("Failures:");
    for (const f of body.failures) console.log(`  - ${f}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
