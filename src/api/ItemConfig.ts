import { MODULE_ID } from "@/constants";

export type ItemMatcher = (item: Item) => boolean;

/**
 * Resolves which owned items count as "nuke virus" / "stop virus" items.
 * Defaults to matching an Item's flag `flags.foundryvtt-node-hacker.kind`, but a system
 * integration can override matching (e.g. by item type + name) via the API.
 *
 * Item document shapes (system.quantity, valid `type` values) vary per game system, so
 * this class talks to items loosely (`any`) rather than fighting a single system's schema.
 */
export default class ItemConfig {
  private nukeMatcher: ItemMatcher = (item) => (item as any).getFlag(MODULE_ID, "kind") === "nuke";
  private stopMatcher: ItemMatcher = (item) => (item as any).getFlag(MODULE_ID, "kind") === "stop";

  /** Item `type` used when granting a reward item (see grant()) - "consumable" is NOT a
   * universal Foundry Item type; it only exists in systems that define it themselves. A
   * system with a stricter/different set of valid Item types (e.g. FASERIP only allows
   * power/talent/equipment/contact/armor/weapon) MUST override this via setItemType(),
   * otherwise granting a reward throws a DataModelValidationError and the item is never
   * actually created. */
  private itemType = "consumable";

  setNukeMatcher(fn: ItemMatcher): void {
    this.nukeMatcher = fn;
  }

  setStopMatcher(fn: ItemMatcher): void {
    this.stopMatcher = fn;
  }

  setItemType(type: string): void {
    this.itemType = type;
  }

  getNukeItems(actor: Actor): Item[] {
    return (actor.items as any).filter((i: Item) => this.nukeMatcher(i));
  }

  getStopItems(actor: Actor): Item[] {
    return (actor.items as any).filter((i: Item) => this.stopMatcher(i));
  }

  countNuke(actor: Actor): number {
    return this.getNukeItems(actor).reduce((sum, i: any) => sum + (i.system?.quantity ?? 1), 0);
  }

  countStop(actor: Actor): number {
    return this.getStopItems(actor).reduce((sum, i: any) => sum + (i.system?.quantity ?? 1), 0);
  }

  async consumeOne(actor: Actor, items: Item[]): Promise<boolean> {
    const item = items.find((i: any) => (i.system?.quantity ?? 1) > 0) as any;
    if (!item) return false;
    const quantity = item.system?.quantity ?? 1;
    if (quantity <= 1) {
      await item.delete();
    } else {
      await item.update({ "system.quantity": quantity - 1 });
    }
    return true;
  }

  /** Grants a reward item to an actor by creating a minimal item flagged with the given kind. */
  async grant(actor: Actor, kind: "nuke" | "stop", quantity: number, sourceName?: { name: string } | string): Promise<void> {
    const label = typeof sourceName === "string" ? sourceName : sourceName?.name;
    const existing = (kind === "nuke" ? this.getNukeItems(actor) : this.getStopItems(actor))[0] as any;
    if (existing) {
      await existing.update({ "system.quantity": (existing.system?.quantity ?? 1) + quantity });
      return;
    }
    await (actor as any).createEmbeddedDocuments("Item", [
      {
        name: kind === "nuke" ? "Nuke Virus" : "Stop Virus",
        type: this.itemType,
        system: { quantity },
        flags: {
          [MODULE_ID]: { kind, source: label }
        }
      }
    ]);
  }
}
