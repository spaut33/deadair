import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@deadair/plugin-sdk/testing';
import { styleFor, tagged } from '../src/gemini.cues.js';
import { audioOf, GeminiTtsPlugin } from '../src/gemini.plugin.js';

const wavBase64 = (): string => Buffer.from(new Uint8Array(4096).fill(7)).toString('base64');

async function started(config: Record<string, unknown> = {}, apiKey: string | null = 'g-test') {
    const host = createFakePluginHost();
    host.seedConfig({ voices: JSON.stringify([{ name: 'spark', engine: 'Zephyr', style: 'bright and warm' }]), ...config });
    if (apiKey !== null) host.seedSecret('apiKey', apiKey);
    const plugin = new GeminiTtsPlugin();
    await plugin.init(host);
    return { host, plugin };
}

describe('tags and style', () => {
    it('rewrites station cues into angle-bracket tags', () => {
        expect(tagged('Ну да [laugh] конечно [clear throat] всё')).toBe('Ну да <laugh> конечно <throat-clearing> всё');
    });

    it('folds a delivery into the voice style', () => {
        expect(styleFor('bright', 'hushed')).toBe('bright; hushed, intimate, almost whispering');
        expect(styleFor(undefined)).toBeUndefined();
    });

    it('finds audio in either answer shape', () => {
        expect(audioOf({ output_audio: { data: 'A' } })).toBe('A');
        expect(audioOf({ steps: [{ content: [{ type: 'text', data: 'no' }, { type: 'audio', data: 'B' }] }] })).toBe('B');
        expect(audioOf({})).toBeUndefined();
    });
});

describe('speak', () => {
    it('posts an interaction with the voice, style and language and answers WAV', async () => {
        const { host, plugin } = await started();
        host.queueResponse({ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ output_audio: { data: wavBase64() } }) });
        const handle = await plugin.speak({ text: 'Привет [laugh] эфир', voice: 'spark', language: 'ru-RU', delivery: 'hushed' });
        expect(handle.mime).toBe('audio/wav');
        const call = host.calls[0]!;
        expect(call.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
        expect(call.headers?.['x-goog-api-key']).toBe('g-test');
        const body = JSON.parse(call.body!);
        expect(body.model).toBe('gemini-3.8-flash-tts');
        expect(body.input[0].content[0].text).toBe('Привет <laugh> эфир');
        expect(body.input[0].content[0].annotations[0]).toEqual({ type: 'speech_metadata', style: 'bright and warm; hushed, intimate, almost whispering' });
        expect(body.generation_config.speech_config[0]).toEqual({ voice: 'Zephyr', language: 'ru-RU' });
        let total = 0;
        for await (const chunk of handle.audio) total += chunk.length;
        expect(total).toBe(4096);
    });

    it('uses the default voice for an unmapped name and refuses without a key', async () => {
        const { host, plugin } = await started();
        host.queueResponse({ body: JSON.stringify({ output_audio: { data: wavBase64() } }) });
        await plugin.speak({ text: 'x', voice: 'nobody' });
        expect(JSON.parse(host.calls[0]!.body!).generation_config.speech_config[0].voice).toBe('Kore');
        const { plugin: unkeyed } = await started({}, null);
        await expect(unkeyed.speak({ text: 'x' })).rejects.toThrow(/API key/);
    });

    it('reports an empty answer and an upstream error', async () => {
        const { host, plugin } = await started();
        host.queueResponse({ body: JSON.stringify({ steps: [] }) });
        await expect(plugin.speak({ text: 'x' })).rejects.toThrow(/no audio/);
        host.queueResponse({ status: 429, body: '{"error":"quota"}' });
        await expect(plugin.speak({ text: 'x' })).rejects.toThrow(/HTTP 429/);
    });
});
