/**
 * Binds authored appearance and scale controls without owning inspector layout.
 * @param {{
 *   colorInput: HTMLInputElement|null,
 *   scaleInputs: Element[],
 *   part: object,
 *   partName: string,
 *   recordEdit: (input:HTMLInputElement,label:string)=>void,
 *   actions: {
 *     recolorPart:(part:object,color:number)=>boolean,
 *     scalePart:(part:object,axis:string,value:number)=>boolean,
 *     syncAssembly:()=>void,
 *     drawConnections:()=>void,
 *     updateSelection:()=>void,
 *   },
 * }} options
 */
export function bindComponentConstructionEditor({
  colorInput,
  scaleInputs,
  part,
  partName,
  recordEdit,
  actions,
}) {
  const commit = () => {
    actions.syncAssembly();
    actions.drawConnections();
    actions.updateSelection();
  };
  if (colorInput) {
    colorInput.onblur = () => delete colorInput.dataset.historyRecorded;
    colorInput.oninput = () => {
      recordEdit(colorInput, `recolor ${partName}`);
      if (
        actions.recolorPart(
          part,
          Number.parseInt(colorInput.value.slice(1), 16),
        )
      )
        commit();
    };
  }
  for (const element of scaleInputs) {
    const input = /** @type {HTMLInputElement} */ (element);
    input.onblur = () => delete input.dataset.historyRecorded;
    input.oninput = () => {
      recordEdit(input, `scale ${partName}`);
      const axis = input.dataset.scaleAxis;
      if (
        axis &&
        ["x", "y", "z"].includes(axis) &&
        actions.scalePart(part, axis, +input.value)
      )
        commit();
    };
  }
}
