import { definePlugin } from '@deadair/plugin-sdk';
import { ElevenLabsPlugin, elevenLabsManifest } from './elevenlabs.plugin.js';

export { ElevenLabsPlugin, elevenLabsManifest };

export default definePlugin(elevenLabsManifest, () => new ElevenLabsPlugin());
