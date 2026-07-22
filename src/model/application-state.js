export class EditorState {
  constructor(initial = {}) {
    this.mode = initial.mode || "build";
    this.tool = initial.tool || "select";
    this.cameraTool = initial.cameraTool || null;
    this.selected = initial.selected ?? null;
    this.selectedIds = new Set(initial.selectedIds || []);
    this.selectedEntity =
      initial.selectedEntity ||
      (this.selected == null ? null : { kind: "part", partId: this.selected });
    this.placing = initial.placing || null;
    this.connectFrom = initial.connectFrom ?? null;
    this.connectPort = initial.connectPort ?? null;
    this.lastPlacementResult = initial.lastPlacementResult || null;
    this.lastTransformOperation = initial.lastTransformOperation || null;
  }
}

export class UIState {
  constructor(initial = {}) {
    this.workspaceFocus = !!initial.workspaceFocus;
  }
}

/**
 * @param {Record<string, unknown> & {editor?:object, ui?:object}} [initial]
 * @returns {Record<string, unknown> & {editor: EditorState, ui: UIState}}
 */
export function createApplicationState(initial = {}) {
  return /** @type {Record<string, unknown> & {editor: EditorState, ui: UIState}} */ ({
    ...initial,
    editor: new EditorState(initial.editor),
    ui: new UIState(initial.ui),
  });
}

export function applyEditorAction(editor, action) {
  switch (action.type) {
    case "set-mode":
      editor.mode = action.mode;
      return;
    case "set-tool":
      editor.tool = action.tool;
      return;
    case "set-camera-tool":
      editor.cameraTool = action.tool;
      return;
    case "select": {
      const ids = new Set(action.ids || (action.id == null ? [] : [action.id]));
      editor.selectedIds = ids;
      editor.selected =
        action.id ?? action.primaryId ?? ids.values().next().value ?? null;
      editor.selectedEntity =
        editor.selected == null
          ? null
          : ids.size > 1
            ? {
                kind: "parts",
                partIds: [...ids],
                primaryPartId: editor.selected,
              }
            : { kind: "part", partId: editor.selected };
      return;
    }
    case "select-connection": {
      editor.selected = action.partId;
      editor.selectedIds = new Set([action.partId]);
      editor.selectedEntity = {
        kind: "connection",
        connectionId: action.connectionId,
        partId: action.partId,
      };
      return;
    }
    case "begin-connection":
      editor.selected = action.partId;
      editor.selectedIds = new Set([action.partId]);
      editor.connectFrom = action.partId;
      editor.connectPort = action.port;
      editor.selectedEntity = {
        kind: "port",
        partId: action.partId,
        port: action.port,
      };
      editor.mode = "wire";
      return;
    case "cancel-connection":
      editor.connectFrom = null;
      editor.connectPort = null;
      editor.selectedEntity =
        editor.selected == null
          ? null
          : { kind: "part", partId: editor.selected };
      if (editor.mode === "wire") editor.mode = "build";
      return;
    case "begin-placement":
      editor.placing = action.placement;
      editor.tool = "place";
      return;
    case "update-placement-position":
      if (editor.placing)
        editor.placing = {
          ...editor.placing,
          position: [...action.position],
        };
      return;
    case "finish-placement":
      editor.placing = null;
      editor.tool = action.returnTool || "select";
      return;
    default:
      throw new Error(`Unknown editor action ${action.type}`);
  }
}

export function applyUIAction(ui, action) {
  switch (action.type) {
    case "set-workspace-focus":
      ui.workspaceFocus = !!action.focused;
      return;
    default:
      throw new Error(`Unknown UI action ${action.type}`);
  }
}
