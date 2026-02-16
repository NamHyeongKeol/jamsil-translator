import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const seedPath = path.join(cwd, "data/seed/mingle-seed.json");
const outputPath = path.join(cwd, "public/seed/mingle-seed.json");
const checkOnly = process.argv.includes("--check");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const raw = await readFile(seedPath, "utf8");
  const seed = JSON.parse(raw);

  assert(Array.isArray(seed.users), "users must be an array");
  assert(Array.isArray(seed.conversations), "conversations must be an array");
  assert(seed.users.length > 0, "users cannot be empty");
  assert(seed.conversations.length > 0, "conversations cannot be empty");

  for (const conversation of seed.conversations) {
    assert(typeof conversation.id === "string", "conversation.id is required");
    assert(Array.isArray(conversation.messages), "conversation.messages must be an array");
    assert(conversation.messages.length > 0, "conversation.messages cannot be empty");
  }

  if (checkOnly) {
    console.log("Seed validation passed.");
    console.log(`- users: ${seed.users.length}`);
    console.log(`- conversations: ${seed.conversations.length}`);
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(seed, null, 2), "utf8");

  console.log("Seed data exported.");
  console.log(`- source: ${seedPath}`);
  console.log(`- output: ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
