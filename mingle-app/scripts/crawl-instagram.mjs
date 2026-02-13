import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();

function getArgValue(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return fallback;
  }
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

function detectLanguage(text) {
  if (/[가-힣]/.test(text)) {
    return "ko";
  }
  if (/[ぁ-んァ-ン]/.test(text)) {
    return "ja";
  }
  if (/[áéíóúñ¿¡]/i.test(text)) {
    return "es";
  }
  return "en";
}

function normalizeRecord(record) {
  const text = String(record.caption ?? "").trim();

  return {
    platform: "instagram",
    author: String(record.username ?? "unknown"),
    sourceUrl: String(record.postUrl ?? ""),
    text,
    language: detectLanguage(text),
    metrics: {
      likes: Number(record.likes ?? 0),
      comments: Number(record.comments ?? 0),
    },
    createdAt: record.createdAt
      ? new Date(record.createdAt).toISOString()
      : new Date().toISOString(),
    collectedAt: new Date().toISOString(),
  };
}

async function main() {
  const inputPath = getArgValue(
    "input",
    path.join(cwd, "data/crawl/instagram-input.sample.json"),
  );
  const outputPath = getArgValue(
    "output",
    path.join(cwd, "data/crawl/instagram-normalized.json"),
  );

  const raw = await readFile(inputPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Input must be an array of Instagram post objects.");
  }

  const normalized = parsed.map(normalizeRecord);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(normalized, null, 2), "utf8");

  console.log("Instagram crawl normalization complete.");
  console.log(`- input: ${inputPath}`);
  console.log(`- output: ${outputPath}`);
  console.log(`- records: ${normalized.length}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
