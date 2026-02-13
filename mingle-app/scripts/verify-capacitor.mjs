import { access, readFile } from "node:fs/promises";
import path from "node:path";

async function assertExists(targetPath, message) {
  try {
    await access(targetPath);
  } catch {
    throw new Error(message);
  }
}

async function main() {
  const cwd = process.cwd();
  const configPath = path.join(cwd, "capacitor.config.ts");
  const webDirPath = path.join(cwd, "capacitor-web");
  const iosPath = path.join(cwd, "ios");
  const androidPath = path.join(cwd, "android");

  await assertExists(configPath, "capacitor.config.ts is missing.");
  await assertExists(webDirPath, "capacitor-web directory is missing. Run `pnpm build:mobile` first.");

  const configText = await readFile(configPath, "utf8");
  if (!configText.includes("appId") || !configText.includes("webDir")) {
    throw new Error("Capacitor config is missing required fields.");
  }

  const platformStatus = {
    ios: true,
    android: true,
  };

  try {
    await access(iosPath);
  } catch {
    platformStatus.ios = false;
  }

  try {
    await access(androidPath);
  } catch {
    platformStatus.android = false;
  }

  console.log("Capacitor verification passed.");
  console.log(`- config: ${configPath}`);
  console.log(`- webDir: ${webDirPath}`);
  console.log(`- ios project: ${platformStatus.ios ? "present" : "missing"}`);
  console.log(`- android project: ${platformStatus.android ? "present" : "missing"}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
