import { reactive } from "vue";
import { NodeType, TraceMode, TraceUnit } from "@/constants";
import HackSession from "@/classes/HackSession";
import type { HackGraphConfig } from "@/classes/HackGraph";
import GraphStore from "@/classes/GraphStore";
import RandomGraphGenerator, { type GraphSize } from "@/classes/RandomGraphGenerator";
import DifficultyConfig from "@/classes/DifficultyConfig";
import CheckResolver from "./CheckResolver";
import ItemConfig from "./ItemConfig";
import HackerApp from "@/apps/HackerApp";
import GmTraceApp from "@/apps/GmTraceApp";
import PlayerManagedApp from "@/apps/PlayerManagedApp";
import NodeDesignerApp from "@/apps/NodeDesignerApp";
import ManagedSession from "@/managed/ManagedSession";

/**
 * Public module API, exposed at `game.modules.get("foundryvtt-node-hacker").api`.
 * Everything routes through real, named classes so third-party systems/modules can also
 * hook them directly with libwrapper instead of going through the API surface.
 */
export default class NodeHackerApi {
  readonly checks = new CheckResolver();
  readonly items = new ItemConfig();
  readonly graphs = GraphStore;

  /** Ceiling on a node's own base difficulty (generated or hand-designed) - see
   * DifficultyConfig's own comment. A system with its own multi-tier difficulty mapping
   * should call this during setup to match how many tiers that mapping distinguishes below
   * its own hardest tier; defaults to 2 if never called. */
  setMaxDifficulty(max: number): void {
    DifficultyConfig.setMax(max);
  }

  getMaxDifficulty(): number {
    return DifficultyConfig.getMax();
  }

  /** Start a solo hacking minigame for the given actor against a saved or inline graph.
   * Returns null (after a GM-facing notification) if the graph is missing a required node
   * type - see HackGraph.validateRequiredTypes. */
  async startSolo(
    graphConfig: HackGraphConfig,
    actor: Actor | null,
    traceMax = 20,
    traceUnit: TraceUnit = TraceUnit.POINTS
  ): Promise<HackerApp | null> {
    let session: HackSession;
    try {
      // reactive() so mutations HackSession/HackGraph/HackNode make to their plain class
      // fields (node.owner, trace.value, ...) actually trigger Vue re-renders in HackerApp's view.
      session = reactive(
        new HackSession({
          graphConfig,
          actor,
          mode: TraceMode.SOLO,
          traceMax,
          traceUnit,
          checks: this.checks,
          items: this.items
        })
      ) as HackSession;
    } catch (err) {
      ui.notifications?.error?.((err as Error).message);
      return null;
    }
    const app = new HackerApp(session);
    app.render(true);
    return app;
  }

  /**
   * Start a GM-managed session: the GM gets a trace-control window, and a request is sent
   * (via chat whisper convention, left to the caller) to open the player's live view with
   * `openManagedPlayerView` using the returned session id. `defenderActor` optionally stands
   * in for the trace side (e.g. a PvP-style hack where a specific NPC/PC is "defending") -
   * when set, trace-side checks resolve against that actor instead of a generic check.
   */
  startManaged(
    graphConfig: HackGraphConfig,
    actor: Actor | null,
    traceMax = 6,
    defenderActor: Actor | null = null
  ): { sessionId: string; gmApp: GmTraceApp } | null {
    const sessionId = foundry.utils.randomID();
    let session: HackSession;
    try {
      // reactive() once, here, so ManagedSession's internal map and GmTraceApp's view share
      // the exact same proxy - a player's request mutating a session fetched from
      // ManagedSession's map must go through this same proxy for the GM's view to update.
      session = reactive(
        new HackSession({
          graphConfig,
          actor,
          mode: TraceMode.MANAGED,
          traceMax,
          traceUnit: TraceUnit.TURNS,
          checks: this.checks,
          items: this.items,
          defenderActor
        })
      ) as HackSession;
    } catch (err) {
      ui.notifications?.error?.((err as Error).message);
      return null;
    }
    ManagedSession.registerGmSession(sessionId, session);
    const gmApp = new GmTraceApp(sessionId, session);
    gmApp.render(true);
    return { sessionId, gmApp };
  }

  /** Advance a managed session's trace automatically as combat turns pass (see the module's
   * `combatTurn` hook). Auto-unregistered once the session completes. */
  registerCombatTurnAdvance(sessionId: string): void {
    ManagedSession.registerCombatTurnAdvance(sessionId);
  }

  unregisterCombatTurnAdvance(sessionId: string): void {
    ManagedSession.unregisterCombatTurnAdvance(sessionId);
  }

  /** Player-side: open the live view for a managed session the GM already started, given its id. */
  async openManagedPlayerView(sessionId: string): Promise<PlayerManagedApp> {
    const state = await ManagedSession.fetchState(sessionId);
    const app = new PlayerManagedApp(sessionId, state);
    app.render(true);
    return app;
  }

  openDesigner(graphName?: string): Promise<NodeDesignerApp> {
    return NodeDesignerApp.open(graphName);
  }

  /** GM: ask a specific user's client to open its live view for a managed session it didn't start itself. */
  notifyPlayer(sessionId: string, userId: string): void {
    ManagedSession.promptOpenPlayerView(sessionId, userId);
  }

  /**
   * Builds a small linear entry -> ... -> server graph on the fly, for callers that want to
   * launch a one-off hack (e.g. "hack this door" / "hack this NPC") without pre-designing a
   * graph in the Node Designer first. Each stage becomes one node at the given difficulty.
   */
  generateQuickGraph(name: string, stageDifficulties: number[]): HackGraphConfig {
    if (stageDifficulties.length === 0) stageDifficulties = [1];

    const nodes: HackGraphConfig["nodes"] = stageDifficulties.map((difficulty, i) => ({
      x: i,
      y: 0,
      type: i === 0 ? NodeType.ENTRY : i === stageDifficulties.length - 1 ? NodeType.SERVER : NodeType.NODE,
      difficulty
    }));

    const edges: HackGraphConfig["edges"] = stageDifficulties.slice(1).map((_, i) => ({
      from: [i, 0] as [number, number],
      to: [i + 1, 0] as [number, number],
      bidirectional: true
    }));

    // Every graph needs both a server and an exit (see HackGraph.validateRequiredTypes) -
    // this chain's last real target already stands in for the server; append a synthetic
    // exit right after it as the alternate win route, same as the procedural generator does.
    const exitX = stageDifficulties.length;
    nodes.push({ x: exitX, y: 0, type: NodeType.EXIT, difficulty: stageDifficulties[stageDifficulties.length - 1] });
    edges.push({ from: [exitX - 1, 0], to: [exitX, 0], bidirectional: true });

    return { name, nodes, edges };
  }

  /**
   * Builds an actual branching network on the fly - a randomized, connected multi-node
   * graph with alternate routes and a scattering of database side-objectives - for callers
   * that want a real minigame without pre-designing one in the Node Designer first.
   * `generateQuickGraph` is for a trivial single/few-check gate (e.g. a locked door);
   * this is for "present a proper hack" moments where a single node isn't enough of a game.
   */
  generateRandomGraph(name: string, difficulty = 1, size: GraphSize = "medium"): HackGraphConfig {
    return RandomGraphGenerator.generate(name, difficulty, size);
  }
}
