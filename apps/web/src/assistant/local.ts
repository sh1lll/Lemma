import { LocalModelClient } from '../local-llm/client';
import { NativeModelClient, nativeBridge } from '../local-llm/native';

/**
 * One on-device model client for the whole app. In the desktop app the model runs natively in the main
 * process (no WebAssembly memory ceiling); in browsers it runs in a WebGPU/WASM worker.
 */
let client: LocalModelClient | NativeModelClient | null = null;

export function localModel(id: string): LocalModelClient | NativeModelClient {
  if (!client) {
    const bridge = nativeBridge();
    client = bridge ? new NativeModelClient(id, bridge) : new LocalModelClient(id);
  }
  client.model = id;
  return client;
}

/** Where the built-in model runs here, for Settings. */
export const runsNatively = () => nativeBridge() !== null;
