import { MODULE_ID } from "@/constants";

/**
 * Whether capture/nuke range is gated on adjacency to a side's specific current-position
 * node (activeNodeKey / traceActiveNodeKey - "strict") or on adjacency to ANY node that side
 * already owns anywhere on the graph ("loose" - the rule before per-side movement existed).
 * Backed by a world setting so a GM can pick whichever rule suits their table without a code
 * change - see HackNode.canBeCaptured, the only real consumer.
 */
export default class CaptureRangeConfig {
  private static strict = true;

  static register(): void {
    // fvtt-types only knows the module ids declared in its own ambient namespace, not this
    // module's - same reason other settings.register calls across the ecosystem need a cast.
    (game.settings as any).register(MODULE_ID, "strictAdjacency", {
      name: "Strict capture adjacency",
      hint:
        "On: a side can only capture/nuke a node directly adjacent to its own current position " +
        "(the active-node marker). Off: a side can capture/nuke any node adjacent to anything it " +
        "already owns, anywhere on the graph - movement becomes cosmetic.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      onChange: (value: unknown) => {
        this.strict = value as boolean;
      }
    });
    this.strict = (game.settings as any).get(MODULE_ID, "strictAdjacency") as boolean;
  }

  static isStrict(): boolean {
    return this.strict;
  }
}
