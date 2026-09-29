import { parseRows, PLUGIN_CAPABILITY_SPEECH, type PluginManifest } from '@deadair/plugin-sdk';
import { z } from 'zod';

export const PLUGIN_ID = 'aitalks.elevenlabs';
export const PLUGIN_VERSION = '0.1.0';

export const BASE_URL = 'https://api.elevenlabs.io/v1';
export const DEFAULT_MODEL = 'eleven_v4';
export const OUTPUT_FORMAT = 'mp3_44100_128';
export const SPEAK_TIMEOUT_MS = 90_000;
export const PROBE_TIMEOUT_MS = 8_000;

export const VOICES_FIELD = 'voices';
export const VOICE_NAME_COLUMN = 'name';
export const VOICE_ID_COLUMN = 'voiceId';

export type VoiceMap = Record<string, string>;

export function voiceMapOf(raw: unknown): VoiceMap {
    const voices: VoiceMap = {};
    for (const row of parseRows(raw)) {
        const name = row[VOICE_NAME_COLUMN]?.trim();
        const id = row[VOICE_ID_COLUMN]?.trim();
        if (name && id) voices[name] = id;
    }
    return voices;
}

const rowsComplete = (raw: unknown): boolean =>
    raw === undefined || parseRows(raw).every(row => Boolean(row[VOICE_NAME_COLUMN]?.trim()) && Boolean(row[VOICE_ID_COLUMN]?.trim()));

export const configSchema = z.object({
    apiKey: z.string().optional(),
    model: z.string().optional(),
    defaultVoiceId: z.string().optional(),
    [VOICES_FIELD]: z.string().optional().refine(rowsComplete, { message: 'every voice needs both a station name and an ElevenLabs voice id' }),
});

export const elevenLabsManifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'ElevenLabs',
    version: PLUGIN_VERSION,
    capabilities: [PLUGIN_CAPABILITY_SPEECH],
    apiVersion: '^1.0.0',
    description: 'Gives the station a voice through ElevenLabs. Eleven v4 reads audio tags, so a laugh written into a script is performed rather than read out.',
    homepage: 'https://elevenlabs.io/docs',
    permissions: {
        network: ['api.elevenlabs.io'],
        storage: false,
        oauth: false,
    },
    configFields: [
        { key: 'apiKey', label: 'API key', type: 'secret', required: true, help: 'From elevenlabs.io, under your profile. Stored encrypted.' },
        {
            key: 'model',
            label: 'Model',
            type: 'string',
            default: DEFAULT_MODEL,
            help: 'eleven_v4 performs audio tags and speaks Russian. eleven_multilingual_v2 is cheaper and ignores the tags.',
        },
        {
            key: 'defaultVoiceId',
            label: 'Default voice id',
            type: 'string',
            help: 'Used for anything the station has no mapping for. A voice id from your Voice Library.',
        },
        {
            key: VOICES_FIELD,
            label: 'Voices',
            type: 'list',
            placeholder: 'No voices yet, so everything the station says uses the default.',
            help: 'The station asks for its own names and this says which ElevenLabs voice each one is. A name is what a persona points at.',
            columns: [
                { key: VOICE_NAME_COLUMN, label: 'Station voice', type: 'string', required: true, placeholder: 'spark' },
                { key: VOICE_ID_COLUMN, label: 'Voice id', type: 'string', required: true, placeholder: 'JBFqnCBsd6RMkjVDRZzb' },
            ],
        },
    ],
    configSchema,
};
