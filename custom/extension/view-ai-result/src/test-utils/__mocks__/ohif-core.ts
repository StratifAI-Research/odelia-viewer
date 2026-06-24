// Only the symbols view-ai-result imports from @ohif/core.
export const utils = {
  formatDate: (d?: string) => d || '',
};

export const useSystem = () => (globalThis as any).__OHIF_SYSTEM__ ?? {
  servicesManager: { services: {} },
  commandsManager: { runCommand: jest.fn() },
  extensionManager: { getModuleEntry: jest.fn() },
};
