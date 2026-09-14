/**
 * Shared top-right dismissal control for requested dialogs and panels.
 * The owner supplies the close handler, so draft guards, Escape routing and
 * lifecycle stay where they are; this only fixes the control's appearance and name.
 */
export function createDialogClose(label, close) {
  if (typeof label !== 'string' || !/^Close \S/.test(label))
    throw Error('Dialog close labels must name the dialog, for example "Close photos"');
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'dialog-close';
  node.textContent = '×';
  node.setAttribute('aria-label', label);
  node.title = label;
  node.onclick = close;
  return node;
}
/** Heading row that keeps the title first and the × at the top right, above scrolling content. */
export function createDialogHeader(heading, close) {
  const header = document.createElement('header');
  header.className = 'dialog-header';
  header.append(heading, close);
  return header;
}
