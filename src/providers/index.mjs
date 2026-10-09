import * as pan115 from './pan115.mjs';
import * as pan123 from './pan123.mjs';
import * as pikpak from './pikpak.mjs';

// Register adapters here; core orchestration and UI do not branch on keys.
export const adapters = Object.freeze(Object.fromEntries(
    [pan115, pan123, pikpak].map(adapter => [adapter.config.key, adapter])
));
export const PROVIDERS = Object.freeze(Object.fromEntries(
    Object.entries(adapters).map(([key, adapter]) => [key, adapter.config])
));
export function getAdapter(key) {
    if (typeof key !== 'string' || !Object.hasOwn(adapters, key)) throw new Error('未知网盘');
    return adapters[key];
}
