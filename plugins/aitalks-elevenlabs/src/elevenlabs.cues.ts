import { SPEECH_CUES, type SpeechCue, type SpeechDelivery } from '@deadair/plugin-sdk';

/**
 * The station's cue vocabulary as Eleven v4 spells it: audio tags in square brackets, placed where
 * the sound happens. The station writes `[laugh]`, which happens to be bracketed already, so this is
 * a rename rather than a re-wrap. Every cue has a tag, so `listCues` answers with all eight.
 */
const TAGS: Record<SpeechCue, string> = {
    laugh: '[laughs]',
    chuckle: '[chuckles]',
    sigh: '[sighs]',
    gasp: '[gasps]',
    cough: '[coughs]',
    'clear throat': '[clears throat]',
    sniff: '[sniffs]',
    groan: '[groans]',
};

/** A delivery is a tag too, at the head of the line so it colours the whole reading. */
const DELIVERIES: Record<SpeechDelivery, string> = {
    hushed: '[whispers]',
    frantic: '[excited]',
};

export function tagged(text: string, delivery?: SpeechDelivery): string {
    let out = text;
    for (const cue of SPEECH_CUES) out = out.replaceAll(new RegExp(`\\[${cue}\\]`, 'gi'), TAGS[cue]);
    return delivery === undefined ? out : `${DELIVERIES[delivery]} ${out}`;
}
