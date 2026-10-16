import type { Api, CredentialStore, Model, Models, Provider } from '@earendil-works/pi-ai';
import type { ModelView, ProviderView } from '@crewbus/contracts';
import { SerialByKey } from '../lib/serial.js';
import { AppError, conflict, invalid, missing } from '../lib/error.js';
export type { ModelView, ProviderView } from '@crewbus/contracts';

// pi-ai v0.87.1: Azure needs a resource endpoint; Cloudflare needs account/gateway
// config; Codex is OAuth-only. All other built-ins have a direct one-key branch
// and a complete default stream endpoint. Vertex's key branch bypasses ADC;
// Bedrock's bearer branch derives region from its built-in endpoint/default.
const unsupported = new Set(['azure-openai-responses', 'cloudflare-ai-gateway', 'cloudflare-workers-ai', 'openai-codex']);
function supportsKey(provider: Provider): boolean {
  return !unsupported.has(provider.id) && !!provider.auth.apiKey && (!!provider.auth.apiKey.login || provider.id === 'faux');
}
export interface CatalogService {
  listProviders(): Promise<ProviderView[]>;
  listModels(providerId: string): ModelView[];
  assertSelection(providerId: string, modelId: string): Model<Api>;
  saveKey(providerId: string, key: string): Promise<void>;
  deleteKey(providerId: string): Promise<void>;
  withProviderLock<T>(providerId: string, fn: () => Promise<T>): Promise<T>;
}
export function createCatalog(models: Models, credentials: CredentialStore, isProviderBusy: (providerId: string) => boolean = () => false): CatalogService {
  const serial = new SerialByKey();
  const provider = (id: string) => {
    const found = models.getProvider(id);
    if (!found) return missing();
    if (!supportsKey(found)) return invalid('Provider requires unsupported configuration');
    return found;
  };
  return {
    async listProviders() {
      const configured = new Set((await credentials.list()).filter(c => c.type === 'api_key').map(c => c.providerId));
      return models.getProviders().filter(supportsKey).map(p => ({id:p.id, name:p.name, configured:configured.has(p.id)}));
    },
    listModels(id) {
      provider(id);
      return models.getModels(id).map(m => ({id:m.id, name:m.name, providerId:id, contextWindow:m.contextWindow}));
    },
    assertSelection(id, modelId) {
      provider(id);
      return models.getModel(id, modelId) ?? missing();
    },
    saveKey(id, key) {
      return serial.run(id, async () => {
        provider(id);
        if (typeof key !== 'string' || !key.trim()) invalid('API key is required');
        if (isProviderBusy(id)) conflict('Provider has an active run');
        // Persist directly: no login/probe network request or provider exception can expose key.
        try { await credentials.modify(id, async () => ({type:'api_key', key})); }
        catch { throw new AppError(500, 'credential_storage_error', 'Unable to save credential'); }
      });
    },
    deleteKey(id) {
      return serial.run(id, async () => {
        provider(id);
        if (isProviderBusy(id)) conflict('Provider has an active run');
        try { await credentials.delete(id); }
        catch { throw new AppError(500, 'credential_storage_error', 'Unable to delete credential'); }
      });
    },
    withProviderLock: (id, fn) => serial.run(id, fn)
  };
}
