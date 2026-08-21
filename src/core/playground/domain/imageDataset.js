// Small deterministic image fixtures for the first Phase 9 image slice.
// Values are normalized grayscale pixels; no binary assets or network data
// are required for the teaching path.

const SIZE = 4;

function image(id, label, pixels, membership) {
  return {
    id,
    label,
    membership,
    payload: { kind: 'image', width: SIZE, height: SIZE, pixels: [...pixels] },
  };
}

const PLUS = [
  0, 0, 1, 0,
  0, 0, 1, 0,
  1, 1, 1, 1,
  0, 0, 1, 0,
];

const DIAGONAL = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function shifted(pixels, offset) {
  return pixels.map((value, index) => Math.max(0, Math.min(1, value + ((index + offset) % 5 === 0 ? 0.12 : 0))));
}

export function createImageClassificationSource({ seed = 7 } = {}) {
  const offset = Math.abs(Math.trunc(Number(seed) || 0));
  const samples = [
    image('plus-train-1', 'plus', shifted(PLUS, offset), 'train'),
    image('plus-train-2', 'plus', shifted(PLUS, offset + 1), 'train'),
    image('diag-train-1', 'diagonal', shifted(DIAGONAL, offset + 2), 'train'),
    image('diag-train-2', 'diagonal', shifted(DIAGONAL, offset + 3), 'train'),
    image('plus-test-1', 'plus', shifted(PLUS, offset + 4), 'test'),
    image('diag-test-1', 'diagonal', shifted(DIAGONAL, offset + 5), 'test'),
  ];
  return {
    kind: 'example',
    domain: 'image',
    task: 'classification',
    name: 'Deterministic shape images',
    fingerprint: `image-shapes:${offset}`,
    samples,
  };
}

