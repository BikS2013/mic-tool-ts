import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function launchElectronUi(): Promise<number> {
  const mainScript = join(__dirname, "electronMain.js");
  const child = spawn(electronPath as unknown as string, [mainScript], {
    stdio: "inherit",
  });

  return new Promise<number>((resolve) => {
    child.on("error", (err) => {
      process.stderr.write(`${err.stack ?? err.message}\n`);
      resolve(1);
    });
    child.on("close", (code, signal) => {
      if (typeof code === "number") {
        resolve(code);
        return;
      }
      resolve(signal === "SIGINT" ? 130 : 1);
    });
  });
}
