#!/usr/bin/env node
import { main } from "./main.js";
import { launchElectronUi } from "./ui/launcher.js";

const argv = process.argv;
const run = argv[2] === "ui"
  ? launchElectronUi()
  : main(argv);

run.then(
  (code) => process.exit(code),
  (err: unknown) => {
    // Top-level safety net; main() should normally catch its own errors and
    // return a non-zero exit code. Anything that reaches here is unexpected.
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
