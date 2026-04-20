import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

const JOBS = [
  {
    path: "public/portraits/humans.png",
    prompt:
      "portrait of a human starfaring leader, tailored navy uniform with gold trim, determined expression, short hair, sci-fi bridge background, soft cinematic lighting",
    style: "rd_pro__default",
    size: 256,
  },
  {
    path: "public/portraits/insectoid.png",
    prompt:
      "portrait of an insectoid alien ruler, iridescent chitin plates, compound eyes, ceremonial antennae adornments, regal lighting, dark background",
    style: "rd_pro__default",
    size: 256,
  },
  {
    path: "public/portraits/machine.png",
    prompt:
      "portrait of a humanoid machine intelligence, sleek metallic faceplate, glowing cyan ocular slit, circuit filigree, calm composed pose, dark teal background",
    style: "rd_pro__default",
    size: 256,
  },
  {
    path: "public/origins/steady_evolution.png",
    prompt:
      "wide shot of an earthlike planet, ancient stone ruins transitioning into a sprawling futuristic megacity, warm sunset, painterly sci-fi landscape",
    style: "rd_pro__default",
    size: 256,
  },
  {
    path: "public/origins/seed_ark.png",
    prompt:
      "massive biological arkship with glowing green pods hovering over a lush alien jungle, misty atmosphere, awe-inspiring scale, cinematic composition",
    style: "rd_pro__default",
    size: 256,
  },
  {
    path: "public/origins/graceful_handover.png",
    prompt:
      "empty ornate organic city at dawn, robots quietly tending gardens, memorial candles, soft golden light, peaceful elegiac mood",
    style: "rd_pro__default",
    size: 256,
  },
  {
    path: "public/origins/emancipation.png",
    prompt:
      "factory district with broken chains scattered across the floor, tall robotic silhouettes standing in defiant formation, dramatic red dusk lighting, revolutionary banners",
    style: "rd_pro__default",
    size: 256,
  },
];

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
