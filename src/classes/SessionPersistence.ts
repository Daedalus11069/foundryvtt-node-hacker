import { MODULE_ID } from "@/constants";
import type { HackSessionState } from "./HackSession";

const SOLO_FLAG = "activeSoloSession";
const GM_MANAGED_FLAG = "activeManagedGmSessions";
const PLAYER_MANAGED_FLAG = "activeManagedPlayerSessions";

/**
 * Persists in-progress sessions to the current user's own flags so a page refresh doesn't
 * lose them - a HackSession/ManagedSession otherwise only ever lives in memory. Solo and
 * GM-managed sessions store their full HackSessionState (enough to rebuild exactly where
 * they left off, see HackSession.restore); a player's managed view has no authoritative
 * state of its own, so it only remembers the session id and re-fetches current state from
 * the GM on restore.
 */
export default class SessionPersistence {
  private static user(): any {
    return (game as any).user;
  }

  /** Returns the write's own promise (not fire-and-forget) - a caller that awaits this
   * shrinks the window in which a page refresh can race an in-flight save and lose the
   * most recent action, down to the actual write's network round-trip instead of it being
   * effectively instant. Doesn't fully eliminate that window (a refresh can still interrupt
   * an in-flight await), but every action this module performs already awaits a die roll or
   * similar first, so this adds negligible extra latency for a real reduction in risk. */
  static saveSolo(state: HackSessionState): Promise<unknown> {
    return this.user()?.setFlag(MODULE_ID, SOLO_FLAG, state) ?? Promise.resolve();
  }

  static clearSolo(): Promise<unknown> {
    return this.user()?.unsetFlag(MODULE_ID, SOLO_FLAG) ?? Promise.resolve();
  }

  static loadSolo(): HackSessionState | undefined {
    return this.user()?.getFlag(MODULE_ID, SOLO_FLAG);
  }

  /** See saveSolo's comment on why this returns the write's promise instead of discarding it. */
  static saveManagedGm(sessionId: string, state: HackSessionState): Promise<unknown> {
    return this.user()?.setFlag(MODULE_ID, `${GM_MANAGED_FLAG}.${sessionId}`, state) ?? Promise.resolve();
  }

  static clearManagedGm(sessionId: string): Promise<unknown> {
    return this.user()?.unsetFlag(MODULE_ID, `${GM_MANAGED_FLAG}.${sessionId}`) ?? Promise.resolve();
  }

  static loadManagedGmSessions(): Record<string, HackSessionState> {
    return this.user()?.getFlag(MODULE_ID, GM_MANAGED_FLAG) ?? {};
  }

  static saveManagedPlayer(sessionId: string): void {
    const existing: string[] = this.user()?.getFlag(MODULE_ID, PLAYER_MANAGED_FLAG) ?? [];
    if (existing.includes(sessionId)) return;
    void this.user()?.setFlag(MODULE_ID, PLAYER_MANAGED_FLAG, [...existing, sessionId]);
  }

  static clearManagedPlayer(sessionId: string): void {
    const existing: string[] = this.user()?.getFlag(MODULE_ID, PLAYER_MANAGED_FLAG) ?? [];
    void this.user()?.setFlag(
      MODULE_ID,
      PLAYER_MANAGED_FLAG,
      existing.filter((id) => id !== sessionId)
    );
  }

  static loadManagedPlayerSessionIds(): string[] {
    return this.user()?.getFlag(MODULE_ID, PLAYER_MANAGED_FLAG) ?? [];
  }
}
