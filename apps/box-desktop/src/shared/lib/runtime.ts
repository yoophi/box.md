import { isTauri } from "@tauri-apps/api/core";

export function isDesktop(): boolean { return isTauri(); }
