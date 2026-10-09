import { MODULE_ID, Side } from "@/constants";
import type HackSession from "@/classes/HackSession";
import type HackNode from "@/classes/HackNode";
import type { ScanResult } from "@/classes/HackSession";
import advanceCombatTurn from "@/classes/advanceCombatTurn";
import SessionPersistence from "@/classes/SessionPersistence";

declare const socketlib: any;

export interface ManagedSessionState {
  id: string;
  graphConfig: ReturnType<HackSession["graph"]["toConfig"]>;
  trace: ReturnType<HackSession["trace"]["toJSON"]>;
  detected: boolean;
  /** Whether the trace side has any sign of the hacker yet - the GM's own view (which
   * reads the live session directly, not this broadcast) uses this to gate what it shows. */
  hackerSpotted: boolean;
  /** Whether the hacker has successfully scanned for the trace side's position. Nodes the
   * trace side owns are masked out of this broadcast (as `owner: null`) until this is true. */
  traceMapped: boolean;
  /** Whether the hacker actor currently owns at least one Nuke/Stop Virus item - the player
   * client never has direct access to the (GM-side) actor's item list, so this is broadcast
   * alongside everything else rather than assumed true. */
  canNuke: boolean;
  canStop: boolean;
  /** Whether either side has called off the hack (see HackSession.abort) - the player client
   * has no authoritative session of its own to check this against directly. */
  aborted: boolean;
  /** The hacker's current-position node key (HackSession.activeNodeKey) - Capture/Nuke here
   * are gated on adjacency to this specific node (see HackNode.canBeCaptured), so the
   * player's own view needs it to compute the same menu availability the GM's authoritative
   * session would. */
  activeNodeKey: string | null;
  nodes: Record<
    string,
    { owner: string | null; capturing: string | null; stopped: boolean; fortifyBonus: number }
  >;
}

type StateListener = (state: ManagedSessionState) => void;

/**
 * Thin real-time transport over socketlib connecting one GM (running the trace) and
 * one player (running the hacker) against a single shared HackSession living on the GM's client.
 * The GM client is authoritative; the player client sends move requests and renders broadcast state.
 */
export default class ManagedSession {
  private static socket: any;
  private static listeners = new Map<string, StateListener[]>();
  private static sessions = new Map<string, HackSession>();
  private static combatTurnSessions = new Set<string>();
  private static completedSessions = new Set<string>();

  static init(): void {
    if (typeof socketlib === "undefined") {
      console.warn(`${MODULE_ID} | socketlib not found; managed hacking sessions are disabled.`);
      return;
    }
    this.socket = socketlib.registerModule(MODULE_ID);
    if (!this.socket) {
      // socketlib returns nothing (rather than throwing) if this module's manifest is
      // missing `"socket": true` - fail loud in the console instead of crashing the whole
      // "socketlib.ready" hook chain on the first `.register()` call below.
      console.error(`${MODULE_ID} | socketlib.registerModule() returned nothing; is "socket": true set in module.json?`);
      return;
    }
    this.socket.register("requestCapture", this.handleRequestCapture.bind(this));
    this.socket.register("requestNuke", this.handleRequestNuke.bind(this));
    this.socket.register("requestStop", this.handleRequestStop.bind(this));
    this.socket.register("requestFortify", this.handleRequestFortify.bind(this));
    this.socket.register("requestMove", this.handleRequestMove.bind(this));
    this.socket.register("requestAbort", this.handleRequestAbort.bind(this));
    this.socket.register("requestScan", this.handleRequestScan.bind(this));
    this.socket.register("requestState", this.handleRequestState.bind(this));
    this.socket.register("broadcastState", this.handleBroadcastState.bind(this));
    this.socket.register("promptOpenPlayerView", this.handlePromptOpenPlayerView.bind(this));
  }

  /** GM: register a live session so it can respond to player requests. */
  static registerGmSession(id: string, session: HackSession): void {
    this.sessions.set(id, session);
    SessionPersistence.saveManagedGm(id, session.toState());
  }

  static unregisterGmSession(id: string): void {
    this.sessions.delete(id);
    this.combatTurnSessions.delete(id);
    this.completedSessions.delete(id);
    SessionPersistence.clearManagedGm(id);
  }

  /** GM: advance this session's trace automatically as combat turns pass (see the
   * `combatTurn` hook registered in node-hacker.ts). Auto-unregistered once the session completes. */
  static registerCombatTurnAdvance(id: string): void {
    this.combatTurnSessions.add(id);
  }

  static unregisterCombatTurnAdvance(id: string): void {
    this.combatTurnSessions.delete(id);
  }

  /** Called from the `combatTurn` hook: advances every session opted into turn-based trace. */
  static advanceRegisteredSessions(): void {
    for (const id of this.combatTurnSessions) this.advanceTurn(id);
  }

  /** Either side: subscribe to state broadcasts for a session id. */
  static onState(id: string, fn: StateListener): void {
    if (!this.listeners.has(id)) this.listeners.set(id, []);
    this.listeners.get(id)!.push(fn);
  }

  static offState(id: string, fn: StateListener): void {
    const arr = this.listeners.get(id);
    if (!arr) return;
    this.listeners.set(id, arr.filter((l) => l !== fn));
  }

  /**
   * Builds the broadcast payload sent to every client. Only the player's PlayerManagedApp
   * ever consumes this (the GM's own GmTraceApp reads the live `session` directly), so this
   * is where the hacker-facing fog of war actually lives: a node the trace side owns is
   * masked to `owner: null` - and its `stopped` flag hidden - until the hacker has actually
   * scanned for them (see HackSession.scan). Node topology (existence/position/difficulty,
   * via graphConfig) is never hidden - only current ownership/capture-in-progress state is.
   */
  static serialize(id: string, session: HackSession): ManagedSessionState {
    const nodes: ManagedSessionState["nodes"] = {};
    for (const [key, node] of session.graph.nodes) {
      const hideFromHacker = !session.traceMapped && node.owner === Side.TRACE;
      nodes[key] = {
        owner: hideFromHacker ? null : node.owner,
        capturing: node.capturing === Side.TRACE && !session.traceMapped ? null : node.capturing,
        // Never hidden: the hacker always sees their own Stop Virus use, regardless of who
        // currently owns the node it was used on.
        stopped: node.stopped,
        // Only meaningful while the trace side holds the node, so it's already covered by
        // the same fog-of-war gate as owner/capturing above.
        fortifyBonus: hideFromHacker ? 0 : node.fortifyBonus
      };
    }
    const actor = session.actor;
    return {
      id,
      graphConfig: session.graph.toConfig(),
      trace: session.trace.toJSON(),
      detected: session.detectedByTrace,
      hackerSpotted: session.hackerSpotted,
      traceMapped: session.traceMapped,
      canNuke: !!actor && session.items.getNukeItems(actor).length > 0,
      canStop: !!actor && session.items.getStopItems(actor).length > 0,
      aborted: session.aborted,
      activeNodeKey: session.activeNodeKey,
      nodes
    };
  }

  /** GM: push current state to all connected clients after any change. */
  static broadcast(id: string, session: HackSession): void {
    const state = this.serialize(id, session);
    this.handleBroadcastState(state);
    if (this.socket) this.socket.executeForOthers("broadcastState", state);
    SessionPersistence.saveManagedGm(id, session.toState());
    this.checkCompletion(id, session);
  }

  /** Fires `nodeHacker.managedSessionComplete` once, the first time a managed session ends,
   * and stops advancing its trace on further combat turns. */
  private static checkCompletion(id: string, session: HackSession): void {
    if (this.completedSessions.has(id)) return;
    // checkCompletion (not isComplete) so the completion chat card - result headline plus
    // which databases got breached - posts from the GM's authoritative session, exactly once.
    const result = session.checkCompletion();
    if (!result) return;
    this.completedSessions.add(id);
    this.unregisterCombatTurnAdvance(id);
    (Hooks.callAll as (...args: any[]) => void)("nodeHacker.managedSessionComplete", id, session, result);
  }

  private static handleBroadcastState(state: ManagedSessionState): void {
    for (const listener of this.listeners.get(state.id) ?? []) listener(state);
  }

  // --- Player -> GM requests. The GM's client owns the authoritative HackSession. ---

  private static async handleRequestCapture(sessionId: string, nodeKey: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const node = session.graph.nodes.get(nodeKey);
    if (!node) return;
    await session.captureNode(node);
    await advanceCombatTurn();
    this.broadcast(sessionId, session);
  }

  private static async handleRequestNuke(sessionId: string, nodeKey: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const node = session.graph.nodes.get(nodeKey);
    if (!node) return;
    await session.nukeNode(node);
    await advanceCombatTurn();
    this.broadcast(sessionId, session);
  }

  private static async handleRequestStop(sessionId: string, nodeKey?: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const node = nodeKey ? session.graph.nodes.get(nodeKey) : undefined;
    await session.stopVirus(node);
    await advanceCombatTurn();
    this.broadcast(sessionId, session);
  }

  private static async handleRequestFortify(sessionId: string, nodeKey: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const node = session.graph.nodes.get(nodeKey);
    if (!node) return;
    await session.fortifyHackerNode(node);
    await advanceCombatTurn();
    this.broadcast(sessionId, session);
  }

  private static async handleRequestMove(sessionId: string, nodeKey: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const node = session.graph.nodes.get(nodeKey);
    if (!node) return;
    session.moveTo(node);
    await advanceCombatTurn();
    this.broadcast(sessionId, session);
  }

  /** Player-side abort request: doesn't cost a combat turn, unlike the other requests -
   * calling the whole thing off isn't "an action" the hacker took. */
  private static async handleRequestAbort(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.abort();
    this.broadcast(sessionId, session);
  }

  /** Player-side: call off the hack early. */
  static requestAbort(sessionId: string): void {
    this.socket?.executeAsGM("requestAbort", sessionId);
  }

  private static async handleRequestScan(sessionId: string): Promise<ScanResult | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    const result = await session.scan(Side.HACKER);
    this.broadcast(sessionId, session);
    return result;
  }

  /** Player-side: attempt to scan for the trace side's position (see HackSession.scan). */
  static async requestScan(sessionId: string): Promise<ScanResult | undefined> {
    return this.socket?.executeAsGM("requestScan", sessionId);
  }

  private static handleRequestState(sessionId: string): ManagedSessionState | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    return this.serialize(sessionId, session);
  }

  /** Player-side: fetch the current state of a managed session from the GM to open a view cold. */
  static async fetchState(sessionId: string): Promise<ManagedSessionState> {
    return this.socket.executeAsGM("requestState", sessionId);
  }

  /**
   * Runs on whichever client receives a `promptOpenPlayerView` call: opens that client's
   * own live view via the public API rather than reaching into a specific Application
   * instance, since the GM has no direct handle on the player's client.
   */
  private static handlePromptOpenPlayerView(sessionId: string): void {
    const api = (game as any).modules?.get?.(MODULE_ID)?.api;
    api?.openManagedPlayerView(sessionId);
  }

  /** GM: ask a specific user's client to open its live view for a managed session it didn't start itself. */
  static promptOpenPlayerView(sessionId: string, userId: string): void {
    this.socket?.executeAsUser("promptOpenPlayerView", userId, sessionId);
  }

  // --- Player-side helpers: send a request to the GM. ---

  static requestCapture(sessionId: string, node: HackNode): void {
    this.socket?.executeAsGM("requestCapture", sessionId, node.key);
  }

  static requestNuke(sessionId: string, node: HackNode): void {
    this.socket?.executeAsGM("requestNuke", sessionId, node.key);
  }

  static requestStop(sessionId: string, node?: HackNode): void {
    this.socket?.executeAsGM("requestStop", sessionId, node?.key);
  }

  static requestFortify(sessionId: string, node: HackNode): void {
    this.socket?.executeAsGM("requestFortify", sessionId, node.key);
  }

  static requestMove(sessionId: string, node: HackNode): void {
    this.socket?.executeAsGM("requestMove", sessionId, node.key);
  }

  /**
   * GM: let the trace side attempt to (re)capture everything on its frontier for one turn
   * (called manually or from a combat-turn hook), then broadcast. The trace *value* itself
   * isn't ticked here directly - it's derived from graph proximity as a side effect of
   * whichever of these captures actually succeed (see HackSession.recomputeManagedTrace).
   */
  static advanceTurn(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const traceActiveNode = session.traceActiveNodeKey ? (session.graph.nodes.get(session.traceActiveNodeKey) ?? null) : null;
    for (const node of session.graph.nodes.values()) {
      if (node.canBeCaptured(true, traceActiveNode) && !node.stopped) {
        void session.traceCaptureNode(node).then(() => this.broadcast(sessionId, session));
      }
    }
    this.broadcast(sessionId, session);
  }
}
