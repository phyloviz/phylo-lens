import type { GraphComponent } from '../../../contracts/graph/components';
import type { GraphWorkbench } from '../../workbench/graphWorkbench';
import eventBindings from '../events/eventBindings';
import { toError } from '../../errors';

export interface ForestControlsElements {
  readonly forestControls?: HTMLElement;
  readonly graphRoot?: HTMLElement;
  readonly searchInput?: HTMLInputElement;
}

/** Pages contain summaries only. Exactly one renderer owns the active panel. */
export default function forestControls(
  workbench: Pick<GraphWorkbench, 'listComponents' | 'selectComponent' | 'getComponentId'>,
  elements: ForestControlsElements,
  onSwitch: (pending: boolean) => void
) {
  const root = elements.forestControls;
  const bindings = eventBindings();
  let generation = 0,
    busy = false,
    cursor: number | null = null;
  let components: GraphComponent[] = [];
  const list = document.createElement('div');
  list.className = 'forest-tabs';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Forest views');
  const more = document.createElement('button');
  more.type = 'button';
  more.textContent = 'More trees';
  const feedback = document.createElement('span');
  feedback.className = 'forest-feedback';
  feedback.setAttribute('role', 'status');
  return {
    mount,
    reset,
    load: () => loadPage(false),
    unmount: () => {
      reset();
      bindings.clear();
      root?.replaceChildren();
    },
  };

  function mount() {
    if (!root) return;
    root.replaceChildren(list, more, feedback);
    bindings.on(more, 'click', () => void loadPage(components.length > 0));
    bindings.on(list, 'keydown', event => {
      const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
      const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
      let next: number;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      tabs[next]?.focus();
    });
    bindings.on(list, 'click', event => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement) || !list.contains(target)) return;
      void select(target.dataset.componentId);
    });
  }
  function reset() {
    generation++;
    busy = false;
    components = [];
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
  async function loadPage(append: boolean) {
    if (!root || busy || (append && cursor === null)) return;
    const current = generation;
    busy = true;
    more.disabled = true;
    try {
      const page = await workbench.listComponents(append ? { after: cursor! } : {});
      if (current !== generation) return;
      components = append ? [...components, ...page.components] : [...page.components];
      cursor = page.nextCursor;
      root.hidden = components.length <= 1 && cursor === null;
      render();
      feedback.textContent = '';
    } catch (error) {
      if (current === generation) {
        root.hidden = false;
        feedback.textContent = toError(error).message;
        more.textContent = components.length ? 'Retry more trees' : 'Retry tree list';
        more.hidden = false;
      }
    } finally {
      if (current === generation) {
        busy = false;
        more.disabled = false;
      }
    }
  }
  function render() {
    list.replaceChildren();
    const active = workbench.getComponentId();
    const options: Array<{ id?: string; label: string }> = [
      { label: 'Forest overview' },
      ...components.map((tree, i) => ({
        id: tree.id,
        label: `Tree ${i + 1} · ${tree.nodeCount.toLocaleString()} nodes`,
      })),
    ];
    for (const [index, option] of options.entries()) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.id = `forest-tab-${index}`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', 'graph-root');
      tab.setAttribute('aria-selected', String(option.id === active));
      tab.tabIndex = option.id === active ? 0 : -1;
      tab.textContent = option.label;
      tab.title = option.id ? `Root: ${option.id}` : option.label;
      if (option.id !== undefined) tab.dataset.componentId = option.id;
      list.append(tab);
      if (option.id === active && !root?.hidden) {
        elements.graphRoot?.setAttribute('role', 'tabpanel');
        elements.graphRoot?.setAttribute('aria-labelledby', tab.id);
      }
    }
    more.textContent = 'More trees';
    more.hidden = cursor === null;
  }
  async function select(id?: string) {
    if (busy || id === workbench.getComponentId()) return;
    const current = generation;
    busy = true;
    root?.setAttribute('aria-busy', 'true');
    list.querySelectorAll<HTMLButtonElement>('button').forEach(tab => {
      tab.disabled = true;
    });
    more.disabled = true;
    feedback.textContent = 'Loading tree view…';
    onSwitch(true);
    try {
      const component = id === undefined ? null : components.find(item => item.id === id);
      if (component === undefined) throw new Error('This tree is unavailable.');
      await workbench.selectComponent(component);
      if (current !== generation) return;
      render();
      list.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
      if (elements.searchInput)
        elements.searchInput.placeholder = id === undefined ? 'Node ID or ancillary data' : 'Search this tree';
      feedback.textContent = '';
    } catch (error) {
      if (current === generation) feedback.textContent = toError(error).message;
    } finally {
      if (current === generation) {
        busy = false;
        onSwitch(false);
        root?.removeAttribute('aria-busy');
        more.disabled = false;
        list.querySelectorAll<HTMLButtonElement>('button').forEach(tab => {
          tab.disabled = false;
        });
      }
    }
  }
}
