import type HackNode from "./HackNode";

export default class HackConnection {
  a: HackNode;
  b: HackNode;
  bidirectional: boolean;

  constructor(a: HackNode, b: HackNode, bidirectional = true) {
    this.a = a;
    this.b = b;
    this.bidirectional = bidirectional;
  }

  getOtherNode(node: HackNode): HackNode {
    return node.equals(this.a) ? this.b : this.a;
  }

  /** Whether traversal is legal ending at `node` (i.e. `node` can be captured from the other
   * end). A one-way connection (bidirectional=false) is directional a -> b for the hacker -
   * they can only capture `b` by way of `a`, never the reverse - but the trace side ignores
   * that directionality entirely and can traverse either way, same as a bidirectional link. */
  endsWith(node: HackNode, trace = false): boolean {
    if (node.equals(this.b)) return true;
    return (this.bidirectional || trace) && node.equals(this.a);
  }

  isCaptured(server = false): boolean {
    return this.a.isCaptured(server) && this.b.isCaptured(server);
  }

  toJSON() {
    return { a: this.a.key, b: this.b.key, bidirectional: this.bidirectional };
  }
}
