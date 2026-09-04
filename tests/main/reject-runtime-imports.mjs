import { registerHooks } from 'node:module';

// A missing-config startup must finish before any runtime adapter is resolved.
// Turning an early import into a deterministic failure avoids reproducing the
// original coverage timeout through machine-dependent CPU starvation.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.includes('/modules/')) {
      throw new Error(`runtime dependency loaded before configuration validation: ${specifier}`);
    }
    return nextResolve(specifier, context);
  },
});
