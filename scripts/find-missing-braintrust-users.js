const { Pool } = require("pg");

const userIndicatorPool = new Pool({ connectionString: process.env.DATABASE_URL });
const braintrustPool = new Pool({ connectionString: process.env.BRAINTRUST_DATABASE_URL });

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const NOREPLY_DOMAIN = "users.noreply.github.com";
const BOT_NOREPLY_EMAIL = "noreply@github.com";
const TEST_LIMIT = parseInt(process.argv[2] || "10", 10);

function isRealEmail(email) {
  return Boolean(email) && !email.endsWith(NOREPLY_DOMAIN) && email !== BOT_NOREPLY_EMAIL;
}

async function fetchJson(url) {
  const headers = GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {};
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function extractGithubUsername(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("github.com")) return null;
    const [username] = parsed.pathname.split("/").filter(Boolean);
    return username || null;
  } catch {
    return null;
  }
}

async function findRealCommitterEmail(username) {
  const repos = await fetchJson(
    `https://api.github.com/users/${username}/repos?sort=pushed&direction=desc&per_page=100`
  );
  if (!Array.isArray(repos) || repos.length === 0) return null;

  for (const repo of repos.slice(0, 10)) {
    const commits = await fetchJson(
      `https://api.github.com/repos/${repo.full_name}/commits?author=${username}&per_page=30`
    ).catch(() => []);
    for (const commit of commits) {
      const email = commit.commit.committer.email;
      if (isRealEmail(email)) return email;
    }
  }
  return null;
}

async function main() {
  const { rows: candidates } = await braintrustPool.query(
    `
      SELECT id, "publicName", data->'external_profiles' AS "externalProfiles"
      FROM "Freelancer"
      WHERE title = 'Engineering' AND jsonb_array_length(data->'external_profiles') > 0
      ORDER BY "syncedAt" DESC
      LIMIT $1
    `,
    [TEST_LIMIT]
  );

  const { rows: existing } = await userIndicatorPool.query(
    `SELECT id, name, email, link FROM records`
  );
  const existingLinks = new Set(existing.map((r) => r.link).filter(Boolean));
  const existingEmails = new Set(
    existing.map((r) => (r.email || "").toLowerCase()).filter(Boolean)
  );

  const results = [];
  for (const candidate of candidates) {
    const profiles = candidate.externalProfiles || [];
    const github = profiles.find((p) => p.site?.name === "GitHub");
    const linkedin = profiles.find((p) => p.site?.name === "LinkedIn");

    let matched = false;
    let matchedBy = null;
    let derivedEmail = null;
    let githubLookupError = null;

    if (github && existingLinks.has(github.public_url)) {
      matched = true;
      matchedBy = "github url";
    }
    if (!matched && linkedin && existingLinks.has(linkedin.public_url)) {
      matched = true;
      matchedBy = "linkedin url";
    }

    if (!matched && github) {
      const username = extractGithubUsername(github.public_url);
      if (username) {
        try {
          derivedEmail = await findRealCommitterEmail(username);
        } catch (err) {
          githubLookupError = err.message;
        }
        if (derivedEmail && existingEmails.has(derivedEmail.toLowerCase())) {
          matched = true;
          matchedBy = "email (via github)";
        }
      }
    }

    results.push({
      braintrustId: candidate.id,
      name: candidate.publicName,
      githubUrl: github?.public_url ?? null,
      linkedinUrl: linkedin?.public_url ?? null,
      derivedEmail,
      githubLookupError,
      alreadyInUserIndicator: matched,
      matchedBy,
    });
  }

  const missing = results.filter((r) => !r.alreadyInUserIndicator);

  let inserted = 0;
  for (const r of missing) {
    const result = await userIndicatorPool.query(
      `INSERT INTO todo (braintrust_id, name, github_url, linkedin_url, derived_email)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (braintrust_id) DO NOTHING`,
      [r.braintrustId, r.name, r.githubUrl, r.linkedinUrl, r.derivedEmail]
    );
    inserted += result.rowCount;
  }

  console.log(JSON.stringify(results, null, 2));
  console.error(
    `\n${missing.length} of ${results.length} not found in user_indicator. ${inserted} newly added to todo (rest already queued).`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await userIndicatorPool.end();
    await braintrustPool.end();
  });
