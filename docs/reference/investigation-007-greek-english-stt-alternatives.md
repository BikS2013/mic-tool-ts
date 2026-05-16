# Investigation: Greek-English Speech-to-Text Alternatives

## Executive Summary

The strongest additional API candidate for `mic-tool-ts` is **Gladia Live STT / Solaria**, because its current documentation explicitly supports live WebSocket transcription, Greek (`el`), English (`en`), and real-time code switching. It also accepts the same audio shape this project already captures: 16 kHz, mono, 16-bit PCM.

The best second-tier API candidates are **OpenAI Realtime Transcription**, **AssemblyAI Whisper Streaming**, **AWS Transcribe Streaming**, **Azure AI Speech**, **Google Cloud Speech-to-Text V2**, and **Speechmatics Realtime**. Each can plausibly support the live microphone use case, but they differ on code-switching guarantees, SDK/protocol complexity, and whether Greek-English switching is explicitly documented.

The strongest local/open-source path is **WhisperLiveKit**, backed by Whisper-family models. It provides a local server, native WebSocket streaming, and OpenAI-compatible REST endpoints. For a Node CLI, it can be treated as a locally deployed STT provider rather than embedded into the TypeScript process. **whisper.cpp** and **faster-whisper** are useful lower-level engines but need more orchestration for a polished live transcription provider. **Vosk** is low-resource and streaming-capable, but its Greek model appears too weak for this project's Greek-English use case.

No provider was live-tested in this investigation because API keys and representative Greek-English microphone samples were not available. These findings are based on current provider documentation and project fit as of 2026-05-16.

## Context

`mic-tool-ts` currently captures macOS microphone audio as `pcm_s16le`, 16 kHz, mono PCM and streams it to a realtime STT provider. Soniox is the default provider, and ElevenLabs has already been investigated and added as an alternative. The user now asked which other commercial APIs and open-source/local models should be considered, with a specific requirement for Greek mixed with English words.

## Decision Criteria

- Realtime or near-realtime microphone transcription.
- Greek support.
- English support.
- Ability to handle Greek-English code switching within a turn or utterance.
- Compatibility with existing audio format: PCM signed 16-bit little-endian, 16 kHz, mono.
- Clear partial/final transcript events or enough event structure to map into the existing renderer.
- Reasonable TypeScript integration path.
- Operational risk: credentials, cloud setup, local deployment complexity, model size, latency, and maintenance burden.

## Commercial / Hosted API Options

| Option | Greek | English | Mixed Greek-English fit | Realtime fit | Integration fit | Judgment |
| --- | --- | --- | --- | --- | --- | --- |
| Gladia Live STT / Solaria | Yes | Yes | Strong: explicit code switching docs | Strong: live WebSocket | Good: PCM live session | Best next API candidate |
| OpenAI Realtime Transcription | Likely, via Whisper-family transcription | Yes | Medium: multilingual transcription, but code switching not explicitly promised in realtime docs | Strong: realtime transcript deltas | Good: WebSocket/Realtime API | High-priority benchmark |
| AssemblyAI Whisper Streaming | Yes | Yes | Medium-strong: auto language detection, Whisper-family | Strong: WebSocket streaming | Good | High-priority benchmark |
| AWS Transcribe Streaming | Yes | Yes | Medium-strong: streaming multi-language identification | Strong | Moderate: AWS auth/EventStream | Good if AWS account/setup is acceptable |
| Azure AI Speech | Yes | Yes | Medium: continuous language ID with candidate languages | Strong | Moderate: SDK and Azure setup | Good enterprise candidate |
| Google Cloud Speech-to-Text V2 | Yes | Yes | Medium: language alternatives / language recognition, but feature/model constraints | Strong: gRPC streaming | Moderate-heavy: gRPC/Google auth | Good enterprise candidate |
| Speechmatics Realtime | Yes | Yes | Medium: strong multilingual coverage, code switching less explicit in docs found | Strong | Good: WebSocket/SDK | Candidate, requires Greek-English benchmark |
| Deepgram Nova/Flux | Not clearly in latest documented multi set | Yes | Weak for this exact Greek requirement unless confirmed | Strong | Good | Do not prioritize for Greek-English |
| Groq Whisper API | Yes through Whisper multilingual | Yes | Medium for chunked audio | Weak for this CLI's live streaming shape | Good for REST chunks only | Not a primary live provider |
| Mistral Voxtral Realtime | No Greek in documented 13-language set | Yes | Weak for Greek | Strong for supported languages | Good | Not a Greek-English candidate yet |

### Gladia Live STT / Solaria

Gladia is the best fit to investigate next. Its documentation includes a `/v2/live` session that returns a WebSocket URL and accepts `wav/pcm`, 16-bit, 16 kHz, mono in the example configuration. It also documents `language_config` with `languages` and `code_switching`, partial transcript controls, final transcript controls, and endpointing. Its supported-language table lists both Greek (`el`) and English (`en`) with auto-discovery/code-switch support. Its code-switching page explicitly says it transcribes conversations where speakers switch languages mid-utterance or across turns.

Implementation shape:

- Add provider value: `gladia`.
- Required secret: `GLADIA_API_KEY`.
- Start a live session with `encoding: "wav/pcm"`, `bit_depth: 16`, `sample_rate: 16000`, `channels: 1`.
- Set `language_config.languages` to `["el", "en"]`.
- Set `language_config.code_switching` to `true`.
- Enable partial and final transcript messages.
- Map final transcript events to existing final callbacks and speech/end events to endpoint handling.

Main risks:

- Need live benchmark against Greek-English command speech, not just general conversation.
- Pricing and quota should be checked before sustained use.
- Provider event schema needs a focused implementation spike.

### OpenAI Realtime Transcription

OpenAI's Realtime transcription guide documents transcription-only realtime sessions that stream transcript deltas as audio arrives. The recommended realtime transcription model is `gpt-realtime-whisper`. The standard Speech-to-Text guide says transcription endpoints can transcribe audio into whatever language the audio is in, and separate file/request-response models are available for non-streaming workflows.

Implementation shape:

- Add provider value: `openai-realtime`.
- Required secret: `OPENAI_API_KEY`.
- Use realtime transcription sessions rather than the file transcription endpoint.
- Keep a benchmark mode with no fixed `language` if supported by the API behavior, or test `language: "el"` against English loanwords.

Main risks:

- The realtime docs show a single `language` field in the session config, and do not explicitly document Greek-English code switching behavior.
- Needs empirical testing with the exact Greek-English usage pattern.

### AssemblyAI Whisper Streaming

AssemblyAI documents Whisper Streaming with `speech_model=whisper-rt`, WebSocket streaming, Greek and English in the supported language list, and automatic language detection. Its Universal Streaming multilingual model does not include Greek, so the relevant AssemblyAI option is specifically Whisper Streaming, not Universal Streaming multilingual.

Implementation shape:

- Add provider value: `assemblyai-whisper`.
- Required secret: `ASSEMBLYAI_API_KEY`.
- Use the WebSocket streaming API with `speech_model=whisper-rt`.
- Avoid setting a fixed language parameter, because AssemblyAI says the Whisper streaming model auto-detects language and does not support the language parameter.

Main risks:

- Whisper-family streaming can lag or revise text depending on buffering strategy.
- Need to verify final-turn behavior for the project's guard-phrase workflow.

### AWS Transcribe Streaming

AWS documents streaming transcription through SDKs, HTTP/2, and WebSockets. AWS also announced Greek among additional streaming transcription languages, and its streaming language-identification docs say multi-language identification can identify all languages spoken in a stream and create transcript output using each identified language. AWS requires at least two language codes for streaming language identification.

Implementation shape:

- Add provider value: `aws-transcribe`.
- Required config: AWS credential chain or explicit AWS access config, plus region.
- Use streaming over WebSocket or the AWS streaming SDK.
- Configure language options for Greek and English and enable multi-language identification.

Main risks:

- AWS signing and streaming event handling add implementation complexity.
- The output event model may require more adapter code than simpler WebSocket JSON providers.
- Need to verify how well it handles short intra-utterance English words inside Greek speech.

### Azure AI Speech

Azure's language support table includes `el-GR` for speech-to-text and English locales. Its language-identification docs support candidate language lists, at-start or continuous LID, and continuous LID in JavaScript among other SDKs. Azure warns that language identification adds initial latency and that the service returns one of the candidate languages even when the spoken language is outside the list.

Implementation shape:

- Add provider value: `azure-speech`.
- Required config: Azure Speech key and region/endpoint.
- Use the Speech SDK for JavaScript, continuous recognition, and continuous LID with `el-GR` and a selected English locale such as `en-US`.

Main risks:

- SDK lifecycle must be mapped cleanly into the existing `Transcriber` interface.
- Candidate-language recognition is not the same as explicit token-level code switching.

### Google Cloud Speech-to-Text V2

Google Cloud Speech-to-Text V2 supports streaming recognition through gRPC. Its supported languages page lists language support through `languageCodes`, and its automatic language detection guide allows multiple possible languages, up to three, though with model and region constraints. Chirp 3 docs also describe streaming support and automatic language detection, but implementation should verify the exact model/locale combination before coding because Google language/model feature support changes by region and model.

Implementation shape:

- Add provider value: `google-stt`.
- Required config: Google Cloud credentials/project/region.
- Use V2 `StreamingRecognize`.
- Use language codes for Greek and English with the smallest candidate set possible.

Main risks:

- gRPC and Google credential setup are heavier than plain WebSocket providers.
- Multiple-language support has model/region constraints.

### Speechmatics Realtime

Speechmatics documents realtime transcription, WebSocket APIs, and broad language coverage including Greek and English. The documentation found for language identification was primarily batch-oriented, so Speechmatics should be benchmarked as a configured-language realtime provider first, then evaluated for any available realtime multilingual behavior through feature discovery or account-specific docs.

Implementation shape:

- Add provider value: `speechmatics`.
- Required secret: `SPEECHMATICS_API_KEY`.
- Use realtime WebSocket API or official SDK.
- Start with explicit Greek configuration and benchmark English code-switched terms.

Main risks:

- Code-switch behavior is less explicit than Gladia or AWS multi-language identification.
- Contracted language access may vary by account.

### Deepgram, Groq, and Mistral

Deepgram's latest documented Flux/Nova-3 multilingual sets list English, Spanish, French, German, Hindi, Russian, Portuguese, Japanese, Italian, and Dutch, not Greek. Deepgram may still have legacy or account-specific options, but it should not be prioritized for a Greek-English requirement until Greek streaming support is confirmed.

Groq hosts Whisper-family transcription endpoints with very fast multilingual file transcription, but the documented API shape is file/URL transcription and translation, not native microphone streaming with partial/final events. It could be useful for chunked or post-turn transcription, but it is not a clean replacement for Soniox/ElevenLabs realtime streaming.

Mistral Voxtral Realtime is technically attractive and open-weight, but current Mistral docs list 13 supported languages for Voxtral transcription and do not include Greek. It should be revisited only if Greek support lands.

## Open-Source / Local Deployment Options

| Option | Greek-English fit | Realtime fit | Deployment shape | Judgment |
| --- | --- | --- | --- | --- |
| WhisperLiveKit | Strongest local option | Strong | Run local server; connect via WebSocket | Best local candidate |
| whisper.cpp | Strong model base, depending on model | Medium-strong | Native binary/server, local process | Good lower-level engine |
| faster-whisper | Strong model base | Medium | Python service needed | Good engine, not provider by itself |
| OpenAI Whisper reference | Strong multilingual base | Weak for live without wrapper | Python batch/segments | Useful baseline, not realtime provider |
| Vosk | Weak for Greek-English | Strong low-latency streaming | Local Node/Python bindings | Not recommended for this use case |
| Meta MMS / Transformers | Medium for Greek, weak for code switching | Weak-medium | Python service, adapter management | Research-only candidate |
| NVIDIA NeMo | Depends on model | Medium | Python/GPU-oriented | Not first choice for Greek-English CLI |

### WhisperLiveKit

WhisperLiveKit is the most practical local route because it packages live transcription as a server. Its PyPI documentation says it uses intelligent buffering and incremental processing because plain Whisper on tiny audio batches loses context, and it exposes native WebSocket, Deepgram-compatible WebSocket, and OpenAI-compatible REST APIs. It can auto-pull models, run locally, and supports model management commands.

Recommended architecture:

- Do not embed Python inference inside `mic-tool-ts`.
- Treat WhisperLiveKit as a separate local service.
- Add a `local-whisper` provider that connects to `ws://localhost:<port>/asr` or a Deepgram-compatible local endpoint.
- Keep model selection and server startup as explicit configuration; do not silently start or download models from the TypeScript CLI.

Main risks:

- Requires Python/service lifecycle documentation.
- Large models may need GPU/Metal/Core ML acceleration for good latency.
- Need a benchmark to select `large-v3`, `large-v3-turbo`, or another model for Greek-English speech.

### whisper.cpp

`whisper.cpp` is a high-performance C/C++ implementation of Whisper with Apple Silicon, Metal, Core ML, CPU, CUDA, Vulkan, and other acceleration paths. It is attractive for macOS and avoids Python runtime coupling. It is lower-level than WhisperLiveKit, so the project would need to decide whether to spawn a local server/binary or integrate a native binding.

Main risks:

- More integration work for polished partial/final behavior.
- Need tuning for model size, VAD, segment buffering, and Greek-English accuracy.

### faster-whisper

`faster-whisper` is a CTranslate2 reimplementation of Whisper that reports faster inference and lower memory use than the OpenAI reference implementation. It is a good engine for a custom local service, especially when running on CUDA or with quantization. It is not a complete realtime provider by itself.

Main risks:

- Requires a Python service wrapper.
- Need streaming buffering and endpointing logic, or a framework built on top of it.

### Vosk

Vosk is open source, offline, has Node bindings, and supports streaming recognition with small-footprint models. It lists Greek among supported languages. However, an upstream maintainer comment in a Vosk GitHub issue describes the Greek model as basic and not very accurate. That makes it a poor fit for Greek-English mixed dictation unless the requirement is offline, very low-resource, and accuracy is secondary.

### Meta MMS / Transformers

Meta MMS supports many languages and Hugging Face documents ASR checkpoints with language adapters. This is relevant for research or fine-tuning, but it is not a turnkey realtime mixed Greek-English provider. Adapter switching also works against intra-utterance code switching unless an additional language-ID and routing layer is built.

## Recommendation

### Recommended API shortlist

1. **Gladia Live STT / Solaria**: first implementation spike after Soniox and ElevenLabs because it explicitly matches Greek-English code switching and live WebSocket transcription.
2. **AssemblyAI Whisper Streaming**: strong hosted Whisper-family fallback with Greek and automatic language detection.
3. **OpenAI Realtime Transcription**: high-priority benchmark because the API is clean and already likely to coexist with the project's LLM configuration conventions, but code-switch behavior must be tested.
4. **AWS Transcribe Streaming**: good when AWS operational setup is acceptable and multi-language stream identification is important.
5. **Azure AI Speech or Google Cloud STT V2**: good enterprise alternatives, but with heavier cloud/SDK integration.

### Recommended local shortlist

1. **WhisperLiveKit**: best local candidate because it already exposes realtime service APIs.
2. **whisper.cpp**: best native/macOS engine candidate if the project wants a tighter local binary path.
3. **faster-whisper**: good engine if a Python local service is acceptable.

### Options not recommended now

- **Deepgram**: do not prioritize unless Greek streaming support is confirmed for the selected model.
- **Mistral Voxtral Realtime**: not currently suitable for Greek based on the documented language set.
- **Vosk**: not suitable for accuracy-sensitive Greek-English dictation.
- **Groq Whisper API**: useful for fast file/chunk transcription, not a clean realtime partial/final provider.

## Suggested Benchmark Before Implementation

Before adding another provider, create a short private benchmark set:

- 10 Greek-only command phrases.
- 10 English-only command phrases.
- 20 Greek sentences with English technical words, product names, commands, and variable names.
- 10 phrases containing the guard phrase `τέλος εντολής`.
- Noisy-room and quiet-room samples.

Benchmark each provider for:

- First partial latency.
- Final transcript latency.
- Greek WER or practical command correctness.
- English word preservation inside Greek sentences.
- Guard-phrase recognition reliability.
- Stability of final text after endpointing.
- API errors, rate limits, and recovery behavior.

## Technical Guidance for Downstream Work

- Add any new provider behind the existing provider-neutral `Transcriber` interface.
- Keep provider secrets canonical, for example `GLADIA_API_KEY`, `ASSEMBLYAI_API_KEY`, `OPENAI_API_KEY`, `AWS_*`, `AZURE_SPEECH_*`, or `GOOGLE_APPLICATION_CREDENTIALS`.
- Do not add fallback API keys or implicit local service defaults.
- For local providers, require explicit endpoint configuration and raise a typed configuration error if the endpoint is missing or unreachable.
- Prefer WebSocket JSON providers first because they map most directly to the current Soniox/ElevenLabs architecture.
- For AWS/Google/Azure, isolate SDK-specific lifecycle and credential handling in provider-specific modules.

## References

- Gladia Live STT session API, accessed 2026-05-16: https://docs.gladia.io/api-reference/v2/live/init
- Gladia supported languages, accessed 2026-05-16: https://docs.gladia.io/chapters/language/supported-languages
- Gladia code switching, accessed 2026-05-16: https://docs.gladia.io/chapters/language/code-switching
- Gladia live transcription features, accessed 2026-05-16: https://docs.gladia.io/chapters/live-stt/features
- OpenAI Realtime transcription guide, accessed 2026-05-16: https://developers.openai.com/api/docs/guides/realtime-transcription
- OpenAI Speech to Text guide, accessed 2026-05-16: https://developers.openai.com/api/docs/guides/speech-to-text
- AssemblyAI Whisper Streaming, accessed 2026-05-16: https://www.assemblyai.com/docs/streaming/whisper-streaming
- AssemblyAI Universal Streaming multilingual transcription, accessed 2026-05-16: https://www.assemblyai.com/docs/streaming/universal-streaming/multilingual-transcription
- AWS Transcribe streaming language identification, accessed 2026-05-16: https://docs.aws.amazon.com/transcribe/latest/dg/lang-id-stream.html
- AWS Transcribe streaming transcription in additional languages, accessed 2026-05-16: https://aws.amazon.com/about-aws/whats-new/2024/10/amazon-transcribe-streaming-transcription-additional-languages/
- AWS Transcribe streaming audio guide, accessed 2026-05-16: https://docs.aws.amazon.com/transcribe/latest/dg/streaming.html
- Azure AI Speech language support, accessed 2026-05-16: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support
- Azure AI Speech language identification, accessed 2026-05-16: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-identification
- Google Cloud Speech-to-Text V2 supported languages, accessed 2026-05-16: https://docs.cloud.google.com/speech-to-text/docs/speech-to-text-supported-languages
- Google Cloud Speech-to-Text automatic language detection, accessed 2026-05-16: https://docs.cloud.google.com/speech-to-text/docs/multiple-languages
- Google Cloud Speech-to-Text streaming recognition, accessed 2026-05-16: https://docs.cloud.google.com/speech-to-text/docs/streaming-recognize
- Speechmatics docs home / realtime overview, accessed 2026-05-16: https://docs.speechmatics.com/
- Speechmatics languages and models, accessed 2026-05-16: https://docs.speechmatics.com/speech-to-text/languages
- Deepgram models and languages overview, accessed 2026-05-16: https://developers.deepgram.com/docs/models-languages-overview
- Deepgram language behavior, accessed 2026-05-16: https://developers.deepgram.com/docs/language
- Groq Speech to Text docs, accessed 2026-05-16: https://console.groq.com/docs/speech-to-text
- Mistral realtime transcription docs, accessed 2026-05-16: https://docs.mistral.ai/studio-api/audio/speech_to_text/realtime_transcription
- Mistral audio and transcription docs, accessed 2026-05-16: https://docs.mistral.ai/capabilities/audio
- Mistral Voxtral Realtime model card, accessed 2026-05-16: https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602
- OpenAI Whisper GitHub repository, accessed 2026-05-16: https://github.com/openai/whisper
- WhisperLiveKit PyPI page, accessed 2026-05-16: https://pypi.org/project/whisperlivekit/
- whisper.cpp GitHub repository, accessed 2026-05-16: https://github.com/ggml-org/whisper.cpp
- faster-whisper GitHub repository, accessed 2026-05-16: https://github.com/SYSTRAN/faster-whisper
- Vosk GitHub repository, accessed 2026-05-16: https://github.com/alphacep/vosk-api
- Vosk model list, accessed 2026-05-16: https://alphacephei.com/vosk/models
- Vosk Greek model issue, accessed 2026-05-16: https://github.com/alphacep/vosk-api/issues/1649
- Hugging Face Transformers MMS docs, accessed 2026-05-16: https://huggingface.co/docs/transformers/main/en/model_doc/mms
- NVIDIA NeMo ASR docs, accessed 2026-05-16: https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/asr/intro.html

## Assumptions

- The target use case is live dictation/command transcription from the user's microphone, not offline file transcription.
- Greek-English mixing means intra-sentence English technical words and occasional English clauses inside mostly Greek speech.
- The project should keep Soniox as default unless a benchmark shows another provider is clearly better.
- "Working" means documented and technically integrable, not live-verified with credentials in this pass.

## Open Questions

- Which providers does the user already have accounts/API keys for?
- Is privacy/offline operation important enough to prioritize local Whisper over hosted APIs?
- What latency is acceptable for the Greek-English command workflow?
- Should the next step be a benchmark harness before implementation, or a provider spike for Gladia first?

## Original Request

> I want you to examine which other speech-to-text APIs are working to consider as alternatives to Soniox and ElevenLabs. Please remember that I need to transcribe Greek mixed with English words. Also, examine not only commercial products and options, but also open-source products; in that case, I expect it may not be an API, but most likely a locally deployed, running model.
