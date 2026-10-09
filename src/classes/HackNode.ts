import { NodeType, Side } from "@/constants";
import HackConnection from "./HackConnection";
import CaptureRangeConfig from "./CaptureRangeConfig";

export interface DatabaseReward {
  /** Item kind granted on successful hack of this database node. */
  kind: "nuke" | "stop";
  /** How many of the item to grant. */
  quantity: number;
}

export interface HackNodeConfig {
  x: number;
  y: number;
  type: NodeType;
  /** Difficulty rating of this node. Drives the dice/check DC via the CheckResolver, not a duration. */
  difficulty: number;
  label?: string;
  /** Only meaningful for NodeType.DATABASE nodes, same as `reward`. Free-text description of
   * what this database actually contains - shown to the GM only, never needed by the
   * mechanics themselves. See HackSession.claimDatabaseReward, which echoes this to the GM
   * the moment the hacker actually captures the node it's on. */
  data?: string;
  /** Only meaningful for NodeType.DATABASE nodes. */
  reward?: DatabaseReward;
}

/**
 * A single node in a hack graph. Mirrors the shape produced by the Node Designer
 * and consumed by both the solo and managed play surfaces.
 *
 * Ownership is a single contested value, not two independent progress tracks: the trace
 * side can recapture a node the hacker already holds (and vice versa in a managed
 * session), matching a real back-and-forth race rather than two ships passing each other.
 */
export default class HackNode {
  x!: number;
  y!: number;
  type!: NodeType;
  difficulty!: number;
  label?: string;
  data?: string;
  reward?: DatabaseReward;

  key: string;
  connections: HackConnection[] = [];

  /** Which side currently holds this node, if either. */
  owner: Side | null = null;
  /** Which side has an in-flight capture attempt on this node, if any. */
  capturing: Side | null = null;

  /** Set while a stop-virus effect is suppressing trace recapture at this node. */
  stopped = false;

  /** Extra difficulty a successful Fortify has added on top of this node's base difficulty,
   * making it harder for the opponent to retake while the current owner holds it. Reset to
   * 0 whenever the node actually changes hands - it's a defense the new owner hasn't earned. */
  fortifyBonus = 0;

  constructor(config: HackNodeConfig) {
    Object.assign(this, config);
    this.key = HackNode.getKey(config.x, config.y);
    if (this.type === NodeType.ENTRY) {
      this.owner = Side.HACKER;
    }
    if (this.type === NodeType.SERVER) {
      this.owner = Side.TRACE;
    }
  }

  static getKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  equals(other: HackNode): boolean {
    return this.key === other.key;
  }

  addConnection(connection: HackConnection): void {
    this.connections.push(connection);
  }

  getConnectedNodes(): HackNode[] {
    const seen = new Map<string, HackNode>();
    for (const conn of this.connections) {
      const node = conn.getOtherNode(this);
      seen.set(node.key, node);
    }
    return [...seen.values()];
  }

  isOwnedBy(side: Side): boolean {
    return this.owner === side;
  }

  /** @deprecated kept for call-site brevity; `trace` maps to Side.TRACE, otherwise Side.HACKER. */
  isCaptured(trace = false): boolean {
    return this.owner === (trace ? Side.TRACE : Side.HACKER);
  }

  isCapturing(trace = false): boolean {
    return this.capturing === (trace ? Side.TRACE : Side.HACKER);
  }

  /** The "loose" reachability rule canBeCaptured falls back to when CaptureRangeConfig.isStrict()
   * is off: touching ANY node this side owns anywhere on the graph, not just its specific
   * current-position node. */
  isConnectedToOwnedBy(side: Side): boolean {
    const trace = side === Side.TRACE;
    return this.connections.some((conn) => {
      if (!conn.endsWith(this, trace)) return false;
      return conn.getOtherNode(this).isOwnedBy(side);
    });
  }

  /** @deprecated boolean-flavored wrapper kept for call-site brevity alongside isCaptured/isCapturing. */
  isConnectedToCaptured(trace = false): boolean {
    return this.isConnectedToOwnedBy(trace ? Side.TRACE : Side.HACKER);
  }

  /** True if a direct connection joins this node and `other` - not transitive, and not
   * gated on ownership at all (see canBeCaptured, the only real caller). */
  isAdjacentTo(other: HackNode): boolean {
    return this.connections.some((conn) => conn.getOtherNode(this).equals(other));
  }

  /** Can this side attempt the node right now: not already theirs, nobody else mid-attempt,
   * and reachable - exactly what "reachable" means depends on CaptureRangeConfig (a GM-facing
   * world setting):
   *  - Strict (default): directly adjacent to `activeNode`, that side's own current-position
   *    node (HackSession.activeNodeKey for the hacker, HackSession.traceActiveNodeKey for the
   *    trace side). A side holding three separate, non-adjacent pockets of territory can only
   *    ever attack out from wherever it's actually standing, same as the hacker's own free
   *    movement between owned nodes (see HackSession.moveTo) only ever repositions that one
   *    marker rather than acting everywhere at once. No activeNode (shouldn't happen once a
   *    session's actually running) means nothing is reachable.
   *  - Loose: adjacent to ANY node this side owns anywhere on the graph (isConnectedToOwnedBy) -
   *    the rule from before per-side movement existed; `activeNode` is ignored entirely. */
  canBeCaptured(trace = false, activeNode: HackNode | null = null): boolean {
    const side = trace ? Side.TRACE : Side.HACKER;
    if (this.owner === side || this.capturing !== null) return false;
    if (!CaptureRangeConfig.isStrict()) return this.isConnectedToOwnedBy(side);
    if (!activeNode) return false;
    return this.isAdjacentTo(activeNode);
  }

  isDatabase(): boolean {
    return this.type === NodeType.DATABASE;
  }

  /** This node's actual check difficulty right now - its base rating plus whatever Fortify
   * has added on top, for whichever side has to fight through that defense. */
  effectiveDifficulty(): number {
    return this.difficulty + this.fortifyBonus;
  }
}
