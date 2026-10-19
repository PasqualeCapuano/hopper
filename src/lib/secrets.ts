import { invoke } from "@tauri-apps/api/core";
import type { Provider } from "./settings";

// API keys are kept by the Rust side in a user-only file inside the app data
// directory (see lib.rs for why not the Keychain yet). They are read into
// memory only when a request is about to be made.

export function getSecret(provider: Provider): Promise<string | null> {
  return invoke<string | null>("secret_get", { provider });
}

export function setSecret(provider: Provider, key: string): Promise<void> {
  return invoke("secret_set", { provider, key });
}

export function deleteSecret(provider: Provider): Promise<void> {
  return invoke("secret_delete", { provider });
}
