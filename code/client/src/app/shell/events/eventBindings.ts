export default function () {
    const removers: Array<() => void> = [];

    return {
        on: on,
        clear: clear,
    };

    function on<K extends keyof HTMLElementEventMap>(
        target: HTMLElement | null | undefined,
        type: K,
        listener: (event: HTMLElementEventMap[K]) => void
    ): void {
        if (!target) {
            return;
        }

        target.addEventListener(type, listener);
        removers.push(() => {
            target.removeEventListener(type, listener);
        });
    }

    function clear(): void {
        removers.splice(0).forEach(remove => {
            remove();
        });
    }
}
