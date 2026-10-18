import type { ExtensionContext } from "@foxglove/extension";
import { initCraneJointPanel } from "./CraneJointPanel";
export function activate(extensionContext: ExtensionContext): void {
  extensionContext.registerPanel({ name: "Crane Manual Control", initPanel: initCraneJointPanel });
}
