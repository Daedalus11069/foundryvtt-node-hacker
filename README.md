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
  quantity) granted to the hacking actor on successful capture.
- **Node Designer**: `api.openDesigner()` (or the module settings menu) opens a grid editor
  for GMs to build graphs, saved to a `Node Hacker Graphs` JournalEntry via `GraphStore`.

## Key classes

All exported from the module's ESM bundle (`export * as ... from "@/..."` in
`src/node-hacker.ts`) for libwrapper targeting: `HackNode`, `HackConnection`, `HackGraph`,
`Trace`, `HackSession`, `HackerApp`, `GmTraceApp`, `PlayerManagedApp`, `NodeDesignerApp`,
`CheckResolver`, `ItemConfig`, `ManagedSession`, `GraphStore`.
