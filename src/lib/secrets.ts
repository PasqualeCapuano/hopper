import { invoke } from "@tauri-apps/api/core";
import type { Provider } from "./settings";

// The API key lives in the macOS Keychain / Windows Credential Manager.
// It is read into memory only when a request is about to be made.

export function getSecret(provider: Provider): Promise<string | null> {
  return invoke<string | null>("secret_get", { provider });
}

export function setSecret(provider: Provider, key: string): Promise<void> {
  return invoke("secret_set", { provider, key });
}

export function deleteSecret(provider: Provider): Promise<void> {
  return invoke("secret_delete", { provider });
}
