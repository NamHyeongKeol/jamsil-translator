import fs from "node:fs";
import path from "node:path";
import type { CapacitorConfig } from "@capacitor/cli";

const existingEnvKeys = new Set(Object.keys(process.env));

function loadDotEnvFile(fileName: string) {
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

const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "com.minglelabs.app",
  appName: "Mingle",
  webDir: "capacitor-web",
  server: serverUrl
    ? {
        url: serverUrl,
        cleartext: serverUrl.startsWith("http://"),
      }
    : undefined,
};

export default config;
