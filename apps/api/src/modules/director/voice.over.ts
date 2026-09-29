import type { CuePointSnapshot } from './track.measurement.js';

/**
 * Where a break may be spoken OVER a record instead of in the silence between two.
 *
 * aitalks: an ordinary break always sat in the gap. A talk-over existed only for an interrupting
 * request, and always started 30 seconds into the record behind it. This decides, for a break that
 * is ready and whose length is known, whether it fits over the tail of the record before it, over
 * the intro of the record after it, or neither, from the four measured cue points of each.
 *
 * Pure, because the answer is a few subtractions and every one of them wants a test: a break that
 * starts a second too late runs over the next record's first verse, which is a fault every
 * listener hears.
 */

export const VOICE_OVER_MODES = ['off', 'intro', 'outro', 'both'] as const;
export type VoiceOverMode = (typeof VOICE_OVER_MODES)[number];

export const VOICE_OVER_KEY = 'rotation.voiceOver';

export const DEFAULT_VOICE_OVER_MODE: VoiceOverMode = 'both';

/** The kinds of break that may ride a record. A bulletin, a call or a programme keeps its own silence. */
export const VOICE_OVER_KINDS: ReadonlySet<string> = new Set(['talkbreak']);

/** How long before a record's end the speech should be done, so the last word is not on the seam. */
export const END_MARGIN_MS = 1_500;

/**
 * How far past the start of the outro a break may begin.
 *
 * The outro is where a record is winding down, and speech that starts a few seconds before it is
 * still under a fade rather than over a chorus. Further than this and the voice is on top of the
 * song's last verse.
 */
export const OUTRO_LEAD_MS = 3_000;

/** How far into the incoming record the voice starts: enough for the duck's ramp to have finished. */
export const INTRO_START_MS = 600;

/** How far past the end of the intro a break may run. A held note under the first vocal word is fine, a sentence is not. */
export const INTRO_OVERRUN_MS = 1_500;

export type VoiceOverPlan = { over: 'outro'; atMs: number } | { over: 'intro'; atMs: number };

export interface VoiceOverInput {
    mode: VoiceOverMode;
    /** How long the break speaks. Unknown means it cannot be placed over anything. */
    speechMs: number | undefined;
    /** The record before the break, when it is one this break can still ride. */
    previous?: CuePointSnapshot;
    /** The record after the break. */
    next?: CuePointSnapshot;
}

const complete = (points: CuePointSnapshot | undefined): points is Required<CuePointSnapshot> =>
    points !== undefined &&
    points.cueInMs !== undefined &&
    points.introEndMs !== undefined &&
    points.outroStartMs !== undefined &&
    points.cueOutMs !== undefined;

/**
 * `undefined` means the break stays in the gap, which is always the safe answer: a missing
 * measurement, a break longer than the room, or a mode of `off`.
 *
 * With `both`, the end of the previous record is tried first, because it is the one that keeps the
 * next record's opening clean.
 */
export function planVoiceOver({ mode, speechMs, previous, next }: VoiceOverInput): VoiceOverPlan | undefined {
    if (mode === 'off' || speechMs === undefined || speechMs <= 0) return undefined;

    if ((mode === 'outro' || mode === 'both') && complete(previous)) {
        const played = previous.cueOutMs - previous.cueInMs;
        const outroStart = previous.outroStartMs - previous.cueInMs;
        const atMs = played - speechMs - END_MARGIN_MS;
        if (atMs >= outroStart - OUTRO_LEAD_MS && atMs > 0) return { over: 'outro', atMs: Math.round(atMs) };
    }

    if ((mode === 'intro' || mode === 'both') && complete(next)) {
        const intro = next.introEndMs - next.cueInMs;
        if (INTRO_START_MS + speechMs <= intro + INTRO_OVERRUN_MS) return { over: 'intro', atMs: INTRO_START_MS };
    }

    return undefined;
}

/** A setting arrives as a string, and anything unknown is the default rather than an error. */
export function voiceOverModeOf(raw: string | undefined): VoiceOverMode {
    const value = raw?.trim().toLowerCase();
    return (VOICE_OVER_MODES as readonly string[]).includes(value ?? '') ? (value as VoiceOverMode) : DEFAULT_VOICE_OVER_MODE;
}
