import { MODULE_ID, Side } from "@/constants";

export interface CheckContext {
  /** The actor performing the check, if any (hacker's character; null for GM-run trace ticks). */
  actor: Actor | null;
  /** Difficulty rating pulled straight from the node/graph. Systems decide how to turn this into a DC/target number. */
  difficulty: number;
  /** Which side of the hack this check resolves for. */
  side: Side;
  /** Free-form label for flavor/chat, e.g. the node's name. */
  label?: string;
}

export interface CheckResult {
  success: boolean;
  /** Optional degree of success, e.g. for systems with critical outcomes. Positive = better. */
  margin?: number;
  /** Optional raw roll total, for display purposes. */
  total?: number;
}

export type CheckResolverFn = (context: CheckContext) => Promise<CheckResult> | CheckResult;

/**
 * System integration point. A system-specific module/macro registers a resolver via
 * `game.modules.get("foundryvtt-node-hacker").api.checks.setResolver(fn)`, or the module
 * fires the `nodeHacker.resolveCheck` hook and awaits the first non-undefined response.
 * If nothing is registered, a generic d20-vs-DC fallback is used so the module works standalone.
 */
export default class CheckResolver {
  private resolver: CheckResolverFn | null = null;

  setResolver(fn: CheckResolverFn): void {
    this.resolver = fn;
  }

  clearResolver(): void {
    this.resolver = null;
  }

  async resolve(context: CheckContext): Promise<CheckResult> {
    if (this.resolver) {
      return this.resolver(context);
    }

    const hookResults: unknown[] = [];
    (Hooks.callAll as (...args: any[]) => void)(`${MODULE_ID}.resolveCheck`, context, hookResults);
    const claimed = hookResults.find((r): r is CheckResult => !!r && typeof (r as CheckResult).success === "boolean");
    if (claimed) return claimed;

    return this.fallback(context);
  }

  /** Generic d20 + 0 vs DC(10 + difficulty*2) roll, used when no system integration is registered. */
  private async fallback(context: CheckContext): Promise<CheckResult> {
    const dc = 10 + context.difficulty * 2;
    const roll = await new Roll("1d20").evaluate();
    await roll.toMessage({
      speaker: context.actor ? ChatMessage.getSpeaker({ actor: context.actor }) : undefined,
      flavor: `${context.label ?? "Hack check"} (DC ${dc})`
    });
    return {
      success: roll.total! >= dc,
      total: roll.total!,
      margin: roll.total! - dc
    };
  }
}
