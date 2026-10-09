import { NodeType } from "@/constants";
import type { GraphEdgeConfig, HackGraphConfig } from "./HackGraph";
import type { HackNodeConfig } from "./HackNode";
import DifficultyConfig from "./DifficultyConfig";

export type GraphSize = "small" | "medium" | "large" | "huge";

/** Number of interior layers (columns between the entry and the goal). */
const SIZE_LAYERS: Record<GraphSize, number> = {
  small: 2,
  medium: 3,
  large: 5,
  // Reserved for the hardest opening-roll tier (an outright failed roll) - once difficulty
  // itself is capped at 2 (see below), network SIZE is the only lever left to make a worse
  // roll meaningfully harder than a bare pass.
  huge: 8
};

/** Chance a node gets an extra forward edge into the next layer, beyond its guaranteed one
 * (an alternate route into a different node than the "main" path uses). */
const EXTRA_FORWARD_CHANCE = 0.35;
/** Chance two nodes in the same layer get a lateral edge (a route around, not just through). */
const LATERAL_CHANCE = 0.2;
/** Chance an interior node grows a dead-end database spur off to the side. */
const SPUR_CHANCE = 0.35;

/** Grid cells between adjacent layers/rows in the final output - the generation logic itself
 * (adjacency, occupied-cell tracking, spur placement) all works in a tight unit grid where
 * every step is exactly 1 cell, and gets spread out to this spacing only at the very end, so
 * nodes land with real visual breathing room between them instead of packed into every
 * consecutive grid cell. */
const NODE_SPACING = 2;

interface Placed {
  x: number;
  y: number;
}

function key(p: Placed): string {
  return `${p.x},${p.y}`;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Builds an actual layered hacking network - the shape real node-hacking minigames use
 * (Deus Ex/Introversion-style): a column of entry, several columns of branching interior
 * nodes that fan out and re-converge with alternate routes, a final goal column, and a
 * scattering of dead-end database spurs off the main lattice. This is deliberately NOT a
 * random walk across an open grid (which produces a shapeless blob with no real "routes"
 * through it) - every edge here is meaningful: forward edges are the paths from entry to
 * goal, lateral edges are alternate routes around a layer, and spurs are optional detours
 * that lead nowhere but a reward.
 */
export default class RandomGraphGenerator {
  static generate(name: string, difficulty = 1, size: GraphSize = "medium"): HackGraphConfig {
    const layerCount = SIZE_LAYERS[size] ?? SIZE_LAYERS.medium;
    const nodes: HackNodeConfig[] = [];
    const edges: GraphEdgeConfig[] = [];
    const occupied = new Set<string>();

    function place(x: number, y: number): void {
      occupied.add(key({ x, y }));
    }

    function addEdge(from: Placed, to: Placed): void {
      edges.push({ from: [from.x, from.y], to: [to.x, to.y], bidirectional: true });
    }

    // Entry sits alone in column 0, vertically centered against the widest interior layer.
    const layers: Placed[][] = [];
    for (let x = 1; x <= layerCount; x++) {
      const count = x === 1 || x === layerCount ? 2 + Math.round(Math.random()) : 1 + Math.floor(Math.random() * 3);
      const layer: Placed[] = [];
      for (let i = 0; i < count; i++) {
        const cell = { x, y: i };
        layer.push(cell);
        place(cell.x, cell.y);
      }
      layers.push(layer);
    }

    const maxRows = Math.max(...layers.map((l) => l.length));
    const entry: Placed = { x: 0, y: Math.floor((maxRows - 1) / 2) };
    place(entry.x, entry.y);

    // Re-center every layer vertically against the tallest one, so the network fans out and
    // converges symmetrically instead of hugging the top edge.
    for (const layer of layers) {
      const offset = Math.floor((maxRows - layer.length) / 2);
      for (const cell of layer) cell.y += offset;
    }

    // Entry fans out to every node in the first interior layer.
    for (const cell of layers[0]) addEdge(entry, cell);

    // Each interior layer connects forward into the next: every node in the next layer gets
    // at least one guaranteed inbound edge from a random node in this layer (so nothing is
    // stranded), then a chance at a second inbound edge from elsewhere in this layer (an
    // alternate route into the same node).
    for (let i = 0; i < layers.length - 1; i++) {
      const from = layers[i];
      const to = layers[i + 1];
      for (const target of to) {
        addEdge(pick(from), target);
        if (Math.random() < EXTRA_FORWARD_CHANCE) {
          const extraSource = pick(from);
          addEdge(extraSource, target);
        }
      }
      // Every node in this layer should also have at least one outbound edge - a node with
      // no forward connection at all is a dead end mid-network, which reads as broken rather
      // than an intentional detour.
      const linked = new Set(edges.filter((e) => e.from[0] === i).map((e) => `${e.from.join(",")}`));
      for (const source of from) {
        if (linked.has(`${source.x},${source.y}`)) continue;
        addEdge(source, pick(to));
      }

      // Lateral shortcuts within the layer - an alternate route around, not just through.
      for (let a = 0; a < from.length; a++) {
        for (let b = a + 1; b < from.length; b++) {
          if (Math.random() < LATERAL_CHANCE) addEdge(from[a], from[b]);
        }
      }
    }

    // Final interior layer converges on a single goal node.
    const goal: Placed = { x: layerCount + 1, y: Math.floor((maxRows - 1) / 2) };
    place(goal.x, goal.y);
    for (const cell of layers[layerCount - 1]) addEdge(cell, goal);

    // Dead-end database spurs: a side branch off an interior node that leads nowhere but a
    // reward. Each spur looks for a free row right next to its OWN parent (above or below,
    // widening outward) rather than always landing on one shared row past the tallest layer -
    // that earlier approach put every database in the same dense band along the bottom
    // instead of scattering them across the network next to whichever node actually spawned
    // them.
    // Keeps a spur genuinely NEAR its parent (nearest-distance-first, so it never drifts far
    // enough to need a long edge crossing the rest of the network) and, critically, ALWAYS in
    // its parent's own column - never a real path layer's column - so a database can never end
    // up sitting between two nodes on the actual entry-to-goal route. Randomizing above-vs-below
    // at each distance ring is enough on its own to stop every spur in a layer stacking into
    // one exact shared row.
    function findFreeSpurCell(parentX: number, parentY: number): Placed {
      for (let offset = 1; offset <= maxRows + 1; offset++) {
        const candidates: Placed[] = [
          { x: parentX, y: parentY + offset },
          { x: parentX, y: parentY - offset }
        ];
        if (Math.random() < 0.5) candidates.reverse();
        for (const c of candidates) {
          if (c.y >= 0 && !occupied.has(key(c))) return c;
        }
      }
      return { x: parentX, y: maxRows }; // Should be unreachable - effectively unbounded room below.
    }

    // Every graph needs BOTH a server and an exit (see HackGraph.validateRequiredTypes) -
    // capturing either one wins (see HackGraph.isGoalCaptured), so this gives the hacker two
    // real alternate routes to victory instead of one mandatory finish line. The exit sits
    // right next to the server in the same goal column, reachable from the same final layer.
    const exitRow = (() => {
      for (let offset = 1; offset <= maxRows + 1; offset++) {
        for (const y of [goal.y + offset, goal.y - offset]) {
          if (y >= 0 && !occupied.has(key({ x: goal.x, y }))) return y;
        }
      }
      return maxRows; // Should be unreachable - every column has effectively unbounded room below.
    })();
    const exit: Placed = { x: goal.x, y: exitRow };
    place(exit.x, exit.y);
    for (const cell of layers[layerCount - 1]) addEdge(cell, exit);

    const spurs: Placed[] = [];
    for (const layer of layers) {
      for (const cell of layer) {
        if (Math.random() >= SPUR_CHANCE) continue;
        const spur = findFreeSpurCell(cell.x, cell.y);
        spurs.push(spur);
        place(spur.x, spur.y);
        addEdge(cell, spur);
      }
    }

    // Clamped to DifficultyConfig's system-configured ceiling regardless of graph size or the
    // caller's own `difficulty` input - a later layer or a bigger network makes the hack
    // harder by adding MORE nodes/routes to fight through, never by inflating an individual
    // node's own number past what the integrating system's own tier mapping distinguishes
    // (see DifficultyConfig's own comment - a plain pass/fail system leaves this at 2; a
    // system with its own multi-tier mapping, like FASERIP, sets it to match).
    const clampDifficulty = (value: number) => DifficultyConfig.clamp(value);

    const interiorNodes = layers.flat();
    for (const cell of interiorNodes) {
      const jitter = Math.random() < 0.5 ? 0 : 1;
      nodes.push({
        x: cell.x,
        y: cell.y,
        type: NodeType.NODE,
        difficulty: clampDifficulty(difficulty + jitter)
      });
    }

    nodes.push({ x: entry.x, y: entry.y, type: NodeType.ENTRY, difficulty: 0 });
    nodes.push({ x: goal.x, y: goal.y, type: NodeType.SERVER, difficulty: clampDifficulty(difficulty + 1) });
    nodes.push({ x: exit.x, y: exit.y, type: NodeType.EXIT, difficulty: clampDifficulty(difficulty + 1) });

    for (const spur of spurs) {
      nodes.push({
        x: spur.x,
        y: spur.y,
        type: NodeType.DATABASE,
        difficulty: clampDifficulty(difficulty),
        reward: { kind: Math.random() < 0.5 ? "nuke" : "stop", quantity: 1 }
      });
    }

    return {
      name,
      nodes: nodes.map((n) => ({ ...n, x: n.x * NODE_SPACING, y: n.y * NODE_SPACING })),
      edges: edges.map((e) => ({
        ...e,
        from: [e.from[0] * NODE_SPACING, e.from[1] * NODE_SPACING],
        to: [e.to[0] * NODE_SPACING, e.to[1] * NODE_SPACING]
      }))
    };
  }
}
