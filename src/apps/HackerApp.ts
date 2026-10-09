import { createApp, type App as VueApp } from "vue";
import HackerView from "@/components/HackerView.vue";
import type HackSession from "@/classes/HackSession";
import SessionPersistence from "@/classes/SessionPersistence";
import VueApplicationV2 from "./VueApplicationV2";

/**
 * Foundry Application wrapping the solo hacker minigame view.
 * Kept as a real, named class (not an anonymous factory) so libwrapper can target its
 * prototype methods, e.g. `libWrapper.register(MODULE_ID, "HackerApp.prototype._onFirstRender", ...)`.
 */
export default class HackerApp extends VueApplicationV2 {
  session: HackSession;

  constructor(session: HackSession, options: Record<string, unknown> = {}) {
    super(options);
    this.session = session;
  }

  static override DEFAULT_OPTIONS = {
    id: "node-hacker-hacker-app",
    classes: ["node-hacker-app", "node-hacker-hacker-app"],
    window: { title: "Hacking...", resizable: true },
    position: { width: 920, height: "auto" as const }
  };

  protected createVueApp(): VueApp {
    return createApp(HackerView, {
      session: this.session,
      // Awaited by HackerView's runAction before it releases its own busy flag - see that
      // component's comment. Not a full guarantee against every possible refresh timing, but
      // it means the UI's own action-in-flight state (and thus how soon a player CAN act
      // again) tracks the real persistence write rather than treating it as instant.
      onChanged: () => this.onSessionChanged(),
      onClose: () => this.close()
    });
  }

  protected override onMounted(): void {
    // Persist immediately on open too, not just after the first action - a refresh before
    // ever touching a node would otherwise still lose the session.
    void SessionPersistence.saveSolo(this.session.toState());
  }

  protected async onSessionChanged(): Promise<void> {
    // checkCompletion (not isComplete) so the completion chat card - result headline plus
    // which databases got breached - only ever posts once, regardless of how many actions
    // trigger this "changed" handler after the deciding one.
    const result = this.session.checkCompletion();
    if (result) {
      await SessionPersistence.clearSolo();
      (Hooks.callAll as (...args: any[]) => void)(
        "nodeHacker.sessionComplete",
        this.session,
        result
      );
    } else {
      await SessionPersistence.saveSolo(this.session.toState());
    }
  }

  override async close(options?: Record<string, unknown>): Promise<this> {
    // Closing the window - whether via the "Abort Hack" button, the splash's Close button, or
    // just the titlebar X - means this session is done. abort()/checkCompletion() are no-ops
    // if the session already resolved (won/lost) or was already aborted, so this is safe to
    // call unconditionally: it's what actually posts the "Hack aborted" chat card for every
    // way this window can go away that isn't already a win or a loss.
    this.session.abort();
    this.session.checkCompletion();
    await SessionPersistence.clearSolo();
    return super.close(options);
  }
}
