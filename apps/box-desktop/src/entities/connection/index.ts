import { invoke } from "@tauri-apps/api/core";
import type { ConnectionSnapshot } from "@box/contracts";

export const listConnections = () => invoke<ConnectionSnapshot>("list_connections");
export const createConnection = (name: string) => invoke<ConnectionSnapshot>("create_connection_entity", { name });
export const attachConnection = (connectionId: string, permalink: string) => invoke<ConnectionSnapshot>("attach_document_connection", { connectionId, permalink });
export const detachConnection = (connectionId: string, permalink: string) => invoke<ConnectionSnapshot>("detach_document_connection", { connectionId, permalink });
