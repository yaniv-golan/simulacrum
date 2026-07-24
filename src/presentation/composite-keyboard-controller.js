function tabsFor(tab) {
  const tablist = tab.closest('[role="tablist"]');
  return tablist
    ? Array.from(tablist.querySelectorAll(':scope > [role="tab"]')).filter(
        (candidate) => !candidate.disabled && !candidate.hidden,
      )
    : [];
}

function syncTabStops(tablist) {
  const tabs = Array.from(tablist.querySelectorAll(':scope > [role="tab"]')),
    selected =
      tabs.find((tab) => tab.getAttribute("aria-selected") === "true") ||
      tabs[0];
  for (const tab of tabs) tab.tabIndex = tab === selected ? 0 : -1;
}

function toolbarControls(control) {
  const toolbar = control.closest('[role="toolbar"]');
  return toolbar
    ? Array.from(
        toolbar.querySelectorAll(":scope > button:not([disabled])"),
      ).filter((candidate) => !candidate.hidden)
    : [];
}

function syncToolbarStops(toolbar) {
  const controls = Array.from(
      toolbar.querySelectorAll(":scope > button:not([disabled])"),
    ),
    current = controls.find((control) => control.tabIndex === 0) || controls[0];
  for (const control of controls)
    control.tabIndex = control === current ? 0 : -1;
}

/**
 * Installs the common APG tab behavior. Owning presenters still mutate their
 * own selected state; this controller only routes focus and activation.
 */
export function installCompositeKeyboardNavigation({ root = document } = {}) {
  for (const tablist of Array.from(root.querySelectorAll('[role="tablist"]')))
    syncTabStops(tablist);
  for (const toolbar of Array.from(root.querySelectorAll('[role="toolbar"]')))
    syncToolbarStops(toolbar);

  function onClick(event) {
    const tab =
      event.target instanceof Element && event.target.closest('[role="tab"]');
    if (tab) {
      const tablist = tab.closest('[role="tablist"]');
      if (!tablist) return;
      for (const candidate of tabsFor(tab))
        candidate.tabIndex = candidate === tab ? 0 : -1;
      return;
    }
    const toolbarControl =
      event.target instanceof Element &&
      event.target.closest('[role="toolbar"] > button');
    if (!toolbarControl) return;
    for (const candidate of toolbarControls(toolbarControl))
      candidate.tabIndex = candidate === toolbarControl ? 0 : -1;
  }

  function onKeydown(event) {
    if (event.defaultPrevented) return;
    const toolbarControl =
      event.target instanceof Element &&
      event.target.closest('[role="toolbar"] > button');
    if (toolbarControl) {
      const controls = toolbarControls(toolbarControl),
        current = controls.indexOf(toolbarControl);
      let index = null;
      if (["ArrowLeft", "ArrowUp"].includes(event.key))
        index = (current - 1 + controls.length) % controls.length;
      else if (["ArrowRight", "ArrowDown"].includes(event.key))
        index = (current + 1) % controls.length;
      else if (event.key === "Home") index = 0;
      else if (event.key === "End") index = controls.length - 1;
      if (index !== null) {
        event.preventDefault();
        event.stopPropagation();
        for (const candidate of controls)
          candidate.tabIndex = candidate === controls[index] ? 0 : -1;
        controls[index].focus();
        return;
      }
    }
    const nativeButton =
      event.target instanceof Element && event.target.closest("button");
    if (
      event.key === " " &&
      nativeButton &&
      !nativeButton.classList.contains("capturing") &&
      !nativeButton.matches('[role="treeitem"]')
    ) {
      event.preventDefault();
      event.stopPropagation();
      nativeButton.click();
      return;
    }
    const tab =
      event.target instanceof Element && event.target.closest('[role="tab"]');
    if (!tab) return;
    const tabs = tabsFor(tab);
    if (!tabs.length) return;
    const vertical =
        tab.closest('[role="tablist"]')?.getAttribute("aria-orientation") ===
        "vertical",
      previousKey = vertical ? "ArrowUp" : "ArrowLeft",
      nextKey = vertical ? "ArrowDown" : "ArrowRight";
    let index = tabs.indexOf(tab);
    if (event.key === previousKey)
      index = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === nextKey) index = (index + 1) % tabs.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = tabs.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    tabs[index].focus();
    tabs[index].click();
  }

  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKeydown);
  return Object.freeze({
    syncTabStops,
    dispose() {
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKeydown);
    },
  });
}
