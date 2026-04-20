import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { allJobs } from "./art-prompts.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnv() {
  const envPath = join(ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
loadEnv();

const API_KEY = process.env.RD_API_KEY;
if (!API_KEY) {
  console.error("Missing RD_API_KEY (set in .env.local)");
  process.exit(1);
}

const ENDPOINT = "https://api.retrodiffusion.ai/v1/inferences";

const JOBS = allJobs();

async function generate(job) {
  const body = {
    prompt: job.prompt,
    prompt_style: job.style,
    width: job.size,
    height: job.size,
    num_images: 1,
  };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RD-Token": API_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  const json = JSON.parse(text);
  const b64 = json.base64_images?.[0];
  if (!b64) throw new Error(`No image in response: ${text}`);
  return { buffer: Buffer.from(b64, "base64"), remaining: json.remaining_balance, cost: json.balance_cost };
}

for (const job of JOBS) {
  const outPath = join(ROOT, job.path);
  if (existsSync(outPath) && !process.env.FORCE) {
    console.log(`skip (exists): ${job.path}`);
    continue;
  }
  mkdirSync(dirname(outPath), { recursive: true });
  process.stdout.write(`generating ${job.path} ... `);
  try {
    const { buffer, remaining, cost } = await generate(job);
    writeFileSync(outPath, buffer);
    console.log(`ok (cost ${cost}, balance ${remaining})`);
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    process.exitCode = 1;
  }
}
