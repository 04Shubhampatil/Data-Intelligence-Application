/** Terminal commands for a source dashboard (the worker's npm scripts). Pure: safe anywhere. */
export function sourceCommands(adapterKey: string) {
  const suffix = adapterKey === "mahahrd" ? "" : `:${adapterKey}`;
  return { setup: `npm run source:setup${suffix}`, login: `npm run source:login${suffix}`, sync: `npm run source:sync${suffix}` };
}
