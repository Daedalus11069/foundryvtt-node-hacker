import { createApp, type App as VueApp } from "vue";
import GmTraceView from "@/components/GmTraceView.vue";
import type HackSession from "@/classes/HackSession";
import ManagedSession from "@/managed/ManagedSession";
import VueApplicationV2 from "./VueApplicationV2";

export default class GmTraceApp extends VueApplicationV2 {
  /** Must be the same reactive() proxy ManagedSession stores and mutates via socket
   * requests (see NodeHackerApi.startManaged, which wraps it before either this app or
   * ManagedSession ever see it) - mutating the raw, unwrapped object bypasses Vue's proxy
   * traps entirely, so the two must share the identical proxy instance for updates from a
   * player's request to ever reach this view. */
  session: HackSession;
  sessionId: string;

  constructor(sessionId: string, session: HackSession, options: Record<string, unknown> = {}) {
    super(options);
    this.sessionId = sessionId;
    this.session = session;
  }

  static override DEFAULT_OPTIONS = {
    id: "node-hacker-gm-trace-app",
    classes: ["node-hacker-app", "node-hacker-gm-trace-app"],
    window: { title: "Run the Trace", resizable: true },
    position: { width: 920, height: "auto" as const }
  };

  protected createVueApp(): VueApp {
    return createApp(GmTraceView, {
      session: this.session,
      sessionId: this.sessionId,
      onClose: () => this.close()
    });
  }

  override async close(options?: Record<string, unknown>): Promise<this> {
    // Closing the GM's own trace window before the hack resolved on its own counts as
    // calling it off - same as the explicit "Abort Hack" button, just covering every other
    // way this window can go away (titlebar X included). abort()/broadcast are safe no-ops
    // if the session already resolved, and broadcast is what actually posts the chat card
    // and updates the player's own view to reflect it.
    this.session.abort();
    ManagedSession.broadcast(this.sessionId, this.session);
    ManagedSession.unregisterGmSession(this.sessionId);
    return super.close(options);
  }
}
