/**
 * Controller-keyed projection of runtime status and command output for UI and
 * application consumers. Executable engines remain owned by
 * ControllerRuntimeManager; this read model never grants execution authority.
 */
export class ControllerRuntimeReadModel {
  constructor() {
    /** @type {Map<number|string, {controllerId:number|string, ready:boolean, status:string, commands:Record<string,number>}>} */
    this.records = new Map();
  }

  setStatus(controllerId, status, ready) {
    const current = this.records.get(controllerId);
    this.records.set(controllerId, {
      controllerId,
      ready: Boolean(ready),
      status: String(status),
      commands: current?.commands || {},
    });
  }

  setCommands(controllerId, outputs) {
    const current = this.records.get(controllerId) || {
      controllerId,
      ready: false,
      status: "IDLE",
      commands: {},
    };
    this.records.set(controllerId, {
      ...current,
      commands: Object.fromEntries(outputs || []),
    });
  }

  stop(controllerId, status = "STOPPED") {
    if (controllerId == null) return;
    this.records.set(controllerId, {
      controllerId,
      ready: false,
      status,
      commands: {},
    });
  }

  get(controllerId) {
    if (controllerId == null) return null;
    const record = this.records.get(controllerId);
    if (!record) return null;
    return Object.freeze({
      ...record,
      commands: Object.freeze({ ...record.commands }),
    });
  }

  clear() {
    this.records.clear();
  }
}
