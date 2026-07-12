export default function () {
  const removers: Array<() => void> = [];

  return {
    on: on,
    clear: clear,
  };

  function on(target: EventTarget | null | undefined, type: string, listener: EventListener): void {
    if (!target) {
      return;
    }

    target.addEventListener(type, listener);
    removers.push(() => {
      target.removeEventListener(type, listener);
    });
  }

  function clear(): void {
    removers.splice(0).forEach((remove) => {
      remove();
    });
  }
}
