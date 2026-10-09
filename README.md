# Node Hacker

A node-graph hacking minigame for Foundry VTT, built with Vue 3 and real, named ES classes
so third-party modules can hook it with libwrapper as well as through its own API.

## Setup

```
npm install
npm run build   # or npm run watch during development
```

Requires the [socketlib](https://github.com/manuelVo/foundryvtt-socketlib) module for
GM-managed sessions, and optionally [libwrapper](https://github.com/ruipin/fvtt-lib-wrapper)
for third parties hooking module internals directly.

## Untested features

Implemented and built, but not yet run through an actual live session - treat as "should
work, not yet confirmed":

- **PvP (GM-managed, `startManaged`)**: the full GM-vs-player flow - `GmTraceApp`'s manual
  Capture/Fortify/Move context menu, the automatic per-combat-turn advance, socketlib
  request/broadcast round-tripping, and the active-node adjacency rule's interaction with
  the "Strict capture adjacency" setting - has only been exercised by reading the code, not
  by actually playing a managed session end-to-end with a second client. Solo play has been
  used directly and is not included in this caveat.

## Concepts

- **Node difficulty**: each node's number is the difficulty rating fed to `CheckResolver`,
  not a capture duration. A system integration registers a resolver via
  `game.modules.get("foundryvtt-node-hacker").api.checks.setResolver(fn)`, or listens for
  the `foundryvtt-node-hacker.resolveCheck` hook. Without one, a generic d20-vs-DC check is used.
- **Items**: Nuke Virus / Stop Virus are resolved through `api.items`, which matches owned
  items by the `flags.foundryvtt-node-hacker.kind` flag by default. Override matching with
  `api.items.setNukeMatcher` / `setStopMatcher` to point at a system's own item types.
- **Stop Virus**: pauses the trace clock for 3 trace points / 3 seconds in solo play, or
  2 turns in a GM-managed session (see `Trace.applyStop`).
- **Managed sessions**: `api.startManaged(graphConfig, actor)` opens a `GmTraceApp` for the
  GM and returns a `sessionId`; the player opens `api.openManagedPlayerView(sessionId)`.
  All state flows one-way from the GM's authoritative `HackSession` via socketlib.
- **Databases**: optional `NodeType.DATABASE` nodes carry a `reward` (nuke/stop virus +
  quantity) granted to the hacking actor on successful capture, and/or free-text `data`
  (GM-only lore, whispered to the GM the moment the hacker captures that node).
- **Movement/adjacency**: each side has one "current position" node (`activeNodeKey` for
  the hacker, `traceActiveNodeKey` for the trace side). Capture/Nuke are only legal against
  a node directly adjacent to that side's own current position - not just adjacent to
  *something* that side owns - unless the "Strict capture adjacency" world setting is
  turned off, which reverts to the looser "adjacent to anything you own anywhere" rule.
- **Node Designer**: `api.openDesigner()` (or the Token Controls button) opens a grid editor
  for GMs to build graphs, saved to a `Node Hacker Graphs` JournalEntry via `GraphStore`.

## API reference

Everything below hangs off the module's public API instance, reachable once Foundry's
`"ready"` hook has fired (or via `Hooks.once("nodeHacker.ready", (api) => ...)`, which fires
synchronously as soon as the API exists, guaranteed to run before any session restore):

```js
const api = game.modules.get("foundryvtt-node-hacker").api; // a NodeHackerApi instance
```

### Starting a hack

#### `api.startSolo(graphConfig, actor, traceMax = 20, traceUnit = TraceUnit.POINTS)`

Starts a single-player hack where the trace clock runs on its own (no GM involvement).

- `graphConfig: HackGraphConfig` - the graph to run (see "Graph shape" below). Built by hand,
  loaded via `api.graphs.get(name)`, or generated with `generateQuickGraph`/`generateRandomGraph`.
- `actor: Actor | null` - the hacking actor; checks/items resolve against it.
- `traceMax: number` - the trace clock's ceiling in `traceUnit` units (default 20).
- `traceUnit: TraceUnit` - `TraceUnit.POINTS` (default, abstract ticks) or `TraceUnit.TIME`
  (real-world seconds).
- **Returns** `Promise<HackerApp | null>` - the opened Application, or `null` (after an
  `ui.notifications.error`) if `graphConfig` is missing a required node type (Entry/Exit/Server -
  see `HackGraph.validateRequiredTypes`).

#### `api.startManaged(graphConfig, actor, traceMax = 6, defenderActor = null)`

Starts a GM-managed (PvP-style) hack: the GM actively plays the trace side against the
player's hacker, over socketlib.

- `graphConfig: HackGraphConfig`, `actor: Actor | null` - same as `startSolo`.
- `traceMax: number` - starting ceiling for the trace clock; in managed mode this is actually
  overridden to the graph's own hop-distance from the trace's territory to the entry point
  (see `HackSession`'s constructor), so it rarely matters.
- `defenderActor: Actor | null` - optional actor standing in for the trace side, so
  `CheckResolver` can roll a specific NPC/PC's own stats for trace-side checks instead of a
  generic roll.
- **Returns** `{ sessionId: string; gmApp: GmTraceApp } | null` (synchronous - no `await`
  needed) - `null` under the same graph-validation failure as `startSolo`. Hand `sessionId`
  to the player (e.g. in a chat whisper) so they can open their own view with it.

#### `api.openManagedPlayerView(sessionId)`

Opens the hacker-side live view for a managed session the GM already started elsewhere.

- `sessionId: string` - the id returned by `startManaged`.
- **Returns** `Promise<PlayerManagedApp>`.

#### `api.notifyPlayer(sessionId, userId)`

GM-side: asks a specific user's own client to open its `openManagedPlayerView` for a session
it didn't start itself (e.g. after whispering them the session id). Fire-and-forget, no return value.

### Building a graph without the Designer

#### `api.generateQuickGraph(name, stageDifficulties)`

Builds a trivial linear Entry → ... → Server → Exit chain, one node per difficulty given -
for a single quick gate (e.g. "hack this door"), not a real minigame.

- `name: string`, `stageDifficulties: number[]` (defaults to `[1]` if empty).
- **Returns** `HackGraphConfig` (synchronous) - pass straight into `startSolo`/`startManaged`.

#### `api.generateRandomGraph(name, difficulty = 1, size = "medium")`

Builds an actual branching network - multiple routes, lateral connections, a scattering of
database side-objectives - for a real minigame moment without hand-designing one first.

- `name: string`.
- `difficulty: number` - seed difficulty; individual node difficulty is still clamped by
  `setMaxDifficulty` (see below).
- `size: "small" | "medium" | "large" | "huge"` - interior layer count (2/3/5/8).
- **Returns** `HackGraphConfig` (synchronous).

### Saved graphs (`api.graphs`, a `GraphStore`)

Graphs built in the Node Designer (or saved programmatically) persist as flags on a single
`"Node Hacker Graphs"` JournalEntry, keyed by a slug of the graph's `name`.

- `api.graphs.list(): Promise<HackGraphConfig[]>` - every saved graph.
- `api.graphs.get(name: string): Promise<HackGraphConfig | undefined>`.
- `api.graphs.save(graph: HackGraphConfig): Promise<void>` - upserts by name.
- `api.graphs.delete(name: string): Promise<void>`.

#### `api.openDesigner(graphName?)`

Opens the Node Designer app (GM-only grid editor). Pass an existing saved graph's name to
open it pre-loaded for editing.

- **Returns** `Promise<NodeDesignerApp>`.

### System integration points

#### `api.checks` (a `CheckResolver`)

Every capture/nuke/fortify/scan attempt resolves through this. Without a registered
resolver, a generic `1d20` vs `10 + difficulty*2` roll is used so the module works standalone.

- `api.checks.setResolver(fn: CheckResolverFn): void` - register a system's own resolver.
  `clearResolver()` undoes it.
- Alternatively, listen for the `"nodeHacker.resolveCheck"` hook: `Hooks.on("nodeHacker.resolveCheck",
  (context, results) => { results.push(yourResult); })` - the first result in the array shaped
  like a `CheckResult` wins.

```ts
type CheckResolverFn = (context: CheckContext) => Promise<CheckResult> | CheckResult;

interface CheckContext {
  actor: Actor | null;   // hacker's actor, or the defenderActor for a trace-side check; null for solo's automatic trace
  difficulty: number;    // the node's effectiveDifficulty() - turn this into your own DC/target number
  side: Side;             // Side.HACKER | Side.TRACE
  label?: string;         // node label, for your own chat flavor
}

interface CheckResult {
  success: boolean;
  margin?: number;  // optional degree of success/failure, positive = better
  total?: number;   // optional raw roll total, for display
}
```

#### `api.items` (an `ItemConfig`)

Resolves which of an actor's owned items count as Nuke Virus / Stop Virus, and how reward
items get granted. Defaults to matching `item.getFlag("foundryvtt-node-hacker", "kind")`.

- `api.items.setNukeMatcher(fn: (item: Item) => boolean): void` / `setStopMatcher(fn): void` -
  point matching at a system's own item types/names instead of the default flag.
- `api.items.setItemType(type: string): void` - the Foundry `Item.type` used when *granting*
  a database reward (default `"consumable"`, which many systems don't define - **a system
  with its own restricted item-type list must call this**, or granting a reward throws a
  `DataModelValidationError` and silently fails to create the item).
- `getNukeItems(actor)` / `getStopItems(actor): Item[]`, `countNuke(actor)` / `countStop(actor): number`.
- `consumeOne(actor, items): Promise<boolean>` - decrements/deletes the first item with
  quantity > 0.
- `grant(actor, kind, quantity, sourceName?): Promise<void>` - creates (or stacks onto) a
  flagged reward item.

#### `api.setMaxDifficulty(max)` / `api.getMaxDifficulty()`

Ceiling on a node's own *base* difficulty (generated or hand-designed in the Designer) -
backed by `DifficultyConfig`. A system with its own multi-tier difficulty mapping should call
`setMaxDifficulty` during setup to match how many tiers its mapping distinguishes below its
own hardest tier. Defaults to 2 if never called. (A node's *effective* difficulty can still
exceed this via Fortify, which adds +1 on top regardless of the ceiling.)

### Combat-turn integration

#### `api.registerCombatTurnAdvance(sessionId)` / `api.unregisterCombatTurnAdvance(sessionId)`

Opts a managed session into automatically re-attempting every capturable frontier node for
the trace side whenever Foundry's own `"combatTurn"` hook fires (i.e. the trace "plays itself"
on each combat turn, on top of whatever the GM does manually via `GmTraceApp`). Automatically
unregistered once the session completes.

### World settings

- **Strict capture adjacency** (`game.settings` key `strictAdjacency`, default on) - toggles
  whether Capture/Nuke require adjacency to a side's own current-position marker (on) or just
  adjacency to anything that side already owns anywhere on the graph (off). Read
  programmatically via the exported `CaptureRangeConfig.isStrict()`.

### Graph shape (`HackGraphConfig`)

What `graphConfig` looks like everywhere above - the same shape the Node Designer saves/loads:

```ts
interface HackGraphConfig {
  name: string;
  nodes: HackNodeConfig[];
  edges: GraphEdgeConfig[];
}

interface HackNodeConfig {
  x: number;
  y: number;
  type: NodeType;          // "entry" | "exit" | "server" | "node" | "database"
  difficulty: number;      // fed to CheckResolver as-is; clamped by DifficultyConfig when generated/edited in the Designer
  label?: string;
  data?: string;            // DATABASE only: GM-only lore, whispered to the GM on capture
  reward?: { kind: "nuke" | "stop"; quantity: number }; // DATABASE only
}

interface GraphEdgeConfig {
  from: [number, number];  // node [x, y]
  to: [number, number];
  bidirectional: boolean;  // false = one-way a->b; the trace side can still traverse it either
                            // way, only the hacker is restricted to the a->b direction
}
```

A graph needs at least one node of each of `entry`, `exit`, and `server` to be playable -
`HackGraph.validateRequiredTypes()` checks this, and `startSolo`/`startManaged` refuse to
start (returning `null`) otherwise.

## Key classes

All exported from the module's ESM bundle (`export * as ... from "@/..."` in
`src/node-hacker.ts`) for libwrapper targeting: `HackNode`, `HackConnection`, `HackGraph`,
`Trace`, `HackSession`, `HackerApp`, `GmTraceApp`, `PlayerManagedApp`, `NodeDesignerApp`,
`CheckResolver`, `ItemConfig`, `ManagedSession`, `GraphStore`, `RandomGraphGenerator`,
`CaptureRangeConfig`, `NodeHackerApi`.
