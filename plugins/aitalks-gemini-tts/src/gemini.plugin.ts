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
import { styleFor, tagged } from './gemini.cues.js';
import {
    BASE_URL,
    DEFAULT_MODEL,
    DEFAULT_VOICE,
    PREBUILT_VOICES,
    PROBE_TIMEOUT_MS,
    SPEAK_TIMEOUT_MS,
    VOICE_ENGINE_COLUMN,
    VOICES_FIELD,
    geminiTtsManifest,
    voiceMapOf,
    type VoiceMap,
    type VoiceMapping,
} from './gemini.manifest.js';

export { geminiTtsManifest };

/** The shape of an `interactions` answer, as far as this plugin reads it. */
interface InteractionResponse {
    output_audio?: { data?: string };
    steps?: Array<{ content?: Array<{ type?: string; data?: string }> }>;
}

/**
 * Text to speech through Gemini Flash TTS, over the `interactions` endpoint.
 *
 * The answer is base64 WAV in a JSON envelope rather than a body of audio bytes, so unlike the other
 * speech plugins this one holds one segment whole before handing it on. A break is a few seconds of
 * 24 kHz mono, so that is kilobytes, not a file.
 */
export class GeminiTtsPlugin extends Plugin implements SpeechPluginInstance {
    private apiKey?: string;
    private model = DEFAULT_MODEL;
    private defaultVoice = DEFAULT_VOICE;
    private voices: VoiceMap = {};

    protected async onLoad(): Promise<void> {
        const config = await this.host.config.get();
        this.model = configString(config.model) ?? DEFAULT_MODEL;
        this.defaultVoice = configString(config.defaultVoice) ?? DEFAULT_VOICE;
        this.voices = voiceMapOf(config[VOICES_FIELD]);
        this.apiKey = await this.host.secrets.get('apiKey');
        this.host.logger.info('gemini tts ready', { model: this.model, voices: Object.keys(this.voices).length, configured: Boolean(this.apiKey) });
    }

    async testConnection(): Promise<PluginConnectionResult> {
        if (!this.apiKey) return { ok: false, message: 'No API key set.' };
        let response: Response;
        try {
            response = await this.host.fetch(`${BASE_URL}/models/${encodeURIComponent(this.model)}`, { headers: this.headers(), timeoutMs: PROBE_TIMEOUT_MS });
        } catch (error) {
            return { ok: false, message: `Could not reach Gemini: ${errorText(error)}` };
        }
        if (response.status === 404) return { ok: false, message: `Gemini has no model called ${this.model}.` };
        if (!response.ok) return { ok: false, message: `Gemini answered HTTP ${response.status}.` };
        await tryJsonBody(response);
        return { ok: true, message: `Connected. Model ${this.model} is available.` };
    }

    async listVoices(): Promise<SpeechVoice[]> {
        const mapped = Object.entries(this.voices).map(([id, mapping]) => ({ id, label: id, description: describe(mapping), spec: mapping.engine }));
        return [{ id: '', label: 'Default', description: describe({ engine: this.defaultVoice }), spec: this.defaultVoice }, ...mapped];
    }

    async listCues(): Promise<readonly SpeechCue[]> {
        return [...SPEECH_CUES];
    }

    async listDeliveries(): Promise<readonly SpeechDelivery[]> {
        return [...SPEECH_DELIVERIES];
    }

    async listLanguages(): Promise<readonly string[]> {
        return ['ru', 'en'];
    }

    async suggestConfigOptions(): Promise<Record<string, ConfigFieldOption[]>> {
        const options = PREBUILT_VOICES.map(value => ({ value, label: value }));
        return { defaultVoice: options, [`${VOICES_FIELD}.${VOICE_ENGINE_COLUMN}`]: options };
    }

    async speak(request: SpeechRequest): Promise<SpeechHandle> {
        if (!this.apiKey) throw new PluginError('gemini tts has no API key configured').withCode('config');
        const mapping = (request.voice && this.voices[request.voice]) || { engine: this.defaultVoice };
        const text = tagged(request.text.trim());
        if (text.length === 0) throw new PluginError('gemini tts was asked to say nothing').withCode('config');
        const style = styleFor(mapping.style, request.delivery);

        const response = await this.host.fetch(`${BASE_URL}/interactions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...this.headers() },
            body: JSON.stringify({
                model: this.model,
                input: [{ type: 'user_input', content: [{ type: 'text', text, ...(style ? { annotations: [{ type: 'speech_metadata', style }] } : {}) }] }],
                response_format: { type: 'audio' },
                generation_config: { speech_config: [{ voice: mapping.engine, ...(request.language ? { language: request.language } : {}) }] },
            }),
            timeoutMs: SPEAK_TIMEOUT_MS,
        });
        if (!response.ok) {
            const detail = (await response.text().catch(() => '')).slice(0, 300);
            throw new PluginError(`gemini tts answered HTTP ${response.status} for voice "${mapping.engine}": ${detail}`)
                .withCode(response.status === 401 || response.status === 403 ? 'auth' : 'upstream')
                .withUpstreamStatus(response.status);
        }
        const body = await tryJsonBody<InteractionResponse>(response);
        const data = audioOf(body);
        if (data === undefined) throw new PluginError('gemini tts returned no audio').withCode('upstream');
        const bytes = Buffer.from(data, 'base64');
        this.host.logger.debug('gemini tts speaking', { voice: mapping.engine, model: this.model, chars: text.length, bytes: bytes.length, ...(style ? { style } : {}) });
        return {
            mime: 'audio/wav',
            audio: new Blob([bytes]).stream().pipeThrough(plausibleAudio({ engine: 'gemini', asked: `voice "${mapping.engine}"`, advice: 'check the voice name and the model' })),
        };
    }

    private headers(): Record<string, string> {
        return { 'x-goog-api-key': this.apiKey ?? '' };
    }
}

/** Where the audio sits in the answer: the documented `output_audio`, or the last audio step. */
export function audioOf(body: InteractionResponse | undefined): string | undefined {
    if (body?.output_audio?.data) return body.output_audio.data;
    const blocks = body?.steps?.flatMap(step => step.content ?? []).filter(block => block.type === 'audio' && block.data) ?? [];
    return blocks.at(-1)?.data;
}

const describe = (mapping: VoiceMapping): string => (mapping.style ? `Gemini voice ${mapping.engine}, ${mapping.style}` : `Gemini voice ${mapping.engine}`);
