// Server-side only. Reads CENSUS_API_KEY from the environment — never import
// this from a client component, and never forward the key itself to the
// browser.

const CENSUS_SURNAME_BASE_URL = "https://api.census.gov/data/2010/surname";
const CENSUS_API_KEY = process.env.CENSUS_API_KEY;

export type SurnameRecord = {
  name: string;
  count: number;
  rank: number;
};

export class CensusApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CensusApiError";
  }
}

const surnameCache = new Map<string, SurnameRecord | null>();

function parseSurnameRows(body: unknown): SurnameRecord[] {
  if (!Array.isArray(body) || body.length < 1) return [];
  const [header, ...dataRows] = body as string[][];
  const nameIdx = header.indexOf("NAME");
  const countIdx = header.indexOf("COUNT");
  const rankIdx = header.indexOf("RANK");
  if (nameIdx === -1 || countIdx === -1 || rankIdx === -1) {
    throw new CensusApiError("Unexpected Census surname API response shape");
  }

  const records: SurnameRecord[] = [];
  for (const row of dataRows) {
    const name = row[nameIdx];
    const count = Number(row[countIdx]);
    const rank = Number(row[rankIdx]);
    if (!name || Number.isNaN(count) || Number.isNaN(rank)) continue;
    records.push({ name: name.toUpperCase(), count, rank });
  }
  return records;
}

/**
 * Looks up a surname in the Census Bureau's 2010 surname file, returning
 * only its name, count, and population rank (no race/ethnicity fields are
 * requested or exposed). Results are cached in-memory by normalized
 * (uppercase) surname to avoid repeat network calls.
 */
export async function lookupSurname(surname: string): Promise<SurnameRecord | null> {
  const normalized = surname.trim().toUpperCase();
  if (!normalized) return null;

  if (surnameCache.has(normalized)) {
    return surnameCache.get(normalized)!;
  }

  if (!CENSUS_API_KEY) {
    throw new CensusApiError("CENSUS_API_KEY environment variable is not set");
  }

  const url = `${CENSUS_SURNAME_BASE_URL}?get=NAME,COUNT,RANK&NAME=${encodeURIComponent(normalized)}&key=${CENSUS_API_KEY}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new CensusApiError(`Failed to reach Census surname API: ${(err as Error).message}`);
  }

  // The API returns 204 (no body) when the surname isn't in the file.
  if (response.status === 204 || response.status === 404) {
    surnameCache.set(normalized, null);
    return null;
  }

  if (!response.ok) {
    throw new CensusApiError(`Census surname API error: ${response.status} ${response.statusText}`);
  }

  const body = await response.json();
  const records = parseSurnameRows(body);
  const record = records.find((r) => r.name === normalized) ?? records[0] ?? null;

  surnameCache.set(normalized, record);
  return record;
}
