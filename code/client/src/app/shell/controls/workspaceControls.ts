import eventBindings from '../events/eventBindings';

/** Owns navigation and surfaces; graph operations remain in their existing controllers. */
export default function workspaceControls(root: HTMLElement | undefined) {
  const bindings = eventBindings();
  const tasks = tabGroup(
    '[data-workspace-tab]',
    '[data-workspace-panel]',
    'data',
    root?.querySelector<HTMLElement>('.app-drawer')
  );
  const inspector = tabGroup('[data-inspector-tab]', '[data-inspector-panel]', 'overview');
  const shell = root?.querySelector<HTMLElement>('.app-shell');
  const view = root?.querySelector<HTMLElement>('.view-workspace');
  const sidebar = root?.querySelector<HTMLElement>('#workspace-sidebar');
  const inspectorPanel = root?.querySelector<HTMLElement>('#workspace-inspector');
  const controlsToggle = root?.querySelector<HTMLButtonElement>('#controls-toggle');
  const inspectorToggle = root?.querySelector<HTMLButtonElement>('#inspector-toggle');
  const changeData = root?.querySelector<HTMLButtonElement>('#change-data');
  const datasetLabel = root?.querySelector<HTMLElement>('#current-dataset');
  const exportOpen = root?.querySelector<HTMLButtonElement>('#open-export');
  const exportDialog = root?.querySelector<HTMLDialogElement>('#export-dialog');
  const loadButton = root?.querySelector<HTMLButtonElement>('#render-form button[type="submit"]');
  let controlsOpen = true;
  let inspectorOpen = true;

  return { mount, unmount, loadStarted, loadCompleted, loadFailed, selectNode, showRegion };

  function mount(): void {
    tasks.mount();
    inspector.mount();
    bindings.on(changeData, 'click', () => {
      setControlsOpen(true);
      tasks.select('data', true);
    });
    bindings.on(controlsToggle, 'click', () => {
      setControlsOpen(!controlsOpen);
      if (controlsOpen) tasks.focus();
    });
    bindings.on(inspectorToggle, 'click', () => setInspectorOpen(!inspectorOpen));
    bindings.on(root?.querySelector<HTMLElement>('#inspector-close'), 'click', () => {
      setInspectorOpen(false);
      inspectorToggle?.focus();
    });
    bindings.on(exportOpen, 'click', () => {
      if (!exportDialog?.open) exportDialog?.showModal();
    });
    bindings.on(root?.querySelector<HTMLElement>('#close-export'), 'click', () => exportDialog?.close());
  }

  function loadStarted(): void {
    if (exportDialog?.open) exportDialog.close();
    if (loadButton) loadButton.disabled = true;
    if (exportOpen) exportOpen.disabled = true;
    root?.querySelector('#graph-root')?.setAttribute('aria-busy', 'true');
    if (datasetLabel) datasetLabel.textContent = 'Loading dataset…';
  }

  function loadCompleted(name: string): void {
    if (loadButton) loadButton.disabled = false;
    if (exportOpen) exportOpen.disabled = false;
    root?.querySelector('#graph-root')?.setAttribute('aria-busy', 'false');
    if (datasetLabel) {
      datasetLabel.textContent = name;
      datasetLabel.title = name;
    }
    if (changeData) changeData.textContent = 'Change data';
    tasks.select('explore');
    inspector.select('overview');
    setControlsOpen(false);
  }

  function loadFailed(): void {
    if (loadButton) loadButton.disabled = false;
    if (exportOpen) exportOpen.disabled = true;
    root?.querySelector('#graph-root')?.setAttribute('aria-busy', 'false');
    if (datasetLabel) {
      datasetLabel.textContent = 'No dataset loaded';
      datasetLabel.removeAttribute('title');
    }
    if (changeData) changeData.textContent = 'Load data';
    setControlsOpen(true);
    tasks.select('data');
  }

  function selectNode(nodeId: string | null): void {
    if (nodeId === null) {
      if (inspector.current() === 'node') inspector.select('overview');
      return;
    }
    inspector.select('node');
    setInspectorOpen(true);
  }

  function showRegion(): void {
    inspector.select('region');
    setInspectorOpen(true);
  }

  function setControlsOpen(open: boolean): void {
    controlsOpen = open;
    if (shell) shell.dataset.controlsOpen = String(open);
    controlsToggle?.setAttribute('aria-expanded', String(open));
    if (!open && sidebar?.contains(document.activeElement) && controlsToggle?.getClientRects().length)
      controlsToggle.focus();
    // Desktop keeps the drawer visible; CSS handles its compact-screen disclosure.
    sidebar?.removeAttribute('hidden');
  }

  function setInspectorOpen(open: boolean): void {
    inspectorOpen = open;
    if (view) view.dataset.inspectorOpen = String(open);
    if (inspectorPanel) inspectorPanel.hidden = !open;
    inspectorToggle?.setAttribute('aria-expanded', String(open));
  }

  function unmount(): void {
    bindings.clear();
    if (exportDialog?.open) exportDialog.close();
  }

  function tabGroup(buttonSelector: string, panelSelector: string, initial: string, scrollArea?: HTMLElement | null) {
    const tabs = [...(root?.querySelectorAll<HTMLButtonElement>(buttonSelector) ?? [])];
    const panels = [...(root?.querySelectorAll<HTMLElement>(panelSelector) ?? [])];
    const positions = new Map<string, number>();
    const name = (tab: HTMLButtonElement) => tab.dataset.workspaceTab ?? tab.dataset.inspectorTab;
    let active = initial;
    return { mount, select, current: () => active, focus: () => tabs.find(tab => name(tab) === active)?.focus() };

    function mount(): void {
      select(initial);
      for (const tab of tabs) {
        bindings.on(tab, 'click', () => select(name(tab)));
        bindings.on(tab, 'keydown', event => {
          const index = tabs.indexOf(tab);
          const next =
            event.key === 'ArrowRight'
              ? (index + 1) % tabs.length
              : event.key === 'ArrowLeft'
                ? (index + tabs.length - 1) % tabs.length
                : event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : null;
          if (next === null) return;
          event.preventDefault();
          const nextTab = tabs[next];
          if (nextTab) select(name(nextTab), true);
        });
      }
    }

    function select(value: string | undefined, focus = false): void {
      const selected = tabs.find(tab => name(tab) === value);
      if (!selected) return;
      if (scrollArea) positions.set(active, scrollArea.scrollTop);
      active = name(selected) ?? initial;
      const target = selected.getAttribute('aria-controls');
      for (const panel of panels) {
        const hide = panel.id !== target;
        if (hide && panel.contains(document.activeElement)) focus = true;
        panel.hidden = hide;
      }
      for (const tab of tabs) {
        tab.setAttribute('aria-selected', String(tab === selected));
        tab.tabIndex = tab === selected ? 0 : -1;
      }
      if (scrollArea) scrollArea.scrollTop = positions.get(active) ?? 0;
      if (focus) selected.focus();
    }
  }
}
