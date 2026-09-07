/* Trumpet Flight - canonical "reduce background distraction" atmosphere tuning.
 * Single source of truth for how much the shipped game softens distant scenery.
 * Embedded into index.html for atomic offline updates; also loaded as-is by
 * tools/character-lab so the lab's sliders can never drift from what actually
 * ships. All four knobs are 0-1 (percent / 100); see atmospherePainter() in
 * scripts/environments.js for exactly how each one is applied.
 */
window.TRUMPET_ATMOSPHERE = { contrast: 0.6, collapse: 0, spacing: 0.05, haze: 0 };
