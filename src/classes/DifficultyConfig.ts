/**
 * System-configurable ceiling for a node's own base difficulty - both generated
 * (RandomGraphGenerator) and hand-designed (the Node Designer) nodes are clamped to this,
 * separate from a runtime Fortify bonus, which can push an already-placed node one step past
 * it. Defaults to 2 (a plain pass/fail check has no reason to go higher), but a system with
 * its own multi-tier difficulty mapping (e.g. FASERIP's difficulty -> required-roll-color,
 * see registerNodeHackerCheckResolver's difficultyRequiredColor) should set this via the API
 * to match how many tiers that mapping actually distinguishes below its own hardest tier -
 * the module has no way to know that on its own.
 */
export default class DifficultyConfig {
  private static max = 2;

  static setMax(max: number): void {
    this.max = Math.max(1, Math.round(max));
  }

  static getMax(): number {
    return this.max;
  }

  static clamp(value: number): number {
    if (!Number.isFinite(value)) return 1;
    return Math.min(this.max, Math.max(1, Math.round(value)));
  }
}
