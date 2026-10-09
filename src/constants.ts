export const MODULE_ID = "foundryvtt-node-hacker";

export const SOCKET = `module.${MODULE_ID}`;

export enum NodeType {
  ENTRY = "entry",
  EXIT = "exit",
  SERVER = "server",
  NODE = "node",
  DATABASE = "database"
}

export enum ItemKind {
  NUKE = "nuke",
  STOP = "stop"
}

/** Which side of the hack a check/effect applies to. */
export enum Side {
  HACKER = "hacker",
  TRACE = "trace"
}

/** How the trace clock is being run for a session. */
export enum TraceMode {
  /** Solo/automatic: trace advances on a real-time or point-based timer. */
  SOLO = "solo",
  /** A GM actively controls the trace side against a player's hacker. */
  MANAGED = "managed"
}

export enum TraceUnit {
  /** Trace measured in real-world seconds. */
  TIME = "time",
  /** Trace measured in abstract "trace points" (ticks driven by node events). */
  POINTS = "points",
  /** Trace measured in combat turns (managed mode). */
  TURNS = "turns"
}
