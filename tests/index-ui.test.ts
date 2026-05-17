import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mainMock: ReturnType<typeof vi.fn>;
let launchElectronUiMock: ReturnType<typeof vi.fn>;
let exitMock: ReturnType<typeof vi.fn>;
let stderrWriteMock: ReturnType<typeof vi.fn>;

vi.mock("../src/main.js", () => ({
  main: (...args: unknown[]) => mainMock(...args),
}));

vi.mock("../src/ui/launcher.js", () => ({
  launchElectronUi: (...args: unknown[]) => launchElectronUiMock(...args),
}));

async function importIndexWithArgv(argv: string[]): Promise<void> {
  vi.resetModules();
  process.argv = argv;
  await import("../src/index.js");
  await Promise.resolve();
  await Promise.resolve();
}

describe("src/index ui dispatch", () => {
  beforeEach(() => {
    mainMock = vi.fn(async () => 0);
    launchElectronUiMock = vi.fn(async () => 0);
    exitMock = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    stderrWriteMock = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("launches Electron for the ui subcommand", async () => {
    await importIndexWithArgv(["node", "mic-tool-ts", "ui"]);

    expect(launchElectronUiMock).toHaveBeenCalledOnce();
    expect(mainMock).not.toHaveBeenCalled();
    expect(exitMock).toHaveBeenCalledWith(0);
  });

  it("uses the CLI main for normal invocation", async () => {
    const argv = ["node", "mic-tool-ts", "--no-refine"];
    await importIndexWithArgv(argv);

    expect(mainMock).toHaveBeenCalledWith(argv);
    expect(launchElectronUiMock).not.toHaveBeenCalled();
  });
});
