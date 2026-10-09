/**
 * Advances Foundry's own active Combat by one turn. Each node action (Capture/Nuke/Stop/
 * Fortify) costs one turn - rather than inventing a separate per-session turn counter, that
 * cost is spent against Foundry's real combat tracker, which is also what already drives a
 * managed session's automatic trace-side counterplay (see the module's `combatTurn` hook and
 * ManagedSession.advanceRegisteredSessions). A no-op outside of combat (e.g. a lock hack
 * attempted with no encounter running) - the action still happens, there's just no timeline
 * to spend a turn against.
 */
export default async function advanceCombatTurn(): Promise<void> {
  const combat = (game as any)?.combat;
  if (!combat?.started) return;
  await combat.nextTurn();
}
