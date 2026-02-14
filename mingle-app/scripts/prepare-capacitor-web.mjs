import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const existingEnvKeys = new Set(Object.keys(process.env));

function loadDotEnvFile(fileName) {
  const filePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalized = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    if (!key || existingEnvKeys.has(key)) {
      continue;
    }

    let value = normalized.slice(separatorIndex + 1).trim();
    const quoteChar = value[0];
    if (
      (quoteChar === '"' || quoteChar === "'") &&
      value.endsWith(quoteChar)
    ) {
      value = value.slice(1, -1);
    } else {
      const inlineCommentIndex = value.indexOf(" #");
      if (inlineCommentIndex >= 0) {
        value = value.slice(0, inlineCommentIndex).trim();
      }
    }

    process.env[key] = value;
  }
}

loadDotEnvFile(".env");
loadDotEnvFile(".env.local");

const webDir = path.join(process.cwd(), "capacitor-web");
const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mingle Mobile Shell</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px;">
    <h1>Mingle Mobile Shell</h1>
    <p>This is a fallback web bundle for Capacitor builds.</p>
    <p>Set <code>CAPACITOR_SERVER_URL</code> to load your deployed Next.js app in native builds.</p>
    ${
      serverUrl
        ? `<script>window.location.replace(${JSON.stringify(serverUrl)});</script>`
        : ""
    }
  </body>
</html>
`;

await mkdir(webDir, { recursive: true });
await writeFile(path.join(webDir, "index.html"), html, "utf8");

console.log(`Prepared Capacitor fallback web bundle at ${webDir}`);
