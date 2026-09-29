import { SPEECH_CUES, type SpeechCue, type SpeechDelivery } from '@deadair/plugin-sdk';

/**
 * The station's cue vocabulary as Gemini 3.8 TTS spells it: angle-bracket tags at the point the
 * sound happens. All eight have a tag, so `listCues` answers with all eight.
 */
const TAGS: Record<SpeechCue, string> = {
    laugh: '<laugh>',
    chuckle: '<chuckle>',
    sigh: '<sigh>',
    gasp: '<gasp>',
    cough: '<cough>',
    'clear throat': '<throat-clearing>',
    sniff: '<sniff>',
    groan: '<groan>',
};

export function tagged(text: string): string {
    let out = text;
    for (const cue of SPEECH_CUES) out = out.replaceAll(new RegExp(`\\[${cue}\\]`, 'gi'), TAGS[cue]);
    return out;
}

/**
 * A delivery is not a tag on this engine but a sustained style, sent as `speech_metadata` beside the
 * text. The persona's own style line (from the voice table) comes first, the delivery narrows it.
 */
export function styleFor(base: string | undefined, delivery?: SpeechDelivery): string | undefined {
    const parts = [base?.trim(), delivery === 'hushed' ? 'hushed, intimate, almost whispering' : delivery === 'frantic' ? 'fast, breathless, excited' : undefined].filter(
        (p): p is string => Boolean(p),
    );
    return parts.length === 0 ? undefined : parts.join('; ');
}
