/** Own lifecycle around the shipped MIT SortableJS copy, including lazy imports. */
export function sortableSet() {
  const live = new Set();
  let generation = 0;
  return {
    async add(element, options) {
      const own = generation;
      const { default: Sortable } = await import('./vendor/sortable.esm.min.js');
      if (generation !== own || !element.isConnected) return;
      const instance = Sortable.create(element, {
        animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150,
        forceFallback: true, delay: 120, delayOnTouchOnly: true, touchStartThreshold: 5,
        preventOnFilter: false, ...options,
        onEnd(event) {
          if (event.from !== event.to || event.oldIndex !== event.newIndex) options.onEnd(event);
        },
      });
      live.add(instance);
      return instance;
    },
    clear() { generation++; for (const instance of live) instance.destroy(); live.clear(); },
  };
}
