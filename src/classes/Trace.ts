import { TraceMode, TraceUnit } from "@/constants";

export interface TraceConfig {
  mode: TraceMode;
  /** Total trace budget before the trace "catches" the hacker. */
  max: number;
}

const STOP_DURATION_SECONDS = 3;
const STOP_DURATION_POINTS = 3;
const STOP_DURATION_TURNS = 2;

/** TIME mode: how much the countdown accelerates on every trip after the first (which just
 * starts it running). */
const TIME_RETRIP_PENALTY = 2;

/** POINTS mode: percentage of the 0-100 failure meter a tripped node attempt adds, scaled by
 * that node's difficulty - ported from the prior PvP code's DIFFICULTY_TRACE_POINTS
 * (1/2/3 -> 10/20/35 out of 100), generalized to Node Hacker's open-ended difficulty scale. */
function tracePercentForDifficulty(difficulty: number): number {
  return Math.min(50, Math.max(1, difficulty) * 10 + 5);
}

/**
 * Tracks trace progress and the pause applied by a Stop Virus.
 * Unit depends on mode: solo play uses TIME or POINTS, managed play uses TURNS.
 */
export default class Trace {
  mode: TraceMode;
  unit: TraceUnit;
  value = 0;
  max: number;
  detected = false;

  /** TIME mode only: whether the countdown has actually started running yet - it doesn't
   * tick from the moment the hack begins, only once the hacker first trips detection (fails
   * a node attempt). Unused in POINTS/TURNS mode. */
  started = false;

  /** Remaining pause, expressed in the same unit as `unit`. */
  pauseRemaining = 0;

  constructor(config: TraceConfig, unit: TraceUnit = TraceUnit.TIME) {
    this.mode = config.mode;
    this.unit = this.mode === TraceMode.MANAGED ? TraceUnit.TURNS : unit;
    // POINTS is always a 0-100% failure meter, not an arbitrary caller-chosen total - a
    // caller-supplied max only makes sense for TIME's literal countdown (or TURNS, which
    // overrides its own max from graph proximity regardless - see HackSession's constructor).
    this.max = this.unit === TraceUnit.POINTS ? 100 : config.max;
  }

  get isPaused(): boolean {
    return this.pauseRemaining > 0;
  }

  /** Advance the trace by `amount` of its unit (seconds, points, or turns). Returns true if newly detected. */
  advance(amount: number): boolean {
    if (this.detected) return false;

    if (this.isPaused) {
      this.pauseRemaining = Math.max(0, this.pauseRemaining - amount);
      return false;
    }

    this.value = Math.min(this.max, this.value + amount);
    if (this.value >= this.max) {
      this.detected = true;
      return true;
    }
    return false;
  }

  /** Directly sets the trace value (e.g. from graph proximity in managed mode), rather than
   * incrementing it by a tick amount. Clamped to [0, max]; reaching max still means detected. */
  setValue(v: number): void {
    if (this.detected) return;
    this.value = Math.min(this.max, Math.max(0, v));
    if (this.value >= this.max) this.detected = true;
  }

  /**
   * Ported from the prior PvP-style trace design: a hacker's own node attempt either passes
   * unnoticed or "trips" detection, and what a trip does depends on `unit`:
   * - TIME: the very first trip starts the countdown running (it does nothing before that);
   *   every trip after the first also adds a flat acceleration penalty on top of the normal
   *   per-action tick.
   * - POINTS: there's no passive ticking at all - only a trip adds progress, scaled by the
   *   failed node's own difficulty, so harder nodes are riskier to fail.
   * - TURNS (managed mode): not driven by individual attempts at all; the value is derived
   *   from graph proximity instead (see HackSession.recomputeManagedTrace), so this is a no-op.
   * Returns true if this call newly detected the hacker.
   */
  registerAttempt(tripped: boolean, nodeDifficulty: number): boolean {
    if (this.detected || this.unit === TraceUnit.TURNS) return false;

    if (this.unit === TraceUnit.POINTS) {
      return tripped ? this.advance(tracePercentForDifficulty(nodeDifficulty)) : false;
    }

    // TraceUnit.TIME
    if (!this.started) {
      if (!tripped) return false;
      this.started = true;
      return this.advance(1);
    }
    return this.advance(tripped ? 1 + TIME_RETRIP_PENALTY : 1);
  }

  /** Apply a Stop Virus: pauses the trace for 3 points/3 seconds (solo) or 2 turns (managed). */
  applyStop(): void {
    switch (this.unit) {
      case TraceUnit.TIME:
        this.pauseRemaining = Math.max(this.pauseRemaining, STOP_DURATION_SECONDS);
        break;
      case TraceUnit.POINTS:
        this.pauseRemaining = Math.max(this.pauseRemaining, STOP_DURATION_POINTS);
        break;
      case TraceUnit.TURNS:
        this.pauseRemaining = Math.max(this.pauseRemaining, STOP_DURATION_TURNS);
        break;
    }
  }

  reset(): void {
    this.value = 0;
    this.detected = false;
    this.pauseRemaining = 0;
    this.started = false;
  }

  toJSON() {
    return {
      mode: this.mode,
      unit: this.unit,
      value: this.value,
      max: this.max,
      detected: this.detected,
      pauseRemaining: this.pauseRemaining,
      started: this.started
    };
  }
}
