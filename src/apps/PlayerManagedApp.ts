import { createApp, type App as VueApp } from "vue";
import PlayerManagedView from "@/components/PlayerManagedView.vue";
import ManagedSession, {
  type ManagedSessionState
} from "@/managed/ManagedSession";
import SessionPersistence from "@/classes/SessionPersistence";
import VueApplicationV2 from "./VueApplicationV2";

export default class PlayerManagedApp extends VueApplicationV2 {
  sessionId: string;
  initialState: ManagedSessionState;

  constructor(
    sessionId: string,
    initialState: ManagedSessionState,
    options: Record<string, unknown> = {}
  ) {
    super(options);
    this.sessionId = sessionId;
    this.initialState = initialState;
  }

  static override DEFAULT_OPTIONS = {
    id: "node-hacker-player-managed-app",
    classes: ["node-hacker-app", "node-hacker-player-managed-app"],
    window: { title: "Hacking... (Live)", resizable: true },
    position: { width: 920, height: "auto" as const }
  };

  protected createVueApp(): VueApp {
    return createApp(PlayerManagedView, {
      sessionId: this.sessionId,
      initialState: this.initialState,
      onClose: () => this.close()
    });
  }

  protected override onMounted(): void {
    // This client has no authoritative state of its own to persist - just remembers which
    // session id it had open, so a refresh can re-fetch current state from the GM.
    SessionPersistence.saveManagedPlayer(this.sessionId);
  }

  override async close(options?: Record<string, unknown>): Promise<this> {
    // Closing this window before the hack resolved counts as calling it off, same as the
    // explicit "Abort Hack" button - covers the titlebar X too. This client has no
    // authoritative session to check first, but the GM-side abort()/checkCompletion() this
    // triggers are safe no-ops if the session already resolved (won/lost) or was already
    // aborted, so firing it unconditionally here is fine.
    ManagedSession.requestAbort(this.sessionId);
    SessionPersistence.clearManagedPlayer(this.sessionId);
    return super.close(options);
  }
}
