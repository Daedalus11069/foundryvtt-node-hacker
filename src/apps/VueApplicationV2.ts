import type { App as VueApp } from "vue";

/**
 * Shared ApplicationV2 scaffolding for every Node Hacker window: each one is just a thin
 * frame around a single Vue root component - no Handlebars template/parts, no per-window
 * render logic beyond "build a mount point once, mount Vue into it, unmount on close".
 * Subclasses only provide their own DEFAULT_OPTIONS and a createVueApp() factory.
 */
export default abstract class VueApplicationV2 extends foundry.applications.api.ApplicationV2 {
  protected vueApp: VueApp | null = null;

  /** Builds (but does not mount) the Vue app for this window - called once, on first render. */
  protected abstract createVueApp(): VueApp;

  /** Optional hook for subclasses that need to run something right after Vue mounts (e.g.
   * persisting initial state). No-op by default. */
  protected onMounted(): void {}

  // No Handlebars parts - the window's entire content is a single div Vue mounts into.
  protected async _renderHTML(_context: unknown, _options: unknown): Promise<HTMLElement> {
    const root = document.createElement("div");
    root.classList.add("node-hacker-vue-root");
    return root;
  }

  protected _replaceHTML(result: unknown, content: HTMLElement, _options: unknown): void {
    content.replaceChildren(result as HTMLElement);
  }

  protected async _onFirstRender(_context: unknown, _options: unknown): Promise<void> {
    const root = (this.element as HTMLElement | undefined)?.querySelector<HTMLElement>(".node-hacker-vue-root");
    if (!root) return;

    this.vueApp = this.createVueApp();
    this.vueApp.mount(root);

    // Foundry measures "auto" height against the empty content div before Vue's synchronous
    // mount above has actually put anything into it - without this, the window renders as a
    // near-empty sliver sized to nothing.
    this.setPosition({ height: "auto" });
    this.onMounted();
  }

  override async close(options?: Record<string, unknown>): Promise<this> {
    this.vueApp?.unmount();
    this.vueApp = null;
    return super.close(options) as Promise<this>;
  }
}
