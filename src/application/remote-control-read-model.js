import { powerContract } from "../model/actuator-contracts.js";

export const RemoteBindingStatus = Object.freeze({
  ONLINE: "online",
  UNBOUND: "unbound",
  MISSING_TARGET: "missing-target",
  INCOMPATIBLE_TARGET: "incompatible-target",
  UNPOWERED: "unpowered",
  NO_SIGNAL_ROUTE: "no-signal-route",
});

/**
 * Pure, deterministic binding diagnostics. It never edits the control.
 * @param {{
 *   control:{channel?:string,targetId?:number|null}|null|undefined,
 *   parts:Array<{id:number,type:string}>,
 *   isPowered?:(part:{id:number,type:string})=>boolean,
 *   routedControllerIds?:(part:{id:number,type:string})=>number[],
 *   commandChannels?:(part:{id:number,type:string})=>readonly string[],
 * }} input
 */
export function readRemoteControlBinding({
  control,
  parts,
  isPowered = () => false,
  routedControllerIds = () => [],
  commandChannels = () => [],
}) {
  const compatiblePartIds = parts
      .filter((part) => commandChannels(part).includes(control?.channel))
      .map((part) => part.id),
    target = parts.find((part) => part.id === control?.targetId) || null;
  let status;
  if (control?.targetId == null) status = RemoteBindingStatus.UNBOUND;
  else if (!target) status = RemoteBindingStatus.MISSING_TARGET;
  else if (!compatiblePartIds.includes(target.id))
    status = RemoteBindingStatus.INCOMPATIBLE_TARGET;
  else if (powerContract(target) && !isPowered(target))
    status = RemoteBindingStatus.UNPOWERED;
  else if (!routedControllerIds(target).length)
    status = RemoteBindingStatus.NO_SIGNAL_ROUTE;
  else status = RemoteBindingStatus.ONLINE;
  return Object.freeze({
    status,
    online: status === RemoteBindingStatus.ONLINE,
    target,
    compatiblePartIds: Object.freeze(compatiblePartIds),
  });
}
