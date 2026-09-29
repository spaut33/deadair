import { definePlugin } from '@deadair/plugin-sdk';
import { GeminiTtsPlugin, geminiTtsManifest } from './gemini.plugin.js';

export { GeminiTtsPlugin, geminiTtsManifest };

export default definePlugin(geminiTtsManifest, () => new GeminiTtsPlugin());
