/** Font Awesome icon per node type, layered onto the diamond/glow node base. Shared by
 * both the live NodeComponent and the Designer's canvas so a node type looks the same in
 * both places. */
export const NODE_ICONS: Record<string, string> = {
  entry: "fa-door-open",
  exit: "fa-flag-checkered",
  server: "fa-server",
  database: "fa-database",
  node: "fa-diagram-project"
};

export function iconForNodeType(type: string): string {
  return NODE_ICONS[type] ?? "fa-diagram-project";
}
