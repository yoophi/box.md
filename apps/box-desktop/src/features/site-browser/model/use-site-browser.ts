import { useEffect, useState, useSyncExternalStore } from "react";
import { isDesktop } from "@/shared/lib/runtime";
import { SiteBrowserController } from "./site-browser-controller";

export function useSiteBrowser() {
  const [controller] = useState(() => new SiteBrowserController());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    if (!isDesktop()) return;
    controller.start();
    return () => controller.stop();
  }, [controller]);
  return { controller, state, overlaySafe: !isDesktop() || state.overlaySafe };
}
