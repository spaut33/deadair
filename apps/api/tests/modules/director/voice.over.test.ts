import { describe, expect, it } from 'vitest';
import { END_MARGIN_MS, INTRO_START_MS, planVoiceOver, voiceOverModeOf } from '../../../src/modules/director/voice.over.js';

// A record that starts at 0, has a 10 s intro, begins ending at 190 s and stops at 230 s: a 40 s outro.
const record = { cueInMs: 0, introEndMs: 10_000, outroStartMs: 190_000, cueOutMs: 230_000 };

describe('planVoiceOver', () => {
    it('puts a short break over the end of the previous record, finishing before the seam', () => {
        const plan = planVoiceOver({ mode: 'both', speechMs: 8_000, previous: record, next: record });

        expect(plan).toEqual({ over: 'outro', atMs: 230_000 - 8_000 - END_MARGIN_MS });
    });

    it('starts inside the outro, not on the last chorus', () => {
        // 60 s of speech against a 40 s outro would begin 20 s before the outro does.
        expect(planVoiceOver({ mode: 'outro', speechMs: 60_000, previous: record })).toBeUndefined();
    });

    it('falls back to the intro of the next record when the previous one has no room', () => {
        const cold = { cueInMs: 0, introEndMs: 10_000, outroStartMs: 229_000, cueOutMs: 230_000 };
        const plan = planVoiceOver({ mode: 'both', speechMs: 8_000, previous: cold, next: record });

        expect(plan).toEqual({ over: 'intro', atMs: INTRO_START_MS });
    });

    it('will not talk over an intro it does not fit into', () => {
        const short = { cueInMs: 0, introEndMs: 3_000, outroStartMs: 229_000, cueOutMs: 230_000 };

        expect(planVoiceOver({ mode: 'intro', speechMs: 12_000, next: short })).toBeUndefined();
    });

    it('allows a little overrun into the first vocal, and no more', () => {
        const next = { cueInMs: 0, introEndMs: 8_000, outroStartMs: 229_000, cueOutMs: 230_000 };

        expect(planVoiceOver({ mode: 'intro', speechMs: 8_800, next })).toEqual({ over: 'intro', atMs: INTRO_START_MS });
        expect(planVoiceOver({ mode: 'intro', speechMs: 10_000, next })).toBeUndefined();
    });

    it('respects the mode', () => {
        expect(planVoiceOver({ mode: 'off', speechMs: 5_000, previous: record, next: record })).toBeUndefined();
        expect(planVoiceOver({ mode: 'intro', speechMs: 5_000, previous: record, next: record })?.over).toBe('intro');
        expect(planVoiceOver({ mode: 'outro', speechMs: 5_000, previous: record, next: record })?.over).toBe('outro');
    });

    it('measures from the cue-in, not from the start of the file', () => {
        const trimmed = { cueInMs: 4_000, introEndMs: 14_000, outroStartMs: 194_000, cueOutMs: 234_000 };

        expect(planVoiceOver({ mode: 'outro', speechMs: 8_000, previous: trimmed })).toEqual({ over: 'outro', atMs: 230_000 - 8_000 - END_MARGIN_MS });
    });

    it('does nothing without measurements or without a known length', () => {
        expect(planVoiceOver({ mode: 'both', speechMs: 5_000 })).toBeUndefined();
        expect(planVoiceOver({ mode: 'both', speechMs: 5_000, previous: { cueInMs: 0 }, next: { introEndMs: 5_000 } })).toBeUndefined();
        expect(planVoiceOver({ mode: 'both', speechMs: undefined, previous: record, next: record })).toBeUndefined();
        expect(planVoiceOver({ mode: 'both', speechMs: 0, previous: record, next: record })).toBeUndefined();
    });
});

describe('voiceOverModeOf', () => {
    it('reads a setting string and falls back to both for anything else', () => {
        expect(voiceOverModeOf('intro')).toBe('intro');
        expect(voiceOverModeOf(' OUTRO ')).toBe('outro');
        expect(voiceOverModeOf('off')).toBe('off');
        expect(voiceOverModeOf('sideways')).toBe('both');
        expect(voiceOverModeOf(undefined)).toBe('both');
    });
});
