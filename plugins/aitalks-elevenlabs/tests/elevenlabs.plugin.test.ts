import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@deadair/plugin-sdk/testing';
import { tagged } from '../src/elevenlabs.cues.js';
import { ElevenLabsPlugin, performsTags } from '../src/elevenlabs.plugin.js';

const audio = (size = 4096): Uint8Array<ArrayBuffer> => new Uint8Array(size).fill(7);

async function started(config: Record<string, unknown> = {}, apiKey: string | null = 'xi-test') {
    const host = createFakePluginHost();
    host.seedConfig({ voices: JSON.stringify([{ name: 'spark', voiceId: 'VOICE-SPARK' }]), defaultVoiceId: 'VOICE-DEFAULT', ...config });
    if (apiKey !== null) host.seedSecret('apiKey', apiKey);
    const plugin = new ElevenLabsPlugin();
    await plugin.init(host);
    return { host, plugin };
}

describe('tags', () => {
    it('renames station cues into Eleven audio tags and puts a delivery up front', () => {
        expect(tagged('Ну да [laugh] конечно [clear throat] ладно')).toBe('Ну да [laughs] конечно [clears throat] ладно');
        expect(tagged('тише', 'hushed')).toBe('[whispers] тише');
    });

    it('claims them only on models that perform them', () => {
        expect(performsTags('eleven_v4')).toBe(true);
        expect(performsTags('eleven_v3')).toBe(true);
        expect(performsTags('eleven_multilingual_v2')).toBe(false);
    });
});

describe('speak', () => {
    it('sends the mapped voice, the model, the language and the tagged text', async () => {
        const { host, plugin } = await started();
        host.queueResponse({ headers: { 'content-type': 'audio/mpeg' }, body: audio() });
        const handle = await plugin.speak({ text: 'Привет [laugh] эфир', voice: 'spark', language: 'ru-RU' });
        expect(handle.mime).toBe('audio/mpeg');
        const call = host.calls[0]!;
        expect(call.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/VOICE-SPARK?output_format=mp3_44100_128');
        expect(call.headers?.['xi-api-key']).toBe('xi-test');
        expect(JSON.parse(call.body!)).toEqual({ text: 'Привет [laughs] эфир', model_id: 'eleven_v4', language_code: 'ru' });
        // Drain, so the plausibility check sees the bytes.
        let total = 0;
        for await (const chunk of handle.audio) total += chunk.length;
        expect(total).toBe(4096);
    });

    it('falls back to the default voice for an unmapped name', async () => {
        const { host, plugin } = await started();
        host.queueResponse({ body: audio() });
        await plugin.speak({ text: 'x', voice: 'nobody' });
        expect(host.calls[0]!.url).toContain('/text-to-speech/VOICE-DEFAULT?');
    });

    it('refuses without a key, and reports an upstream failure with its status', async () => {
        const { plugin: unkeyed } = await started({}, null);
        await expect(unkeyed.speak({ text: 'x' })).rejects.toThrow(/API key/);
        const { host, plugin } = await started();
        host.queueResponse({ status: 401, body: '{}' });
        await expect(plugin.speak({ text: 'x', voice: 'spark' })).rejects.toThrow(/HTTP 401/);
    });
});

describe('cues offered', () => {
    it('all eight on v4, none on multilingual v2', async () => {
        expect((await (await started()).plugin.listCues()).length).toBe(8);
        expect(await (await started({ model: 'eleven_multilingual_v2' })).plugin.listCues()).toEqual([]);
    });
});
