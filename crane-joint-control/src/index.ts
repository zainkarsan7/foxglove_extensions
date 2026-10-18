import { ExtensionContext } from "@foxglove/extension";
import { initCraneJointPanel } from "./CraneJointPanel";

export function activate(context: ExtensionContext): void {
  context.registerPanel({ name: "Crane Manual Control", initPanel: initCraneJointPanel });
}
