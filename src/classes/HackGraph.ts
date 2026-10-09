import { NodeType, Side } from "@/constants";
import HackNode, { type HackNodeConfig } from "./HackNode";
import HackConnection from "./HackConnection";

export interface GraphEdgeConfig {
  from: [number, number];
  to: [number, number];
  bidirectional: boolean;
}

export interface HackGraphConfig {
  name: string;
  nodes: HackNodeConfig[];
  edges: GraphEdgeConfig[];
}

/**
 * A full node graph: the runtime analog of what the Node Designer app produces.
 * Also the shape persisted to a JournalEntry/Item flag so it can be reused across sessions.
 */
export default class HackGraph {
  name: string;
  nodes: Map<string, HackNode> = new Map();
  connections: HackConnection[] = [];

  constructor(config: HackGraphConfig) {
    this.name = config.name;
    for (const nodeConfig of config.nodes) {
      const node = new HackNode(nodeConfig);
      this.nodes.set(node.key, node);
    }
    for (const edge of config.edges) {
      const from = this.getNode(...edge.from);
      const to = this.getNode(...edge.to);
      if (!from || !to) {
        console.error(`Node Hacker | edge references missing node`, edge);
        continue;
      }
      const connection = new HackConnection(from, to, edge.bidirectional);
      from.addConnection(connection);
      to.addConnection(connection);
      this.connections.push(connection);
    }
  }

  getNode(x: number, y: number): HackNode | undefined {
    return this.nodes.get(HackNode.getKey(x, y));
  }

  getNodesByType(type: NodeType): HackNode[] {
    return [...this.nodes.values()].filter((n) => n.type === type);
  }

  getDatabaseNodes(): HackNode[] {
    return this.getNodesByType(NodeType.DATABASE);
  }

  /** Win condition: the hacker only needs ONE way out - capturing any single server or exit
   * node ends the hack in their favor, not all of them. A graph can (and, per
   * validateRequiredTypes, always should) have both, giving the hacker a choice of routes
   * rather than a single mandatory finish line. */
  isGoalCaptured(): boolean {
    const goals = [...this.getNodesByType(NodeType.SERVER), ...this.getNodesByType(NodeType.EXIT)];
    if (goals.length === 0) return false;
    return goals.some((n) => n.isCaptured(false));
  }

  /**
   * Every playable graph needs at least one ENTRY (where the hacker starts), one EXIT, and
   * one SERVER - the latter two are alternate win conditions (see isGoalCaptured: capturing
   * EITHER one wins, not both), but both must actually exist on the graph. Returns the names
   * of whatever's missing, empty if the graph is well-formed. Checked before a session
   * actually starts (see NodeHackerApi.startSolo/startManaged), not at design time, so a GM
   * can still save/edit a graph mid-construction without being blocked.
   */
  validateRequiredTypes(): string[] {
    const missing: string[] = [];
    if (this.getNodesByType(NodeType.ENTRY).length === 0) missing.push("Entry");
    if (this.getNodesByType(NodeType.EXIT).length === 0) missing.push("Exit");
    if (this.getNodesByType(NodeType.SERVER).length === 0) missing.push("Server");
    return missing;
  }

  /** Loss condition for the hacker: every entry point re-secured by the trace. */
  isTraceVictory(): boolean {
    const entries = this.getNodesByType(NodeType.ENTRY);
    if (entries.length === 0) return false;
    return entries.every((n) => n.isCaptured(true));
  }

  toConfig(): HackGraphConfig {
    return {
      name: this.name,
      nodes: [...this.nodes.values()].map((n) => ({
        x: n.x,
        y: n.y,
        type: n.type,
        difficulty: n.difficulty,
        label: n.label,
        data: n.data,
        reward: n.reward
      })),
      edges: this.connections.map((c) => ({
        from: [c.a.x, c.a.y],
        to: [c.b.x, c.b.y],
        bidirectional: c.bidirectional
      }))
    };
  }

  /** Plain BFS over raw adjacency (ignoring connection direction), from a set of starting
   * nodes to the nearest node satisfying `isTarget`. Infinity if there's nothing to start
   * from, nothing matching the target, or the graph is disconnected between them. */
  // Not `private`: Vue's reactive()/template type-checking reconstructs a structural type
  // for a wrapped class instance that drops private members entirely, which then fails to
  // satisfy `HackGraph`'s own type wherever a reactive-wrapped graph flows through a typed
  // prop (e.g. NodeGraphView's `graph: HackGraph`). Not part of the public API surface in
  // spirit - just not TS-`private` for this reason.
  hopDistance(from: HackNode[], isTarget: (n: HackNode) => boolean): number {
    if (from.length === 0) return Infinity;
    if (from.some(isTarget)) return 0;

    const visited = new Set(from.map((n) => n.key));
    let frontier = from;
    let distance = 0;
    while (frontier.length > 0) {
      const next: HackNode[] = [];
      for (const node of frontier) {
        for (const neighbor of node.getConnectedNodes()) {
          if (visited.has(neighbor.key)) continue;
          visited.add(neighbor.key);
          if (isTarget(neighbor)) return distance + 1;
          next.push(neighbor);
        }
      }
      frontier = next;
      distance += 1;
    }
    return Infinity;
  }

  /**
   * Minimum graph-hop distance between any node owned by `from` and any node owned by
   * `to` - used to gate a Scan attempt to "within range of the opponent".
   */
  hopDistanceBetweenOwners(from: Side, to: Side): number {
    const fromNodes = [...this.nodes.values()].filter((n) => n.isOwnedBy(from));
    if (![...this.nodes.values()].some((n) => n.isOwnedBy(to))) return Infinity;
    return this.hopDistance(fromNodes, (n) => n.isOwnedBy(to));
  }

  /**
   * Minimum graph-hop distance from any node `side` currently owns to the nearest node of
   * `type` - regardless of who (if anyone) currently owns that node. Used to drive the
   * managed-mode trace value off how close the trace side's actual owned territory is to
   * the hacker's entry point, rather than an arbitrary elapsed-turn counter.
   */
  hopDistanceToType(side: Side, type: NodeType): number {
    const fromNodes = [...this.nodes.values()].filter((n) => n.isOwnedBy(side));
    return this.hopDistance(fromNodes, (n) => n.type === type);
  }
}
