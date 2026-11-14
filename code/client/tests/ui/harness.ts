import { afterEach, beforeEach, vi } from 'vitest';
import realUiShell from '../../src/app/uiShell';

export function setupUiShellHarness() {
  const shells = new Set<ReturnType<typeof realUiShell>>();
  beforeEach(() => document.body.replaceChildren());
  afterEach(() => {
    try {
      shells.forEach(shell => shell.unmount());
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
      document.body.replaceChildren();
    }
  });
  return (...args: Parameters<typeof realUiShell>) => {
    const shell = realUiShell(...args);
    const mount = shell.mount;
    const unmount = shell.unmount;
    shell.mount = () => {
      shells.add(shell);
      mount();
    };
    shell.unmount = () => {
      shells.delete(shell);
      unmount();
    };
    shells.add(shell);
    return shell;
  };
}
