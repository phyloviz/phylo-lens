import type { GraphComponent } from '../../../contracts/graph/components';
import type { SourceFormat } from '../../../contracts/models';
import type { GraphWorkbench } from '../../workbench/graphWorkbench';
import eventBindings from '../events/eventBindings';
import { toError } from '../../errors';
import { tabIndexForKey } from './tabNavigation';

export type ForestControlsElements = {
  readonly forestControls?: HTMLElement;
  readonly graphRoot?: HTMLElement;
  readonly searchInput?: HTMLInputElement;
};

/** Pages contain summaries only. Exactly one renderer owns the active panel. */
export default function forestControls(
  workbench: Pick<GraphWorkbench, 'listComponents' | 'selectComponent' | 'getComponentId'>,
  elements: ForestControlsElements,
  onSwitch: (pending: boolean) => void
) {
  const root = elements.forestControls;
  const bindings = eventBindings();
  let generation = 0;
  let busy = false;
  let cursor: number | null = null;
  let components: GraphComponent[] = [];
  let sourceFormat: SourceFormat | null = null;
  const list = document.createElement('div');
  list.className = 'forest-tabs';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Forest views');
  const more = document.createElement('button');
  more.type = 'button';
  more.textContent = 'More groups';
  const feedback = document.createElement('span');
  feedback.className = 'forest-feedback';
  feedback.setAttribute('role', 'status');
  return {
    mount,
    reset,
    load(format: SourceFormat) {
      sourceFormat = format;
      return loadPage();
    },
    unmount: () => {
      reset();
      bindings.clear();
      root?.replaceChildren();
    },
  };

  function mount(): void {
    if (!root) return;
    root.replaceChildren(list, more, feedback);
    bindings.on(more, 'click', () => void loadPage(cursor ?? undefined));
    bindings.on(list, 'keydown', event => {
      const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
      const index = tabs.findIndex(tab => tab === document.activeElement);
      const next = tabIndexForKey(event.key, index, tabs.length);
      if (next === null) return;
      event.preventDefault();
      tabs[next]?.focus();
    });
    bindings.on(list, 'click', event => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement) || !list.contains(target)) return;
      void select(target.dataset.componentId);
    });
  }
  function reset(): void {
    generation++;
    busy = false;
    components = [];
    sourceFormat = null;
    cursor = null;
    if (root) {
      root.hidden = true;
      root.removeAttribute('aria-busy');
    }
    elements.graphRoot?.removeAttribute('role');
    elements.graphRoot?.removeAttribute('aria-labelledby');
    if (elements.searchInput) elements.searchInput.placeholder = 'Node ID or ancillary data';
    list.replaceChildren();
    feedback.textContent = '';
    more.hidden = true;
  }
  async function loadPage(after?: number): Promise<void> {
    if (!root || busy) return;
    const current = generation;
    busy = true;
    more.disabled = true;
    try {
      const page = await workbench.listComponents(after === undefined ? {} : { after });
      if (current !== generation) return;
      if (after === undefined) components = [...page.components];
      else components.push(...page.components);
      cursor = page.nextCursor;
      root.hidden = components.length <= 1 && cursor === null;
      render();
      feedback.textContent = '';
    } catch (error) {
      if (current === generation) {
        root.hidden = false;
        feedback.textContent = toError(error).message;
        more.textContent = components.length ? 'Retry more groups' : 'Retry group list';
        more.hidden = false;
      }
    } finally {
      if (current === generation) {
        busy = false;
        more.disabled = false;
      }
    }
  }
  function render(): void {
    if (!root) return;
    list.replaceChildren();
    const active = workbench.getComponentId();
    const prefix = sourceFormat === 'typing_data' ? 'CC' : 'Group';
    const options: Array<{ id?: string; label: string }> = [
      { label: 'Forest overview' },
      ...components.map((tree, i) => ({
        id: tree.id,
        label: `${prefix} ${i + 1} · ${tree.nodeCount.toLocaleString()} ${tree.nodeCount === 1 ? 'node' : 'nodes'}`,
      })),
    ];
    for (const [index, option] of options.entries()) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.id = `forest-tab-${index}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', 'graph-root');
      const selected = option.id === active;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.textContent = option.label;
      tab.title = option.id ? `Root: ${option.id}` : option.label;
      if (option.id !== undefined && sourceFormat === 'typing_data') {
        const description = 'Clonal Complex; local group number, not a reference database CC assignment.';
        tab.title = `${description} ${tab.title}`;
        tab.setAttribute('aria-description', description);
      }
      if (option.id !== undefined) tab.dataset.componentId = option.id;
      list.append(tab);
      if (selected && !root.hidden) {
        elements.graphRoot?.setAttribute('role', 'tabpanel');
        elements.graphRoot?.setAttribute('aria-labelledby', tab.id);
      }
    }
    more.textContent = 'More groups';
    more.hidden = cursor === null;
  }
  async function select(id?: string): Promise<void> {
    if (!root || busy || id === workbench.getComponentId()) return;
    const current = generation;
    busy = true;
    root.setAttribute('aria-busy', 'true');
    list.querySelectorAll<HTMLButtonElement>('button').forEach(tab => {
      tab.disabled = true;
    });
    more.disabled = true;
    feedback.textContent = 'Loading group view…';
    onSwitch(true);
    try {
      const component = id === undefined ? null : components.find(item => item.id === id);
      if (component === undefined) throw new Error('This group is unavailable.');
      await workbench.selectComponent(component);
      if (current !== generation) return;
      render();
      list.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
      if (elements.searchInput)
        elements.searchInput.placeholder = id === undefined ? 'Node ID or ancillary data' : 'Search this group';
      feedback.textContent = '';
    } catch (error) {
      if (current === generation) feedback.textContent = toError(error).message;
    } finally {
      if (current === generation) {
        busy = false;
        onSwitch(false);
        root.removeAttribute('aria-busy');
        more.disabled = false;
        list.querySelectorAll<HTMLButtonElement>('button').forEach(tab => {
          tab.disabled = false;
        });
      }
    }
  }
}
