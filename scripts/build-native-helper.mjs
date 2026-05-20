import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "native/macos/input-helper/main.swift");
const output = resolve(root, "dist/native/macos/mic-tool-ts-input-helper");

if (process.platform !== "darwin") {
  console.error("[mic-tool-ts] native focused-input helper build requires macOS.");
  process.exit(1);
}

if (!existsSync(source)) {
  console.error(`[mic-tool-ts] missing native helper source: ${source}`);
  process.exit(1);
}

mkdirSync(dirname(output), { recursive: true });

const result = spawnSync("swiftc", [source, "-o", output], {
  stdio: "inherit",
});

if (result.error !== undefined) {
  console.error(`[mic-tool-ts] failed to start swiftc: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

chmodSync(output, 0o755);
console.error(`[mic-tool-ts] built native focused-input helper: ${output}`);
