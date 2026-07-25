/** Rebuilds a select with text-only labels from keyed option data. */
export function replaceSelectOptions(
  select,
  options,
  selectedKey,
  keyName = "key",
) {
  select.replaceChildren(
    ...options.map((option) => {
      const element = select.ownerDocument.createElement("option");
      element.value = String(option[keyName]);
      element.textContent = option.label;
      element.selected = option[keyName] === selectedKey;
      return element;
    }),
  );
}
