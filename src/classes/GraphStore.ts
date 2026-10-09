import { MODULE_ID } from "@/constants";
import type { HackGraphConfig } from "./HackGraph";

const FLAG_KEY = "graphs";

/**
 * Persists Node Designer output as flags on a single world JournalEntry, so graphs are
 * shareable, exportable with the world, and don't require a dedicated compendium.
 */
export default class GraphStore {
  private static readonly JOURNAL_NAME = "Node Hacker Graphs";

  private static async getJournal(): Promise<any> {
    let entry = game.journal?.getName(this.JOURNAL_NAME);
    if (!entry) {
      entry = await JournalEntry.create({ name: this.JOURNAL_NAME, flags: { [MODULE_ID]: { [FLAG_KEY]: {} } } } as any);
    }
    return entry!;
  }

  static async list(): Promise<HackGraphConfig[]> {
    const entry = await this.getJournal();
    const graphs = (entry.getFlag(MODULE_ID, FLAG_KEY) ?? {}) as Record<string, HackGraphConfig>;
    return Object.values(graphs);
  }

  static async save(graph: HackGraphConfig): Promise<void> {
    const entry = await this.getJournal();
    await entry.setFlag(MODULE_ID, `${FLAG_KEY}.${slug(graph.name)}`, graph);
  }

  static async get(name: string): Promise<HackGraphConfig | undefined> {
    const entry = await this.getJournal();
    return entry.getFlag(MODULE_ID, `${FLAG_KEY}.${slug(name)}`) as HackGraphConfig | undefined;
  }

  static async delete(name: string): Promise<void> {
    const entry = await this.getJournal();
    await entry.unsetFlag(MODULE_ID, `${FLAG_KEY}.${slug(name)}`);
  }
}

function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "graph";
}
