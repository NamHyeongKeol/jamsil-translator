#!/usr/bin/env node

import { readFileSync } from "node:fs";

function toInt(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseAddrPort(addrRaw) {
  if (typeof addrRaw !== "string") return null;
  const value = addrRaw.trim();
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ? value
    : `http://${value}`;

  try {
    const url = new URL(withScheme);
    if (url.port) {
      const parsed = Number.parseInt(url.port, 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (url.protocol === "https:") return 443;
    if (url.protocol === "http:") return 80;
  } catch {
    return null;
  }

  return null;
}

function toTunnelInfo(tunnel) {
  const name = typeof tunnel?.name === "string" ? tunnel.name : "";
  const publicUrl = typeof tunnel?.public_url === "string" ? tunnel.public_url : "";
  const proto = typeof tunnel?.proto === "string" ? tunnel.proto.toLowerCase() : "";
  const addrRaw = tunnel?.config?.addr;
  const addrPort = parseAddrPort(addrRaw);

  return {
    name,
    publicUrl,
    proto,
    addrRaw: typeof addrRaw === "string" ? addrRaw : "",
    addrPort,
  };
}

function describeTunnels(tunnels) {
  if (tunnels.length === 0) return "(no tunnels)";
  return tunnels
    .map((t) => {
      const addrPortLabel = Number.isFinite(t.addrPort) ? String(t.addrPort) : "unknown";
      return `${t.name}\tproto=${t.proto || "?"}\tpublic_url=${t.publicUrl || "?"}\taddr=${t.addrRaw || "?"}\taddr_port=${addrPortLabel}`;
    })
    .join("\n");
}

function selectTunnel(tunnels, names, expectedPort, requireHttps) {
  let candidates = tunnels.filter((t) => names.includes(t.name) && t.publicUrl);
  if (Number.isFinite(expectedPort)) {
    candidates = candidates.filter((t) => t.addrPort === expectedPort);
  }
  if (requireHttps) {
    candidates = candidates.filter(
      (t) => t.proto === "https" && t.publicUrl.startsWith("https://"),
    );
  }

  return candidates[0] ?? null;
}

export function parseNgrokTunnels(payload, options) {
  const raw = payload && typeof payload === "object" ? payload : {};
  const list = Array.isArray(raw.tunnels) ? raw.tunnels : [];
  const tunnels = list.map(toTunnelInfo);

  const expectedWebPort = options.expectedWebPort;
  const expectedSttPort = options.expectedSttPort;
  const requireHttps = options.requireHttps === true;

  const web = selectTunnel(
    tunnels,
    ["devbox_web", "web"],
    expectedWebPort,
    requireHttps,
  );
  const stt = selectTunnel(
    tunnels,
    ["devbox_stt", "stt"],
    expectedSttPort,
    requireHttps,
  );

  if (!web || !stt) {
    const detail = describeTunnels(tunnels);
    const requirementLabel = requireHttps ? "https-only" : "http-or-https";
    return {
      ok: false,
      reason: `required ngrok tunnels not found (web:${expectedWebPort}, stt:${expectedSttPort}, ${requirementLabel})`,
      detail,
    };
  }

  return {
    ok: true,
    webUrl: web.publicUrl,
    sttUrl: stt.publicUrl,
    detail: describeTunnels(tunnels),
  };
}

function main() {
  const expectedWebPort = toInt(process.env.DEVBOX_EXPECT_WEB_PORT);
  const expectedSttPort = toInt(process.env.DEVBOX_EXPECT_STT_PORT);
  const requireHttps = process.env.DEVBOX_REQUIRE_HTTPS === "1";

  const stdin = readFileSync(0, "utf8");
  let payload;
  try {
    payload = JSON.parse(stdin);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`ngrok inspector JSON parse failed: ${msg}`);
    process.exit(2);
  }

  const result = parseNgrokTunnels(payload, {
    expectedWebPort,
    expectedSttPort,
    requireHttps,
  });

  if (!result.ok) {
    console.error(result.reason);
    console.error(result.detail);
    process.exit(1);
  }

  process.stdout.write(`${result.webUrl}\n${result.sttUrl}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
