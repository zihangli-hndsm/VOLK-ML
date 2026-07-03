import type { PluginManifest } from '../types';

const manifests = import.meta.glob<{ default: PluginManifest }>('./*/manifest.json', {
  eager: true,
});

export const pluginRegistry: PluginManifest[] = Object.values(manifests)
  .map((module) => module.default)
  .sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));

export function getDefaultParameters(manifest: PluginManifest) {
  return Object.fromEntries(manifest.properties.map((property) => [property.key, property.default]));
}
