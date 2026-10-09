import { markRaw } from "vue";
import { NodeType, Side, TraceMode, TraceUnit } from "@/constants";
import HackGraph, { type HackGraphConfig } from "./HackGraph";
import HackNode from "./HackNode";
import Trace from "./Trace";
import CheckResolver from "@/api/CheckResolver";
import ItemConfig from "@/api/ItemConfig";

/** Graph-hop range within which a Scan can find the opponent (see HackSession.scan). */
const SCAN_RANGE = 2;
/** Difficulty rating used for a Scan check itself, independent of any node's own difficulty. */
const SCAN_DIFFICULTY = 2;

export interface HackSessionOptions {
  graphConfig: HackGraphConfig;
  actor: Actor | null;
  mode: TraceMode;
  traceMax: number;
  traceUnit?: TraceUnit;
  checks: CheckResolver;
  items: ItemConfig;
  /**
   * Optional actor standing in for the trace side (e.g. a GM-controlled defender in a
   * managed PvP-style session). When set, trace-side checks resolve with this actor
   * instead of `null`, so a system integration can roll the defender's own stats instead
   * of falling back to a generic check.
   */
  defenderActor?: Actor | null;
}

export interface ScanResult {
  inRange: boolean;
  success: boolean;
}

/** A snapshot of everything a HackSession needs to be rebuilt exactly where it left off -
 * see toState()/restore(). Used to survive a page refresh, which otherwise loses the
 * session entirely since it only ever lived in memory. */
export interface HackSessionState {
  graphConfig: HackGraphConfig;
  actorId: string | null;
  defenderActorId: string | null;
  mode: TraceMode;
  traceUnit: TraceUnit;
  trace: ReturnType<Trace["toJSON"]>;
  detectedByTrace: boolean;
  traceMapped: boolean;
  hackerMapped: boolean;
  completionAnnounced: boolean;
  aborted: boolean;
  activeNodeKey: string | null;
  traceActiveNodeKey: string | null;
  nodes: Record<string, { owner: Side | null; capturing: Side | null; stopped: boolean; fortifyBonus: number }>;
}

/**
 * Runs a single hacking attempt: owns the graph, the trace clock, and the rules for
 * capturing/nuking/stopping nodes. Used identically by solo play and by the GM side
 * of a managed session (the managed session just proxies moves to a shared instance).
 *
 * Node ownership is contested: either side can capture a node the other already holds
 * (see HackNode.canBeCaptured), so this isn't two independent progress races meeting in
 * the middle - it's a real back-and-forth fight over the same graph.
 */
export default class HackSession {
  graph: HackGraph;
  actor: Actor | null;
  trace: Trace;
  checks: CheckResolver;
  items: ItemConfig;
  defenderActor: Actor | null;
  detectedByTrace = false;
  /** Whether the hacker has successfully scanned for the trace side's position (see scan()). */
  traceMapped = false;
  /** Whether the trace side has successfully scanned for the hacker's position, on top of
   * whatever `hackerSpotted` already grants passively. */
  hackerMapped = false;
  /** Set by abort() - either side calling off the hack early, distinct from winning or
   * getting caught. Checked LAST in isComplete(), after the actual win/loss conditions -
   * every app's close() handler calls abort() unconditionally as a "safe no-op if already
   * resolved", but that's only actually safe if a real win/loss that happened to complete
   * without an intervening checkCompletion() call (e.g. a managed trace closing the
   * distance to zero between broadcasts) still takes priority over it. */
  aborted = false;

  /** Which node the hacker is currently "at", for display purposes only - it doesn't gate
   * anything mechanically (a hacker can still act from ANY node they own, per
   * HackNode.canBeCaptured's reachability check), it's just a visual anchor answering "where
   * am I in this puzzle" given free traversal between owned nodes. Starts at an Entry node
   * and moves to whichever owned node the hacker most recently acted on (see
   * recordHackerActiveNode). Null only if the graph somehow has no Entry (validateRequiredTypes
   * would already have refused to start such a graph, but this stays defensive). */
  activeNodeKey: string | null = null;

  /** Same idea as activeNodeKey, mirrored for the trace side - its current-position node,
   * starting at a Server (the trace's home base, owned by TRACE from the graph's own
   * construction - see HackNode's constructor) and moving to whichever node the trace side
   * most recently captured/fortified/explicitly moved to (see traceMoveTo). Only ever
   * meaningful in managed mode, where the trace side takes real manual actions at all (see
   * GmTraceView) - solo/passive trace has no such position to track. */
  traceActiveNodeKey: string | null = null;

  constructor(options: HackSessionOptions) {
    this.graph = new HackGraph(options.graphConfig);

    // A graph missing an Entry, Exit, or Server can't produce a coherent hack (no starting
    // point, or no way to ever win - see HackGraph.isGoalCaptured) - refuse to start rather
    // than silently running a session with no possible win condition. NodeHackerApi's
    // startSolo/startManaged catch this and surface it as a GM-facing notification.
    const missing = this.graph.validateRequiredTypes();
    if (missing.length > 0) {
      throw new Error(`Node Hacker | graph "${this.graph.name}" is missing required node(s): ${missing.join(", ")}`);
    }

    this.activeNodeKey = this.graph.getNodesByType(NodeType.ENTRY)[0]?.key ?? null;
    this.traceActiveNodeKey = this.graph.getNodesByType(NodeType.SERVER)[0]?.key ?? null;

    // markRaw so Vue's reactive() (applied by NodeHackerApi.startSolo/startManaged to this
    // whole session, for the app's UI to react to node/trace mutations) never deep-wraps
    // these Document references in a Proxy. A real Foundry Actor has non-configurable,
    // non-writable own data properties (e.g. `_dependentTokens`, a private WeakMap-backed
    // field its own getActiveTokens()/getDependentTokens() read via `this`) - the Proxy
    // invariants for such a property require the trap to return the EXACT original value,
    // which a deep-reactive get trap can't satisfy for a nested object, so calling a method
    // that touches one through the reactive-wrapped actor hard-throws a TypeError instead of
    // just silently losing reactivity. Session-owned state (node ownership, trace value, ...)
    // still needs to stay reactive for the UI; the actor references themselves never do -
    // nothing here ever reads/writes through `this.actor` expecting Vue to react to it.
    this.actor = options.actor ? (markRaw(options.actor) as Actor) : null;
    this.checks = options.checks;
    this.items = options.items;
    this.defenderActor = options.defenderActor ? (markRaw(options.defenderActor) as Actor) : null;
    this.trace = new Trace({ mode: options.mode, max: options.traceMax }, options.traceUnit);

    // In managed mode, the trace value is driven by actual graph proximity (see
    // recomputeManagedTrace) rather than an arbitrary elapsed-turn count, so its max is the
    // graph's own starting hop-distance from the trace's territory to the hacker's entry
    // point - not the caller-supplied traceMax, which only matters for solo's abstract clock.
    if (options.mode === TraceMode.MANAGED) {
      const startingDistance = this.graph.hopDistanceToType(Side.TRACE, NodeType.ENTRY);
      if (Number.isFinite(startingDistance) && startingDistance > 0) {
        this.trace.max = startingDistance;
      }
      this.recomputeManagedTrace();
    }
  }

  /**
   * Re-derives the trace value from how many hops the trace side's owned territory
   * currently is from the hacker's entry point - closing that gap (by capturing nodes
   * toward it) raises the value; the hacker recapturing nodes away from the trace pushes
   * it back down. No-op outside managed mode.
   */
  private recomputeManagedTrace(): void {
    if (this.trace.mode !== TraceMode.MANAGED) return;
    const distance = this.graph.hopDistanceToType(Side.TRACE, NodeType.ENTRY);
    if (!Number.isFinite(distance)) return;

    const wasDetected = this.trace.detected;
    this.trace.setValue(this.trace.max - distance);
    if (this.trace.detected) {
      this.detectedByTrace = true;
      // Managed mode's trace never goes through registerAttempt (see announceDetection's
      // other call site in attemptCapture/fortifyNode) - proximity closing to zero is the
      // only way it gets caught, so this is the one place that transition needs its own echo.
      if (!wasDetected) this.announceDetection(true);
    }
  }

  /** Whether the trace side has any reason to know the hacker is here - the first sign of
   * trouble, not "caught" (that's `trace.detected` / isComplete()'s loss condition). Gates
   * what a managed session's GM view is allowed to show of the hacker's progress. */
  get hackerSpotted(): boolean {
    return this.trace.value > 0 || this.trace.detected;
  }

  /** Attempt to capture a node as the hacker. Resolves a check against the node's difficulty. */
  async captureNode(node: HackNode): Promise<boolean> {
    return this.attemptCapture(node, Side.HACKER);
  }

  /** Move the hacker's current-position marker to a node they already own - no dice check
   * (repositioning within territory already held isn't a contest), but still costs a turn
   * the same as every other action (see HackerView's runAction). Returns false (and does
   * nothing) for a node the hacker doesn't currently own. */
  moveTo(node: HackNode): boolean {
    if (node.owner !== Side.HACKER) return false;
    this.activeNodeKey = node.key;
    return true;
  }

  /** Trace-side equivalent of moveTo - the GM manually repositioning where the trace is
   * "standing" among nodes it already holds. Same no-dice-check/costs-a-turn shape. */
  traceMoveTo(node: HackNode): boolean {
    if (node.owner !== Side.TRACE) return false;
    this.traceActiveNodeKey = node.key;
    return true;
  }

  /** Resolves a side's current-position key back to the live HackNode - see
   * HackNode.canBeCaptured, the only real consumer of this. */
  private getActiveNode(side: Side): HackNode | null {
    const key = side === Side.TRACE ? this.traceActiveNodeKey : this.activeNodeKey;
    return key ? (this.graph.nodes.get(key) ?? null) : null;
  }

  /** GM/trace side attempting to (re)capture a node - including one the hacker already holds. */
  async traceCaptureNode(node: HackNode): Promise<boolean> {
    if (node.stopped) return false;
    return this.attemptCapture(node, Side.TRACE);
  }

  /** Hacker reinforcing a node they already hold. */
  async fortifyHackerNode(node: HackNode): Promise<boolean> {
    return this.fortifyNode(node, Side.HACKER);
  }

  /** GM/trace side reinforcing a node they already hold - the same manual PvP action as
   * fortifyHackerNode, mirrored for the other side (see GmTraceView). */
  async fortifyTraceNode(node: HackNode): Promise<boolean> {
    return this.fortifyNode(node, Side.TRACE);
  }

  private async attemptCapture(node: HackNode, side: Side): Promise<boolean> {
    if (!node.canBeCaptured(side === Side.TRACE, this.getActiveNode(side))) return false;

    node.capturing = side;
    const result = await this.checks.resolve({
      actor: side === Side.HACKER ? this.actor : this.defenderActor,
      difficulty: node.effectiveDifficulty(),
      side,
      label: node.label ?? `${side === Side.HACKER ? "Capture" : "Trace"} ${node.key}`
    });

    node.capturing = null;
    if (result.success) {
      // A Fortify defense belongs to whoever earned it - the incoming side hasn't, so it
      // doesn't carry over onto them just because they took the node it was sitting on.
      if (node.owner !== side) node.fortifyBonus = 0;
      node.owner = side;
      if (side === Side.HACKER && node.isDatabase()) {
        await this.claimDatabaseReward(node);
      }
      if (side === Side.HACKER) this.activeNodeKey = node.key;
      else this.traceActiveNodeKey = node.key;
      this.recomputeManagedTrace();
    }

    // Only the hacker's own attempts can trip their own detection meter/clock - the trace
    // side recapturing something isn't a mistake the hacker made.
    if (side === Side.HACKER) this.recordHackerAttempt(node, result.success);

    return result.success;
  }

  /** Reinforce a node this side already holds, raising the difficulty the opponent faces to
   * take it back by exactly 1 - e.g. FASERIP's difficulty-2 (Yellow-or-better) ceiling
   * becomes a difficulty-3 (Red-only) node once fortified. That's the only way a node ever
   * reaches difficulty 3; generation itself is capped at 2 (see RandomGraphGenerator). Only
   * ever applies once - fortifying an already-fortified node is a no-op past that point. */
  async fortifyNode(node: HackNode, side: Side): Promise<boolean> {
    if (node.owner !== side || node.capturing !== null || node.fortifyBonus >= 1) return false;

    node.capturing = side;
    const result = await this.checks.resolve({
      actor: side === Side.HACKER ? this.actor : this.defenderActor,
      difficulty: node.effectiveDifficulty(),
      side,
      label: node.label ?? `Fortify ${node.key}`
    });

    node.capturing = null;
    if (result.success) {
      node.fortifyBonus = 1;
      if (side === Side.HACKER) this.activeNodeKey = node.key;
      else this.traceActiveNodeKey = node.key;
    }

    if (side === Side.HACKER) this.recordHackerAttempt(node, result.success);

    return result.success;
  }

  /**
   * Registers a hacker attempt's outcome against the trace (see Trace.registerAttempt), and
   * echoes any resulting detection progress to the chat log - not just a client-local
   * notification, so it's actually visible in the shared log rather than only to whoever's
   * client happened to be looking. System-agnostic wording on purpose: this lives in the
   * module's own core session logic, not a system integration.
   */
  private recordHackerAttempt(node: HackNode, success: boolean): void {
    const tripped = !success;
    const newlyDetected = this.trace.registerAttempt(tripped, node.effectiveDifficulty());
    if (newlyDetected) this.detectedByTrace = true;
    if (tripped || newlyDetected) this.announceDetection(newlyDetected, node);
  }

  /**
   * Posts an actual ChatMessage (not just a client-local notification) whenever detection
   * progresses or completes, so it's visible in the shared log to everyone, not only whoever
   * happened to be looking at the client where it happened. `node` is omitted for managed
   * mode's proximity-based detection (see recomputeManagedTrace), which isn't tied to any one
   * capture attempt.
   */
  private announceDetection(caught: boolean, node?: HackNode): void {
    const speaker = this.actor ? ChatMessage.getSpeaker({ actor: this.actor }) : undefined;
    const actorName = this.actor?.name ?? "The hacker";
    let content: string;
    if (caught) {
      content = `<p><strong>Trace complete!</strong> ${actorName} has been caught.</p>`;
    } else if (node) {
      const label = node.label ?? `${node.type} node`;
      content = `<p><strong>Intrusion detected!</strong> A failed attempt on ${label} (difficulty ${node.effectiveDifficulty()}) advanced the trace.</p>`;
    } else {
      content = `<p><strong>Intrusion detected!</strong> The trace has closed in on ${actorName}.</p>`;
    }
    void ChatMessage.create({ speaker, content, flavor: "Node Hacker" } as any).catch(() => {});
  }

  /** Use a Nuke Virus item to instantly seize a node the hacker doesn't already hold, no check -
   * still requires the same access a normal capture would (reachable from a node already held),
   * it just skips rolling. */
  async nukeNode(node: HackNode): Promise<boolean> {
    if (!this.actor || !node.canBeCaptured(false)) return false;
    const items = this.items.getNukeItems(this.actor);
    if (items.length === 0) return false;

    const consumed = await this.items.consumeOne(this.actor, items);
    if (!consumed) return false;

    if (node.owner !== Side.HACKER) node.fortifyBonus = 0;
    node.owner = Side.HACKER;
    if (node.isDatabase()) {
      await this.claimDatabaseReward(node);
    }
    this.recomputeManagedTrace();
    return true;
  }

  /** Use a Stop Virus item to pause the trace clock. */
  async stopVirus(node?: HackNode): Promise<boolean> {
    if (!this.actor) return false;
    const items = this.items.getStopItems(this.actor);
    if (items.length === 0) return false;

    const consumed = await this.items.consumeOne(this.actor, items);
    if (!consumed) return false;

    this.trace.applyStop();
    if (node) node.stopped = true;
    return true;
  }

  /**
   * Attempt to find the opponent: only possible within SCAN_RANGE graph-hops of a node
   * the scanning side already owns, and even then only reveals them on a successful check.
   * A successful hacker scan sets `traceMapped`; a successful trace-side scan sets
   * `hackerMapped` (on top of whatever `hackerSpotted` already grants passively once the
   * hacker's caused any trace progress at all).
   */
  async scan(side: Side): Promise<ScanResult> {
    const opponent = side === Side.HACKER ? Side.TRACE : Side.HACKER;
    const inRange = this.graph.hopDistanceBetweenOwners(side, opponent) <= SCAN_RANGE;
    if (!inRange) return { inRange: false, success: false };

    const result = await this.checks.resolve({
      actor: side === Side.HACKER ? this.actor : this.defenderActor,
      difficulty: SCAN_DIFFICULTY,
      side,
      label: "Scan"
    });

    if (result.success) {
      if (side === Side.HACKER) this.traceMapped = true;
      else this.hackerMapped = true;
    }

    return { inRange: true, success: result.success };
  }

  /** Grants this database's reward item (if any) and echoes its `data` text to the GM (if
   * any) - the two are independent: a database can carry lore/data without a mechanical
   * reward, or vice versa. Called the moment the hacker actually captures the node, not just
   * whenever it changes hands, so the GM's notice lands exactly when the breach happens. */
  private async claimDatabaseReward(node: HackNode): Promise<void> {
    if (this.actor && node.reward) {
      await this.items.grant(this.actor, node.reward.kind, node.reward.quantity, this.graph.name);
    }
    if (node.data) this.announceDatabaseData(node);
  }

  /** Whispers the GM(s) what data the hacker just pulled from a captured database - the
   * `data` text itself is GM-authored reference material (what it actually contains, story
   * implications, etc.), so it goes out as a GM-only whisper rather than a public chat card
   * the way detection/completion announcements do. */
  private announceDatabaseData(node: HackNode): void {
    const gmIds = (game as any).users?.filter((u: any) => u.isGM).map((u: any) => u.id) ?? [];
    if (gmIds.length === 0) return;
    const actorName = this.actor?.name ?? "The hacker";
    const label = node.label ?? "a database";
    void ChatMessage.create({
      whisper: gmIds,
      speaker: this.actor ? ChatMessage.getSpeaker({ actor: this.actor }) : undefined,
      content: `<p><strong>Data acquired:</strong> ${actorName} captured ${label}.</p><p>${node.data}</p>`,
      flavor: "Node Hacker (GM only)"
    } as any).catch(() => {});
  }

  /** Advance the trace clock by one tick of its native unit. Returns true if the hacker was just detected. */
  advanceTrace(amount = 1): boolean {
    const detected = this.trace.advance(amount);
    if (detected) this.detectedByTrace = true;
    return detected;
  }

  /** Calls off the hack early - neither a win nor a loss. Only takes effect once; a session
   * that's already resolved (won/lost/already aborted) can't be re-flagged. */
  abort(): void {
    if (this.completionAnnounced || this.aborted) return;
    this.aborted = true;
  }

  isComplete(): "won" | "lost" | "aborted" | null {
    // Win/loss are checked BEFORE the abort flag on purpose: abort() gets called
    // unconditionally by every app's close() handler (titlebar X, not just the explicit
    // "Abort Hack" button) as a "safe no-op if already resolved" - but that safety only
    // works if the game state is actually consulted first. If the trace naturally completes
    // (e.g. via ManagedSession.advanceTurn's automatic per-turn tick) without another
    // broadcast/checkCompletion() call happening before the window then closes, abort()
    // would otherwise win the race and report a real loss as merely "aborted".
    if (this.graph.isGoalCaptured()) return "won";
    if (this.trace.detected || this.graph.isTraceVictory()) return "lost";
    if (this.aborted) return "aborted";
    return null;
  }

  private completionAnnounced = false;

  /**
   * Same result as isComplete(), but also posts a one-time completion chat card (result
   * headline + which database nodes the hacker actually captured, and their rewards) the
   * first time a result is observed. UI code that needs to react to completion should call
   * this instead of isComplete() directly, so the chat card fires exactly once regardless of
   * how many places notice completion (HackerApp's onChanged fires after every single
   * action, not just the deciding one).
   */
  checkCompletion(): "won" | "lost" | "aborted" | null {
    const result = this.isComplete();
    if (result && !this.completionAnnounced) {
      this.completionAnnounced = true;
      this.announceCompletion(result);
    }
    return result;
  }

  private announceCompletion(result: "won" | "lost" | "aborted"): void {
    const actorName = this.actor?.name ?? "The hacker";
    const headline =
      result === "won"
        ? `<p><strong>Hack complete!</strong> ${actorName} reached the goal.</p>`
        : result === "aborted"
          ? `<p><strong>Hack aborted.</strong> ${actorName} called off the attempt.</p>`
          : `<p><strong>Hack failed.</strong> ${actorName} was caught by the trace.</p>`;

    const captured = [...this.graph.getDatabaseNodes()].filter((n) => n.isOwnedBy(Side.HACKER));
    const loot =
      captured.length > 0
        ? `<ul>${captured
            .map((n) => {
              const rewardText = n.reward
                ? `${n.reward.quantity}x ${n.reward.kind === "nuke" ? "Nuke Virus" : "Stop Virus"}`
                : "no reward";
              return `<li>${n.label ?? "Database"} (difficulty ${n.difficulty}) - ${rewardText}</li>`;
            })
            .join("")}</ul>`
        : `<p><em>No databases were breached.</em></p>`;

    const speaker = this.actor ? ChatMessage.getSpeaker({ actor: this.actor }) : undefined;
    void ChatMessage.create({
      speaker,
      content: `${headline}<p><strong>Databases breached:</strong></p>${loot}`,
      flavor: "Node Hacker"
    } as any).catch(() => {});
  }

  getEntryNodes(): HackNode[] {
    return this.graph.getNodesByType(NodeType.ENTRY);
  }

  /** Captures everything needed to rebuild this exact session later - see HackSessionState. */
  toState(): HackSessionState {
    const nodes: HackSessionState["nodes"] = {};
    for (const [key, node] of this.graph.nodes) {
      nodes[key] = { owner: node.owner, capturing: node.capturing, stopped: node.stopped, fortifyBonus: node.fortifyBonus };
    }
    return {
      graphConfig: this.graph.toConfig(),
      actorId: this.actor?.id ?? null,
      defenderActorId: this.defenderActor?.id ?? null,
      mode: this.trace.mode,
      traceUnit: this.trace.unit,
      trace: this.trace.toJSON(),
      detectedByTrace: this.detectedByTrace,
      traceMapped: this.traceMapped,
      hackerMapped: this.hackerMapped,
      completionAnnounced: this.completionAnnounced,
      aborted: this.aborted,
      activeNodeKey: this.activeNodeKey,
      traceActiveNodeKey: this.traceActiveNodeKey,
      nodes
    };
  }

  /** Rebuilds a session from a previously saved toState() snapshot, restoring node
   * ownership/capture state and trace progress exactly - used to resume a hack across a
   * page refresh, since a session otherwise only ever lives in memory. */
  static restore(state: HackSessionState, checks: CheckResolver, items: ItemConfig): HackSession {
    const actor = state.actorId ? ((game as any).actors?.get(state.actorId) ?? null) : null;
    const defenderActor = state.defenderActorId ? ((game as any).actors?.get(state.defenderActorId) ?? null) : null;

    const session = new HackSession({
      graphConfig: state.graphConfig,
      actor,
      mode: state.mode,
      traceMax: state.trace.max,
      traceUnit: state.traceUnit,
      checks,
      items,
      defenderActor
    });

    Object.assign(session.trace, state.trace);
    session.detectedByTrace = state.detectedByTrace;
    session.traceMapped = state.traceMapped;
    session.hackerMapped = state.hackerMapped;
    session.completionAnnounced = state.completionAnnounced;
    session.aborted = state.aborted;
    // Older persisted states predate this field - fall back to whatever the constructor
    // already defaulted it to (the graph's own Entry node) rather than null.
    if (state.activeNodeKey !== undefined) session.activeNodeKey = state.activeNodeKey;
    if (state.traceActiveNodeKey !== undefined) session.traceActiveNodeKey = state.traceActiveNodeKey;
    for (const [key, n] of Object.entries(state.nodes)) {
      const node = session.graph.nodes.get(key);
      if (!node) continue;
      node.owner = n.owner;
      node.capturing = n.capturing;
      node.stopped = n.stopped;
      node.fortifyBonus = n.fortifyBonus;
    }
    return session;
  }
}
