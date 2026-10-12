import type { AppInfo } from "@box/contracts";
import { invoke } from "@tauri-apps/api/core";

export function getAppInfo(): Promise<AppInfo> { return invoke<AppInfo>("get_app_info"); }
