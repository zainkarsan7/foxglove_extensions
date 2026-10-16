import { ExtensionContext } from "@foxglove/extension";

import { initCraneJointPanel } from "./CraneJointPanel";

export function activate(extensionContext: ExtensionContext): void {
  extensionContext.registerPanel({ name: "Crane Joint Panel", initPanel: initCraneJointPanel });
}
