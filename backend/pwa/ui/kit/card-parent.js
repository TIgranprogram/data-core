/** Внутренний жизненный цикл openCard(parent): исходная форма остаётся в DOM. */
const panels = new WeakMap();
export const cardParent = (drawer) => panels.get(drawer);

export function registerCardParent(drawer, body, back, parent, handle, applyDock, disposed) {
  const owner = panels.get(parent?.closest?.('[data-k="drawer"]'));
  const resumeOwner = owner?.suspend();
  const state = {
    child: null,
    destroy() {
      state.child?.close();
      panels.delete(drawer);
      resumeOwner?.();
    },
    suspend() {
      const focus = document.activeElement;
      const scroll = body.scrollTop;
      const hidden = drawer.hidden; const inert = drawer.inert;
      const backHidden = back.hidden;
      drawer.hidden = true; drawer.inert = true;
      back.hidden = true;
      return () => {
        state.child = null;
        if (disposed()) return;
        drawer.hidden = hidden; drawer.inert = inert;
        back.hidden = backHidden;
        applyDock(); body.scrollTop = scroll;
        if (focus?.isConnected) focus.focus({ preventScroll: true });
      };
    },
  };
  panels.set(drawer, state);
  if (owner) owner.child = handle;
  return handle;
}
