// One-shot script to retroactively apply alpha-mask to sprites that were
// generated before the transparent-bg post-process existed.
//
// Usage: node scripts/apply-alpha.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { alphaMaskBuffer } from "./alpha-bg.mjs";
import { allJobs } from "./art-prompts.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const jobs = allJobs().filter((j) => j.transparent);

for (const job of jobs) {
  const path = join(ROOT, job.path);
  process.stdout.write(`alpha-mask ${job.path} ... `);
  try {
    const input = readFileSync(path);
    const output = alphaMaskBuffer(input);
    writeFileSync(path, output);
    console.log("ok");
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    process.exitCode = 1;
  }
}
