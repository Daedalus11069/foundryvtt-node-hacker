import { reactive } from "vue";
import { MODULE_ID } from "@/constants";
import NodeHackerApi from "@/api/NodeHackerApi";
import ManagedSession from "@/managed/ManagedSession";
import HackSession from "@/classes/HackSession";
import SessionPersistence from "@/classes/SessionPersistence";
import CaptureRangeConfig from "@/classes/CaptureRangeConfig";
import HackerApp from "@/apps/HackerApp";
import GmTraceApp from "@/apps/GmTraceApp";
import PlayerManagedApp from "@/apps/PlayerManagedApp";
import "./styles/node-hacker.scss";

// Re-export the named classes so they can be imported/hooked directly, and so libwrapper
// targets (e.g. "HackerApp.prototype._onFirstRender") resolve to real prototypes.
export { default as HackNode } from "@/classes/HackNode";
export { default as HackConnection } from "@/classes/HackConnection";
export { default as HackGraph } from "@/classes/HackGraph";
export { default as Trace } from "@/classes/Trace";
export { default as HackSession } from "@/classes/HackSession";
export { default as GraphStore } from "@/classes/GraphStore";
export { default as RandomGraphGenerator } from "@/classes/RandomGraphGenerator";
export { default as HackerApp } from "@/apps/HackerApp";
export { default as GmTraceApp } from "@/apps/GmTraceApp";
export { default as PlayerManagedApp } from "@/apps/PlayerManagedApp";
export { default as NodeDesignerApp } from "@/apps/NodeDesignerApp";
export { default as CheckResolver } from "@/api/CheckResolver";
export { default as ItemConfig } from "@/api/ItemConfig";
export { default as ManagedSession } from "@/managed/ManagedSession";
export { default as NodeHackerApi } from "@/api/NodeHackerApi";
export { default as CaptureRangeConfig } from "@/classes/CaptureRangeConfig";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing`);
  CaptureRangeConfig.register();
});

(Hooks.once as (hook: string, fn: (...args: any[]) => any) => number)("socketlib.ready", () => {
  ManagedSession.init();
});

Hooks.once("ready", () => {
  const mod = (game as any).modules.get(MODULE_ID);
  const api = new NodeHackerApi();
  mod.api = api;

  // Fired synchronously, immediately - before the setTimeout below queues restoreSessions -
  // so an integrating system can register its CheckResolver (game.modules.get(MODULE_ID).api
  // .checks.setResolver(...)) in direct response to this event and be guaranteed to beat
  // restoreSessions, regardless of whichever order Foundry happens to fire different
  // modules'/the system's own "ready" hooks in relative to this one. A system that instead
  // tries to register from its OWN "ready" hook is racing an unspecified order: if that
  // hook fires BEFORE this one, `mod.api` doesn't exist yet and the registration attempt
  // silently no-ops, and a session restored below after a refresh is then stuck on this
  // module's own generic d20-vs-DC fallback (see CheckResolver.fallback) since nothing ever
  // registered on this exact instance. Listening for this hook instead needs no timing
  // assumption at all - it needs only to have called `Hooks.once("nodeHacker.ready", ...)`
  // at any point before this line runs, e.g. from the listener's own "init" hook.
  (Hooks.callAll as (...args: any[]) => void)("nodeHacker.ready", api);

  // Deliberately NOT called synchronously here: "ready" fires before the rest of Foundry's
  // own UI has finished its own first render/settle pass, and rendering our Application this
  // early - before the browser's had a chance to actually paint with our module's stylesheet
  // applied - produces a window that looks entirely unstyled (Foundry's bare default sheet
  // chrome) until something else forces a reflow. A manual open never hits this, since a user
  // can only click the button well after everything's already settled. One tick is enough.
  setTimeout(() => restoreSessions(api), 0);
});

/**
 * Reopens whatever hacking windows this user had open before their last refresh - a
 * HackSession/ManagedSession otherwise only ever lives in memory, so a reload would
 * otherwise silently abandon an in-progress hack. Each kind restores independently and
 * tolerates its own failure (e.g. a referenced actor or GM session no longer existing)
 * without blocking the others.
 */
async function restoreSessions(api: NodeHackerApi): Promise<void> {
  const soloState = SessionPersistence.loadSolo();
  if (soloState) {
    try {
      // reactive() here too - see NodeHackerApi.startSolo's identical comment. Without it, a
      // restored session's node/trace mutations never trigger a Vue re-render at all, since
      // HackSession.restore() otherwise hands back a plain, un-proxied instance.
      const session = reactive(HackSession.restore(soloState, api.checks, api.items)) as HackSession;
      new HackerApp(session).render(true);
    } catch (err) {
      console.error(`${MODULE_ID} | failed to restore solo session`, err);
      SessionPersistence.clearSolo();
    }
  }

  const gmStates = SessionPersistence.loadManagedGmSessions();
  for (const [sessionId, state] of Object.entries(gmStates)) {
    try {
      const session = reactive(HackSession.restore(state, api.checks, api.items)) as HackSession;
      ManagedSession.registerGmSession(sessionId, session);
      new GmTraceApp(sessionId, session).render(true);
    } catch (err) {
      console.error(`${MODULE_ID} | failed to restore managed GM session ${sessionId}`, err);
      SessionPersistence.clearManagedGm(sessionId);
    }
  }

  for (const sessionId of SessionPersistence.loadManagedPlayerSessionIds()) {
    try {
      const state = await ManagedSession.fetchState(sessionId);
      if (!state) throw new Error("session no longer exists on the GM's client");
      new PlayerManagedApp(sessionId, state).render(true);
    } catch (err) {
      console.warn(`${MODULE_ID} | could not restore managed player session ${sessionId}`, err);
      SessionPersistence.clearManagedPlayer(sessionId);
    }
  }
}

// A settings menu (`game.settings.registerMenu`) requires its `type` to be a
// FormApplication/ApplicationV2 subclass - NodeDesignerApp is a plain Application (it has
// no form to submit), so it's exposed as a Token Controls tool instead, matching how other
// non-settings GM tools (e.g. FASERIP's "Present Hack") are surfaced.
// @ts-expect-error - getSceneControlButtons isn't declared in fvtt-types' HookConfig
Hooks.on("getSceneControlButtons", (controls: any) => {
  if (!(game as any).user?.isGM) return;

  const tokenControls = Array.isArray(controls)
    ? controls.find((group: any) => group.name === "tokens")
    : controls?.tokens;
  if (!tokenControls?.tools) return;

  tokenControls.tools["node-hacker-designer"] = {
    name: "node-hacker-designer",
    order: Object.keys(tokenControls.tools).length,
    title: "Node Hacker: Open Designer",
    icon: "fas fa-diagram-project",
    button: true,
    onChange: (_event: Event, active: boolean) => {
      if (!active) return;
      const api = (game as any).modules?.get?.(MODULE_ID)?.api;
      api?.openDesigner();
    }
  };
});

Hooks.on("combatTurn", () => {
  ManagedSession.advanceRegisteredSessions();
});
