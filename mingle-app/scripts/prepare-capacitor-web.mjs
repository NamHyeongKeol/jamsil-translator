import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
