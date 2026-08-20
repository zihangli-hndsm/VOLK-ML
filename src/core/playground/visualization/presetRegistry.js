import { linearRegressionIntro } from '../presets/linearRegressionIntro.js';
import { knnIntro } from '../presets/knnIntro.js';
import { mlpIntro } from '../presets/mlpIntro.js';
import { imageIntro } from '../presets/imageIntro.js';
import { sequenceIntro } from '../presets/sequenceIntro.js';
import { retrievalIntro } from '../presets/retrievalIntro.js';
import { ragIntro } from '../presets/ragIntro.js';

// Built-in Visualization Script presets. Presets are JSON-safe declarations;
// they are never React code and never carry executable strings.
const presets = [linearRegressionIntro, knnIntro, mlpIntro, imageIntro, sequenceIntro, retrievalIntro, ragIntro];
const byId = new Map(presets.map((preset) => [preset.id, preset]));

export function listPresets() {
  return presets.map((preset) => ({
    id: preset.id,
    model: { ...preset.model },
    controls: [...preset.controls],
    layout: structuredClone(preset.layout),
  }));
}

export function getPreset(id) {
  return byId.get(id) ?? null;
}
