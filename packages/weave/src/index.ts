// @jkos/weave — the jkOS suite fabric. One import for cross-app interconnection:
// the app manifest, the polled-resource/invalidation bus, the capability contract,
// and (added in later phases) the cross-app command dispatcher.
export * from './manifest';
export * from './resource';
export * from './capability';
export * from './extref';
export * from './useSuiteApps';
export * from './fetchCapabilities';
export * from './dispatch';
