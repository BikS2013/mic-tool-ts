# Investigation 007: Windows and Linux Portability

Access date: 2026-05-16

## Executive Summary

The current implementation is **not portable as-is**. On Linux and Windows, it intentionally fails before microphone capture starts because `src/mic/index.ts` only returns a concrete `MicSource` when `process.platform === "darwin"` and throws `UnsupportedPlatformError` otherwise. The test suite locks this behavior in by asserting that both `linux` and `win32` throw with a "macOS only" message.

The implementation is, however, **architecturally portable**. The platform-specific code is mostly isolated behind the `MicSource` interface. The STT providers, LLM refinement, renderer, turn detector, config parser, and orchestrator all operate on Node streams, buffers, URLs, and HTTP/WebSocket APIs that are not inherently macOS-specific.

Recommended path: add a provider-neutral spawned-process microphone base class and implement explicit OS backends:

- macOS: keep the existing SoX backend for v1 compatibility.
- Linux: add an FFmpeg backend using `alsa` or `pulse`, or an `arecord` backend for ALSA-first systems.
- Windows: add an FFmpeg backend using DirectShow (`dshow`) first; evaluate WASAPI only if low-latency/default-device ergonomics require it.

## Original Request

> I want you to investigate whether the current implementation is portable to other operating systems. I want you to study it thoroughly and understand whether I can port it to Windows and Linux platforms.

## Scope

In scope:

- Current implementation and tests.
- Windows and Linux portability blockers.
- Microphone capture options that can produce the existing raw PCM stream contract.
- Recommended implementation strategy.

Out of scope:

- Implementing Windows or Linux support in this pass.
- Adding runtime dependencies.
- Live microphone validation on Windows or Linux.

## Current Implementation Findings

### The hard portability blocker is microphone factory dispatch

`src/mic/index.ts` is the decisive blocker:

- `createMicSource()` returns `SoxMicSource` only for `process.platform === "darwin"`.
- Every other platform throws `UnsupportedPlatformError`.

Local evidence:

- `src/mic/index.ts:18-27`
- `tests/mic.test.ts:569-597`

This means the installed CLI cannot currently capture audio on Linux or Windows even if all dependencies install correctly.

### The existing mic backend is a macOS-tuned SoX wrapper

`SoxMicSource` spawns:

```text
sox -q -d -t raw -r <sampleRate> -c 1 -b 16 -e signed-integer -L -
```

Local evidence:

- `src/mic/soxMicSource.ts:30-47`
- `src/mic/soxMicSource.ts:118-120`

The output format is exactly the right abstraction for portability: raw `pcm_s16le`, mono, configurable sample rate, emitted as `Buffer` chunks on a Node `Readable`. The implementation details are not portable enough:

- Error messages are macOS/CoreAudio-oriented (`coreaudio`, System Settings mic permission).
- Stop behavior uses POSIX-style signal names (`SIGTERM`, then `SIGKILL`).
- Documentation tells users to install SoX with Homebrew.
- The startup-success heuristic is process-survival after 200 ms, not proof that cross-platform device capture is actually producing audio.

Local evidence:

- `src/mic/soxMicSource.ts:142-176`
- `src/mic/soxMicSource.ts:255-270`
- `src/mic/soxMicSource.ts:288-318`

### Most of the pipeline after mic capture is portable

`main()` creates a transcriber first, then a mic source, then wires `mic.audio` `data` chunks into `transcriber.pushAudio(chunk)`. This is a good portability boundary: a Windows or Linux backend only needs to expose the same `Readable<Buffer>` contract.

Local evidence:

- `src/main.ts:195-205`
- `src/main.ts:230-268`
- `src/main.ts:270-281`

The STT clients are network clients:

- Soniox uses `@soniox/node` and accepts `Buffer` chunks through `sendAudio()`.
- ElevenLabs uses the `ws` package and base64-encodes the same PCM chunks.

No local native `.node`, `.dylib`, `.so`, or `.dll` artifacts were found under the installed `@soniox/node` or `ws` packages. The local package metadata also does not declare OS-specific restrictions.

Local evidence:

- `package.json:21-25`
- `node_modules/@soniox/node/package.json`
- `node_modules/ws/package.json`

### Config handling is mostly portable, but docs and expectations are Unix-biased

`loadEnvChain()` uses `os.homedir()` and `path.join()`, so the resolved user config path becomes platform-native even though docs display it as `~/.tool-agents/mic-tool-ts/.env`. The `.env` parser handles CRLF line endings.

Local evidence:

- `src/config/envChain.ts:25-27`
- `src/config/envChain.ts:54-77`
- `src/config/envChain.ts:117-124`

Porting docs should add Windows examples for:

- `%USERPROFILE%\.tool-agents\mic-tool-ts\.env`
- PowerShell environment variables
- npm/pnpm-created `.cmd` command shims instead of Unix symlinks and `chmod`

The npm `bin` field is a good cross-platform packaging mechanism: npm documents that a global install links the declared bin on Unix-like systems and creates a Windows `.cmd` command file for the same command name.

### Terminal rendering is acceptable with small caveats

The renderer already downgrades `overwrite` mode to `append` when stdout is not a TTY. This protects logs and pipes on every OS.

Local evidence:

- `src/render/renderer.ts:58-70`
- `src/render/renderer.ts:143-157`

Remaining Windows caveat: overwrite mode uses `\r` and ANSI clear-line. Modern Windows terminals commonly handle this, but Windows CI or legacy consoles should be verified. The existing `append` and `final-only` modes are the safest cross-platform modes.

### Signal and child-process handling need OS-specific tests

The orchestrator listens for `SIGINT` and `SIGTERM`, and `SoxMicSource.stop()` sends `SIGTERM` then `SIGKILL`. This is fine on Unix-like systems. On Windows, Node's own project discussions note that Windows does not support POSIX signals directly and Node provides emulation for process-kill APIs, so process termination should be tested per backend and preferably abstracted behind a `stopChildProcess()` helper.

Local evidence:

- `src/main.ts:283-313`
- `src/mic/soxMicSource.ts:255-270`

## External Research Findings

### Node platform and packaging behavior

Node exposes the current target OS through `process.platform` / `os.platform()` values including `darwin`, `linux`, and `win32`. This matches the existing dispatch point in `src/mic/index.ts`.

Source: https://nodejs.org/api/os.html

npm's `package.json` `bin` field is suitable for the direct `mic-tool-ts` command on Windows because npm creates a Windows command file for globally installed package bins.

Source: https://docs.npmjs.com/cli/v10/configuring-npm/package-json/

Node's `child_process.spawn()` is cross-platform, but its docs call out Windows-specific environment-variable behavior and platform differences around subprocess handling. This supports keeping the "spawn a recorder and read stdout" strategy, with backend-specific process and error handling.

Source: https://nodejs.org/api/child_process.html

### FFmpeg is the strongest cross-platform external-binary candidate

FFmpeg's official device documentation lists platform-specific input devices including:

- `dshow` for Windows DirectShow capture.
- `alsa` for Linux ALSA capture.
- `pulse` for PulseAudio capture.
- `avfoundation` for macOS capture.

Source: https://ffmpeg.org/ffmpeg-devices.html

The FFmpeg docs describe input devices as libavdevice-backed sources and provide device-specific options. This makes FFmpeg a strong candidate for a shared `FfmpegMicSource` with platform-specific input args and a common output format:

```text
-f s16le -ar <sampleRate> -ac 1 pipe:1
```

Derived implementation constraint: device selection and listing are OS-specific; the project should expose a configurable `MIC_TOOL_TS_AUDIO_DEVICE` only after defining strict no-fallback semantics for missing or invalid explicit device names.

### Linux-specific options

`arecord` is a command-line recorder for ALSA soundcard devices and can write to stdout when no filename is specified. It is a small Linux-only backend candidate.

Source: https://manpages.debian.org/alsa-utils/arecord.1.en.html

`parec` / `pacat` can capture raw or encoded audio from a PulseAudio sound server and write to stdout. This is relevant because many desktop Linux systems use PulseAudio or PipeWire compatibility layers instead of direct ALSA device access.

Source: https://manpages.debian.org/testing/pulseaudio-utils/parec.1.en.html

Derived implementation constraint: Linux support should not assume ALSA alone. Either use FFmpeg with `pulse` as the desktop default and `alsa` as a documented fallback, or provide separate backends selected by config.

### Native cross-platform audio library option

PortAudio is explicitly designed for cross-platform audio I/O and supports Windows, macOS, and Linux.

Source: https://portaudio.com/docs/v19-doxydocs/

Derived implementation constraint: PortAudio could eventually remove external binary prerequisites, but in a TypeScript CLI it likely means adding a native Node binding or maintaining a helper binary. That increases dependency-vetting, packaging, CI, and install complexity.

## Portability Assessment By Component

| Component | Current status | Windows/Linux impact | Porting work |
|---|---:|---|---|
| `package.json` runtime | Mostly portable | Node >= 20.12, ESM, bin field are cross-platform | Add Windows install docs; verify global/local command shim |
| `src/index.ts` | Portable | Node shebang works with npm shims | No code change |
| Config resolver | Mostly portable | Uses `os.homedir()` / `path.join()`; docs are Unix-biased | Add Windows docs and maybe path examples |
| Mic factory | Not portable | Hard rejects `linux` and `win32` | Add dispatch for OS backends |
| SoX mic backend | macOS-only in project contract | SoX exists elsewhere, but current args/errors/docs assume macOS | Keep as macOS backend; do not stretch it to all OSes without tests |
| Orchestrator | Mostly portable | Reads `Readable<Buffer>`; signal semantics need Windows tests | Abstract process termination behavior if needed |
| Soniox client | Portable | WebSocket/network client; consumes PCM chunks | No expected OS-specific code |
| ElevenLabs client | Portable | `ws` network client; consumes PCM chunks | No expected OS-specific code |
| Renderer | Mostly portable | `append` and `final-only` safe; `overwrite` needs Windows console verification | Add Windows terminal tests/manual QA |
| Tests | Not portability-complete | Current tests assert non-macOS failure | Add Linux/Windows backend unit tests and platform dispatch tests |
| Docs | macOS-only | Install and troubleshooting are macOS-specific | Add per-OS prerequisite/install sections |

## Candidate Porting Options

### Option A: Add per-OS external-command backends

Implement:

- `SoxMicSource` for `darwin` unchanged.
- `FfmpegMicSource` for `win32`.
- `FfmpegMicSource` or `ArecordMicSource` / `PulseMicSource` for `linux`.

Pros:

- Smallest code change.
- Preserves the current `MicSource` stream contract.
- Avoids native npm dependencies.
- Keeps dependency risk mostly in user-installed system tools.

Cons:

- Users must install OS-specific binaries.
- Device naming/listing differs by platform.
- Error classification must be written and tested per backend.

Best fit for this project now.

### Option B: Replace all mic capture with FFmpeg

Use FFmpeg on every OS:

- macOS: `avfoundation`
- Linux: `pulse` or `alsa`
- Windows: `dshow`

Pros:

- One external tool family and one spawned-process implementation.
- Strong cross-platform device support.
- Can standardize output conversion flags.

Cons:

- Changes the existing macOS capture implementation and prerequisite from SoX to FFmpeg.
- macOS permissions and device IDs differ from current SoX behavior.
- Larger external binary than SoX.

Good medium-term option if the project wants one documented capture tool everywhere.

### Option C: Native cross-platform audio library

Use PortAudio through a Node binding or helper binary.

Pros:

- Best long-term user experience if packaged correctly.
- One conceptual capture API across OSes.
- Can support device enumeration inside the tool.

Cons:

- Highest packaging and dependency-vetting cost.
- Native builds are a common source of installation failures.
- More CI matrix work.

Not recommended as the first port unless external binary prerequisites are unacceptable.

## Recommended Design

Add a generic spawned-process mic base:

```ts
interface SpawnedMicCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly missingBinaryInstallHint: string;
  classifyStartupExit(stderrTail: string, code: number | null, signal: NodeJS.Signals | null): MicToolError;
}
```

Then implement:

- `src/mic/soxMicSource.ts` as macOS-specific, possibly refactored to share process lifecycle code.
- `src/mic/ffmpegMicSource.ts` for Windows and Linux, with platform-specific argument builders.
- Optional later `src/mic/arecordMicSource.ts` if FFmpeg's Linux defaults are poor in real testing.

Factory target:

```ts
switch (process.platform) {
  case "darwin":
    return new SoxMicSource(opts);
  case "linux":
    return createLinuxMicSource(opts);
  case "win32":
    return new FfmpegMicSource(buildWindowsFfmpegArgs(opts));
  default:
    throw new UnsupportedPlatformError(...);
}
```

Suggested initial FFmpeg shapes to validate manually:

```text
# Windows DirectShow, explicit default-ish audio device still needs discovery.
ffmpeg -hide_banner -loglevel error -f dshow -i audio="<device-name>" -ac 1 -ar <sampleRate> -f s16le pipe:1

# Linux PulseAudio/PipeWire-compatible default source.
ffmpeg -hide_banner -loglevel error -f pulse -i default -ac 1 -ar <sampleRate> -f s16le pipe:1

# Linux ALSA fallback.
ffmpeg -hide_banner -loglevel error -f alsa -i default -ac 1 -ar <sampleRate> -f s16le pipe:1
```

Device selection must be treated as configuration, not silent fallback. If a user supplies an explicit device and the backend cannot open it, raise `MicNotAvailableError` with platform-specific remediation.

## Work Estimate

Smallest useful port:

1. Refactor `SoxMicSource` process lifecycle into a reusable spawned-recorder helper: medium.
2. Add Linux FFmpeg backend: medium.
3. Add Windows FFmpeg backend: medium-high because device discovery, quoting, and close behavior need real Windows validation.
4. Add config/docs for optional audio device selection: medium.
5. Add CI/unit tests with mocked subprocesses for `linux` and `win32`: medium.
6. Add manual smoke scripts under `test_scripts/` for each OS: small.

Overall: feasible, moderate effort, mostly constrained by real OS audio-device validation rather than TypeScript architecture.

## Risks

- Windows DirectShow device names can be awkward to discover and quote.
- Linux audio stack varies: ALSA-only servers, PulseAudio desktops, PipeWire compatibility, containers/WSL with no real microphone.
- Windows child-process termination may not behave like POSIX `SIGTERM`/`SIGKILL`; backend stop behavior needs real testing.
- Documentation currently teaches macOS-only install and troubleshooting.
- A cross-platform port may need a new `--audio-device` / `MIC_TOOL_TS_AUDIO_DEVICE` option; that must follow the no-hidden-fallback configuration rule.

## Verification Performed

- `pnpm test` passed: 12 test files, 288 tests.
- `pnpm typecheck` passed: `tsc --noEmit`.

## Recommendation

Porting to Windows and Linux is practical. Do **not** rewrite the STT, rendering, LLM, config, or orchestrator layers first. Start by adding microphone backends behind the existing `MicSource` contract.

Recommended first implementation milestone:

- Linux support with FFmpeg `pulse` default and `alsa` fallback selected explicitly by config.
- Windows support with FFmpeg `dshow` and explicit device documentation.
- Keep macOS on SoX initially to avoid changing current working behavior.

If the project later prioritizes a single capture stack over minimal change, migrate macOS to FFmpeg `avfoundation` and retire SoX as a second milestone.

## Open Questions

- Should Windows require an explicit audio device name, or should the tool provide a `mic-tool-ts --list-audio-devices` helper first?
- Should Linux default to PulseAudio/PipeWire (`pulse`) or ALSA (`alsa`)?
- Is an external FFmpeg prerequisite acceptable, or does the project want a native PortAudio-based dependency despite packaging complexity?
- Should WSL be explicitly unsupported for microphone capture unless the user provides a working audio bridge?

## References

- Node.js OS docs, `os.platform()` / platform values: https://nodejs.org/api/os.html
- Node.js child process docs, `spawn()` and Windows environment caveats: https://nodejs.org/api/child_process.html
- Node.js issue discussion on Windows signal emulation: https://github.com/nodejs/node/issues/12378
- npm `package.json` `bin` docs: https://docs.npmjs.com/cli/v10/configuring-npm/package-json/
- FFmpeg device docs: https://ffmpeg.org/ffmpeg-devices.html
- Debian `arecord` manpage: https://manpages.debian.org/alsa-utils/arecord.1.en.html
- Debian `parec` / `pacat` manpage: https://manpages.debian.org/testing/pulseaudio-utils/parec.1.en.html
- PortAudio docs: https://portaudio.com/docs/v19-doxydocs/
