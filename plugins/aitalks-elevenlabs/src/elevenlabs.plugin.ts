import {
    configString,
    errorText,
    plausibleAudio,
    Plugin,
    PluginError,
    SPEECH_CUES,
    SPEECH_DELIVERIES,
    tryJsonBody,
    type ConfigFieldOption,
    type PluginConnectionResult,
    type SpeechCue,
    type SpeechDelivery,
    type SpeechHandle,
    type SpeechPluginInstance,
    type SpeechRequest,
    type SpeechVoice,
} from '@deadair/plugin-sdk';
import { tagged } from './elevenlabs.cues.js';
import {
    BASE_URL,
    DEFAULT_MODEL,
    OUTPUT_FORMAT,
    PROBE_TIMEOUT_MS,
    SPEAK_TIMEOUT_MS,
    VOICE_ID_COLUMN,
    VOICES_FIELD,
    elevenLabsManifest,
    voiceMapOf,
    type VoiceMap,
} from './elevenlabs.manifest.js';

export { elevenLabsManifest };

/**
 * Text to speech through ElevenLabs.
 *
 * The station's cues and deliveries become Eleven v4 audio tags on the way out (`elevenlabs.cues.ts`),
 * and that is the whole reason this is its own plugin rather than the generic OpenAI-shaped one: the
 * generic plugin claims no cues, so the host strips every `[laugh]` before it is ever sent.
 */
export class ElevenLabsPlugin extends Plugin implements SpeechPluginInstance {
    private apiKey?: string;
    private model = DEFAULT_MODEL;
    private defaultVoiceId?: string;
    private voices: VoiceMap = {};

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();
        this.model = configString(config.model) ?? DEFAULT_MODEL;
        this.defaultVoiceId = configString(config.defaultVoiceId);
        this.voices = voiceMapOf(config[VOICES_FIELD]);
        // A pasted key often carries a trailing newline, which turns into a 401 that looks like a bad key.
        this.apiKey = (await this.host.secrets.get('apiKey'))?.trim();
        this.host.logger.info('elevenlabs ready', { model: this.model, voices: Object.keys(this.voices).length, configured: Boolean(this.apiKey), keyLength: this.apiKey?.length ?? 0 });
    }

    async testConnection(): Promise<PluginConnectionResult> {
        if (!this.apiKey) return { ok: false, message: 'No API key set.' };
        let response: Response;
        try {
            response = await this.host.fetch(`${BASE_URL}/models`, { headers: this.headers(), timeoutMs: PROBE_TIMEOUT_MS });
        } catch (error) {
            return { ok: false, message: `Could not reach ElevenLabs: ${errorText(error)}` };
        }
        if (!response.ok) {
            const reason = await reasonOf(response);
            // A key scoped to text-to-speech alone is a valid key: it just may not list models. The
            // speak call is what proves it, and refusing to enable a working key over a probe is worse.
            if (response.status === 401 && reason.includes('missing_permissions')) {
                return { ok: true, message: `Key accepted, but it cannot list models (${reason.slice(2)}). Speaking does not need that.` };
            }
            return { ok: false, message: `ElevenLabs answered HTTP ${response.status}${reason}` };
        }
        const models = (await tryJsonBody<Array<{ model_id?: string }>>(response)) ?? [];
        const known = models.some(m => m.model_id === this.model);
        return { ok: true, message: known ? `Connected. Model ${this.model} is available.` : `Connected, but ${this.model} is not in the model list; check the model field.` };
    }

    async listVoices(): Promise<SpeechVoice[]> {
        const mapped = Object.entries(this.voices).map(([id, voiceId]) => ({ id, label: id, description: `ElevenLabs voice ${voiceId}`, spec: voiceId }));
        return [{ id: '', label: 'Default', description: this.defaultVoiceId ? `ElevenLabs voice ${this.defaultVoiceId}` : 'No default voice set', spec: this.defaultVoiceId ?? '' }, ...mapped];
    }

    // Every cue has a tag, and every delivery; the v4 models perform them all.
    async listCues(): Promise<readonly SpeechCue[]> {
        return performsTags(this.model) ? [...SPEECH_CUES] : [];
    }

    async listDeliveries(): Promise<readonly SpeechDelivery[]> {
        return performsTags(this.model) ? [...SPEECH_DELIVERIES] : [];
    }

    async listLanguages(): Promise<readonly string[]> {
        // Every model this plugin is pointed at speaks Russian and English; the full list is the
        // model's business and the host only warns when the station language is absent here.
        return ['ru', 'en'];
    }

    async suggestConfigOptions(): Promise<Record<string, ConfigFieldOption[]>> {
        if (!this.apiKey) return {};
        try {
            const response = await this.host.fetch(`${BASE_URL}/voices`, { headers: this.headers(), timeoutMs: PROBE_TIMEOUT_MS });
            if (!response.ok) return {};
            const body = await tryJsonBody<{ voices?: Array<{ voice_id?: string; name?: string }> }>(response);
            const options = (body?.voices ?? []).flatMap(v => (v.voice_id ? [{ value: v.voice_id, label: v.name ? `${v.name} (${v.voice_id})` : v.voice_id }] : []));
            return options.length === 0 ? {} : { defaultVoiceId: options, [`${VOICES_FIELD}.${VOICE_ID_COLUMN}`]: options };
        } catch {
            return {};
        }
    }

    async speak(request: SpeechRequest): Promise<SpeechHandle> {
        if (!this.apiKey) throw new PluginError('elevenlabs has no API key configured').withCode('config');
        const voiceId = (request.voice && this.voices[request.voice]) || this.defaultVoiceId;
        if (!voiceId) throw new PluginError(`elevenlabs has no voice for "${request.voice ?? ''}" and no default`).withCode('config');
        const text = tagged(request.text.trim(), request.delivery);
        if (text.length === 0) throw new PluginError('elevenlabs was asked to say nothing').withCode('config');

        const response = await this.host.fetch(`${BASE_URL}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...this.headers() },
            body: JSON.stringify({ text, model_id: this.model, ...(request.language ? { language_code: request.language.split('-')[0] } : {}) }),
            timeoutMs: SPEAK_TIMEOUT_MS,
        });
        if (!response.ok || response.body === null) {
            const reason = await reasonOf(response);
            throw new PluginError(`elevenlabs answered HTTP ${response.status} for voice "${voiceId}"${reason}`)
                .withCode(response.status === 401 || response.status === 403 ? 'auth' : 'upstream')
                .withUpstreamStatus(response.status);
        }
        this.host.logger.debug('elevenlabs speaking', { voice: voiceId, model: this.model, chars: text.length });
        return {
            mime: 'audio/mpeg',
            audio: response.body.pipeThrough(plausibleAudio({ engine: 'elevenlabs', asked: `voice "${voiceId}"`, advice: 'check the voice id and the model' })),
        };
    }

    private headers(): Record<string, string> {
        return { 'xi-api-key': this.apiKey ?? '' };
    }
}

/** Tags are a v3/v4 feature; the older models read the words in the brackets out loud. */
export const performsTags = (model: string): boolean => /^eleven_v[34]/.test(model);

/** ElevenLabs says why in the body (`detail.status`, `detail.message`): a bad key and a key without the permission are different fixes. */
async function reasonOf(response: Response): Promise<string> {
    const body = await tryJsonBody<{ detail?: { status?: string; message?: string } | string }>(response);
    const detail = body?.detail;
    if (detail === undefined) return '.';
    return typeof detail === 'string' ? `: ${detail}` : `: ${[detail.status, detail.message].filter(Boolean).join(' — ')}`;
}
