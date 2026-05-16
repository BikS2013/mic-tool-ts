export type MarkerKind =
  | "state_command"
  | "section_end"
  | "section_cancel"
  | "literal_next";

export interface MarkerDefinition {
  kind: MarkerKind;
  phrases: readonly string[];
}

export interface MarkerMatch {
  kind: MarkerKind;
  phrase: string;
  start: number;
  end: number;
}

interface NormalizedText {
  normalized: string;
  map: number[];
}

export function normalizeOrdinaryMarker(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/ς/g, "σ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function findFirstMarker(
  text: string,
  definitions: readonly MarkerDefinition[],
  startAt = 0,
): MarkerMatch | null {
  let best: MarkerMatch | null = null;
  for (const def of definitions) {
    for (const phrase of def.phrases) {
      const match = phrase.trim().startsWith("/")
        ? findSlashPhrase(text, phrase, def.kind, startAt)
        : findOrdinaryPhrase(text, phrase, def.kind, startAt);
      if (match === null) continue;
      if (
        best === null ||
        match.start < best.start ||
        (match.start === best.start && match.end > best.end)
      ) {
        best = match;
      }
    }
  }
  return best;
}

export function stripMarkersForDisplay(
  text: string,
  definitions: readonly MarkerDefinition[],
): string {
  let out = text;
  let searchStart = 0;
  while (searchStart < out.length) {
    const match = findFirstMarker(out, definitions, searchStart);
    if (match === null) break;
    const commandEnd =
      match.kind === "state_command"
        ? consumeCommandArgs(out, match.end).end
        : match.end;
    out = `${out.slice(0, match.start)} ${out.slice(commandEnd)}`;
    searchStart = match.start;
  }
  return normalizePayloadWhitespace(out);
}

export function normalizePayloadWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function consumeCommandArgs(
  text: string,
  start: number,
): { operator?: string; value?: string; end: number } {
  const after = text.slice(start);
  const match = after.match(/^\s*([^\s.,;:!?]+)?(?:\s+([^\s.,;:!?]+))?/u);
  if (match === null) return { end: start };
  const operator = match[1];
  const valueCandidate = match[2]?.toLowerCase();
  const value =
    valueCandidate === "on" || valueCandidate === "off"
      ? valueCandidate
      : undefined;
  const consumed =
    value === undefined
      ? /^\s*([^\s.,;:!?]+)?/u.exec(after)?.[0]
      : match[0];
  return {
    operator,
    value,
    end: start + (consumed?.length ?? 0),
  };
}

function findSlashPhrase(
  text: string,
  phrase: string,
  kind: MarkerKind,
  startAt: number,
): MarkerMatch | null {
  const needle = phrase.trim().toLowerCase();
  if (needle.length === 0) return null;
  const haystack = text.toLowerCase();
  let idx = Math.max(0, startAt);
  while (idx < haystack.length) {
    const found = haystack.indexOf(needle, idx);
    if (found < 0) return null;
    const before = found === 0 ? "" : text[found - 1] ?? "";
    const after = text[found + needle.length] ?? "";
    if (!isLetterOrNumber(before) && !isLetterOrNumber(after)) {
      return {
        kind,
        phrase,
        start: found,
        end: found + needle.length,
      };
    }
    idx = found + 1;
  }
  return null;
}

function findOrdinaryPhrase(
  text: string,
  phrase: string,
  kind: MarkerKind,
  startAt: number,
): MarkerMatch | null {
  const phraseNorm = normalizeOrdinaryMarker(phrase);
  if (phraseNorm.length === 0) return null;
  const normalized = normalizeWithMap(text);
  const startNorm = originalIndexToNormalizedIndex(normalized, startAt);
  let idx = startNorm;
  while (idx <= normalized.normalized.length) {
    const found = normalized.normalized.indexOf(phraseNorm, idx);
    if (found < 0) return null;
    const before = found === 0 ? " " : normalized.normalized[found - 1] ?? " ";
    const after =
      found + phraseNorm.length >= normalized.normalized.length
        ? " "
        : normalized.normalized[found + phraseNorm.length] ?? " ";
    if (before === " " && after === " ") {
      const firstOriginal = normalized.map[found];
      const lastOriginal = normalized.map[found + phraseNorm.length - 1];
      if (firstOriginal !== undefined && lastOriginal !== undefined) {
        return {
          kind,
          phrase,
          start: firstOriginal,
          end: lastOriginal + 1,
        };
      }
    }
    idx = found + 1;
  }
  return null;
}

function normalizeWithMap(text: string): NormalizedText {
  const chars: string[] = [];
  const map: number[] = [];
  let lastWasSpace = true;

  for (let i = 0; i < text.length; i++) {
    const raw = text[i] ?? "";
    const stripped = raw
      .normalize("NFD")
      .replace(/\p{M}+/gu, "")
      .toLowerCase()
      .replace(/ς/g, "σ");
    if (/^[\p{L}\p{N}]$/u.test(stripped)) {
      chars.push(stripped);
      map.push(i);
      lastWasSpace = false;
    } else if (!lastWasSpace) {
      chars.push(" ");
      map.push(i);
      lastWasSpace = true;
    }
  }

  while (chars.length > 0 && chars[chars.length - 1] === " ") {
    chars.pop();
    map.pop();
  }

  return { normalized: chars.join(""), map };
}

function originalIndexToNormalizedIndex(
  normalized: NormalizedText,
  originalIndex: number,
): number {
  const idx = normalized.map.findIndex((mapped) => mapped >= originalIndex);
  return idx < 0 ? normalized.normalized.length : idx;
}

function isLetterOrNumber(ch: string): boolean {
  return ch.length > 0 && /^[\p{L}\p{N}]$/u.test(ch);
}
