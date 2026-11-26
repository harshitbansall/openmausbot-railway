import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Upstream's RemoteMcpClient offers 2025-06-18 and then caps the session to
// that version even when the server negotiates 2025-11-25. OpenObserve accepts
// the handshake but rejects every follow-up that still says 2025-06-18. Offer
// 2025-11-25 and keep the version the server actually agreed to.
const bundleTarget = (path) => ({
  path,
  replacements: [
    {
      what: "offered protocol version",
      pattern: /PROTOCOL_VERSION="2025-06-18"/g,
      replacement: 'PROTOCOL_VERSION="2025-11-25"',
    },
    {
      what: "negotiated protocol version",
      pattern:
        /this\.protocolVersion=(result\d*)\.protocolVersion<=PROTOCOL_VERSION\?\1\.protocolVersion:PROTOCOL_VERSION/g,
      replacement: "this.protocolVersion=$1.protocolVersion",
    },
  ],
  verify: (source) =>
    !source.includes('PROTOCOL_VERSION="2025-06-18"') &&
    !source.includes("protocolVersion<=PROTOCOL_VERSION") &&
    source.includes('PROTOCOL_VERSION="2025-11-25"'),
});

const base = (process.argv[2] ?? "/app/dist-server").replace(/\/$/, "");

const targets = [
  { ...bundleTarget(`${base}/index.js`), required: true },
  { ...bundleTarget(`${base}/mcp-remote-proxy.js`), required: false },
  {
    path: `${base}/server/mcp-http.js`,
    required: false,
    replacements: [
      {
        what: "offered protocol version",
        pattern: 'const PROTOCOL_VERSION = "2025-06-18";',
        replacement: 'const PROTOCOL_VERSION = "2025-11-25";',
      },
      {
        what: "negotiated protocol version",
        pattern:
          "this.protocolVersion = result.protocolVersion <= PROTOCOL_VERSION ? result.protocolVersion : PROTOCOL_VERSION;",
        replacement: "this.protocolVersion = result.protocolVersion;",
      },
    ],
    verify: (source) =>
      !source.includes("2025-06-18") &&
      !source.includes("protocolVersion <= PROTOCOL_VERSION") &&
      source.includes('const PROTOCOL_VERSION = "2025-11-25";'),
  },
];

for (const target of targets) {
  if (!existsSync(target.path)) {
    if (target.required) {
      throw new Error(`${target.path}: required MCP client bundle is missing`);
    }
    console.log(`Skipped MCP protocol patch for ${target.path} (not present)`);
    continue;
  }

  let source = readFileSync(target.path, "utf8");

  for (const { what, pattern, replacement } of target.replacements) {
    const next = source.replace(pattern, replacement);
    if (next === source) {
      throw new Error(`${target.path}: ${what} pattern did not match`);
    }
    source = next;
  }

  if (!target.verify(source)) {
    throw new Error(`${target.path}: MCP protocol patch verification failed`);
  }

  writeFileSync(target.path, source);
  console.log(`Patched MCP protocol negotiation in ${target.path}`);
}
