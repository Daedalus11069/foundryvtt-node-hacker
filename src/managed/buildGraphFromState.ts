import HackGraph from "@/classes/HackGraph";
import type { ManagedSessionState } from "./ManagedSession";
import type { Side } from "@/constants";

/** Rebuilds a display-only HackGraph on the receiving client from a broadcast state snapshot. */
export default function buildGraphFromState(state: ManagedSessionState): HackGraph {
  const graph = new HackGraph(state.graphConfig);
  for (const [key, nodeState] of Object.entries(state.nodes)) {
    const node = graph.nodes.get(key);
    if (!node) continue;
    node.owner = nodeState.owner as Side | null;
    node.capturing = nodeState.capturing as Side | null;
    node.stopped = nodeState.stopped;
    node.fortifyBonus = nodeState.fortifyBonus ?? 0;
  }
  return graph;
}
