import { createApp, type App as VueApp } from "vue";
import DesignerRoot from "@/components/DesignerRoot.vue";
import GraphStore from "@/classes/GraphStore";
import type { HackGraphConfig } from "@/classes/HackGraph";
import VueApplicationV2 from "./VueApplicationV2";

const BLANK_GRAPH: HackGraphConfig = {
  name: "New Graph",
  nodes: [],
  edges: []
};

export default class NodeDesignerApp extends VueApplicationV2 {
  private initial: HackGraphConfig;

  constructor(
    initial: HackGraphConfig = BLANK_GRAPH,
    options: Record<string, unknown> = {}
  ) {
    super(options);
    this.initial = initial;
  }

  static override DEFAULT_OPTIONS = {
    id: "node-hacker-designer-app",
    classes: ["node-hacker-designer-app"],
    window: { title: "Node Graph Designer", resizable: true },
    position: { width: 980, height: "auto" as const }
  };

  static async open(graphName?: string): Promise<NodeDesignerApp> {
    const graph = graphName ? await GraphStore.get(graphName) : undefined;
    const app = new NodeDesignerApp(graph ?? BLANK_GRAPH);
    await app.render(true);
    return app;
  }

  protected createVueApp(): VueApp {
    return createApp(DesignerRoot, {
      initial: this.initial,
      onSave: (graph: HackGraphConfig) => {
        ui.notifications?.info(`Saved node graph "${graph.name}".`);
      }
    });
  }
}
