import { parseRows, PLUGIN_CAPABILITY_SPEECH, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'aitalks.gemini-tts';
export const PLUGIN_VERSION = '0.1.0';

export const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL = 'gemini-3.8-flash-tts';
export const DEFAULT_VOICE = 'Kore';
export const SPEAK_TIMEOUT_MS = 90_000;
export const PROBE_TIMEOUT_MS = 8_000;

/** The prebuilt voices the docs list. Offered as suggestions; any name the API takes is accepted. */
export const PREBUILT_VOICES = [
    'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
    'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
    'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
];

export const VOICES_FIELD = 'voices';
export const VOICE_NAME_COLUMN = 'name';
export const VOICE_ENGINE_COLUMN = 'engine';
export const VOICE_STYLE_COLUMN = 'style';

export interface VoiceMapping {
    engine: string;
    style?: string;
}
export type VoiceMap = Record<string, VoiceMapping>;

export function voiceMapOf(raw: unknown): VoiceMap {
    const voices: VoiceMap = {};
    for (const row of parseRows(raw)) {
        const name = row[VOICE_NAME_COLUMN]?.trim();
        const engine = row[VOICE_ENGINE_COLUMN]?.trim();
        if (!name || !engine) continue;
        const style = row[VOICE_STYLE_COLUMN]?.trim();
        voices[name] = { engine, ...(style ? { style } : {}) };
    }
    return voices;
}

const rowsComplete = (raw: unknown): boolean =>
    raw === undefined || parseRows(raw).every(row => Boolean(row[VOICE_NAME_COLUMN]?.trim()) && Boolean(row[VOICE_ENGINE_COLUMN]?.trim()));

export const configSchema = z.object({
    apiKey: z.string().optional(),
    model: z.string().optional(),
    defaultVoice: z.string().optional(),
    [VOICES_FIELD]: z.string().optional().refine(rowsComplete, { message: 'every voice needs both a station name and a Gemini voice' }),
});

export const geminiTtsManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Gemini TTS',
    version: PLUGIN_VERSION,
    capabilities: [PLUGIN_CAPABILITY_SPEECH],
    apiVersion: '^1.0.0',
    description: 'Gives the station a voice through Gemini Flash TTS. Reads inline tags, so a laugh written into a script is performed, and takes a style line per voice.',
    homepage: 'https://ai.google.dev/gemini-api/docs/speech-generation',
    permissions: {
        network: ['generativelanguage.googleapis.com'],
        storage: false,
        oauth: false,
    },
    configFields: [
        { key: 'apiKey', label: 'API key', type: 'secret', required: true, help: 'From aistudio.google.com. Stored encrypted.' },
        { key: 'model', label: 'Model', type: 'string', default: DEFAULT_MODEL, help: 'gemini-3.8-flash-tts, or the lite one for a cheaper read.' },
        { key: 'defaultVoice', label: 'Default voice', type: 'string', default: DEFAULT_VOICE, help: 'Used for anything the station has no mapping for. One of the prebuilt voice names.' },
        {
            key: VOICES_FIELD,
            label: 'Voices',
            type: 'list',
            placeholder: 'No voices yet, so everything the station says uses the default.',
            help: 'The station asks for its own names and this says which Gemini voice each one is, and how it should sound. The style is a short direction in plain words, sent with every line.',
            columns: [
                { key: VOICE_NAME_COLUMN, label: 'Station voice', type: 'string', required: true, placeholder: 'spark' },
                { key: VOICE_ENGINE_COLUMN, label: 'Gemini voice', type: 'string', required: true, placeholder: 'Zephyr' },
                { key: VOICE_STYLE_COLUMN, label: 'Style', type: 'string', placeholder: 'bright, warm, energetic radio host' },
            ],
        },
    ],
    configSchema,
};
