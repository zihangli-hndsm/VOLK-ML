import type { Node, Edge } from '@xyflow/react';

export type LanguageMode = 'en' | 'zh' | 'parallel';

export type LocalizedString = { en: string; zh: string };

export type PluginPort = { name: string; type: string };

export type PluginProperty = {
  key: string;
  label: LocalizedString;
  type: 'slider' | 'number' | 'text';
  min?: number;
  max?: number;
  step?: number;
  default: number | string;
};

export type PluginManifest = {
  id: string;
  name: LocalizedString;
  category: string;
  description: LocalizedString;
  inputs: PluginPort[];
  outputs: PluginPort[];
  properties: PluginProperty[];
  pytorch_template: string;
};

export type PipelineNodeData = {
  pluginId: string;
  label: LocalizedString;
  manifest: PluginManifest;
  parameters: Record<string, number | string>;
};

export type PipelineNode = Node<PipelineNodeData>;
export type PipelineEdge = Edge;
