import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export const VERSION='course-v1';
const finite = (...xs) => xs.every(Number.isFinite);
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
// contacts contains one aggregated load record per contacting eligible shape.
// Reject duplicate shape records rather than mistake manifold points for feet.
export function destinationTransition(passed, crossed, contacts, destination, W0, beyondLine) {
  passed = passed === true || crossed === true;
  const distinct = new Set(contacts.map(c=>c.shapeId)).size === contacts.length;
  return { passed, ready: Boolean(passed && beyondLine === true && finite(W0) && W0>0 && distinct && contacts.length>=2 && contacts.every(c=>typeof c.shapeId==='string' && c.shapeId.length>0 && c.surface===destination && Number.isFinite(c.load) && c.load>=0.1*W0)) };
}
export function signedAdvance(start,end,direction,L) {
  if(!finite(...start,...end,...direction,L)||L<=0||Math.abs(Math.hypot(...direction)-1)>1e-9) return false;
  return (end[0]-start[0])*direction[0]+(end[1]-start[1])*direction[1]>=5*L;
}
export function loopMetrics(path,{foot,headingError,sweep}) {
  if(path.length<3||!path.every(p=>p.length===2&&finite(...p))||!finite(...foot,headingError,sweep)) return {pass:false};
  const centroid=[0,0];let arc=0,twiceArea=0;
  for(let i=0;i<path.length;i++) {const p=path[i],q=path[(i+1)%path.length];centroid[0]+=p[0]/path.length;centroid[1]+=p[1]/path.length;twiceArea+=p[0]*q[1]-q[0]*p[1];if(i+1<path.length)arc+=distance(p,q);}
  const closure=distance(path[0],path.at(-1));
  const radius=Math.max(...path.map(p=>distance(p,centroid)));
  const area=Math.abs(twiceArea)/2;
  return {arc,area,closure,radius,pass:closure<=0.60 && arc>=3 && area>=0.8 && radius<=2 && Math.abs(sweep)>=350*Math.PI/180 && distance(path.at(-1),foot)<=0.40 && Math.abs(headingError)<=0.35};
}
export function forbiddenImpulse(contacts,machineShapes,supportEligible) {
  const machine=new Set(machineShapes),eligible=new Set(supportEligible),seen=new Map();let total=0;
  for(const c of contacts) {
    if(!finite(c.impulse)||c.impulse<0||c.id===undefined)throw Error('invalid contact');
    const key=[c.a,c.b].sort().join('\0');
    if(seen.has(c.id)){const old=seen.get(c.id);if(old.key!==key||old.impulse!==c.impulse)throw Error('conflicting contact id');continue;}
    seen.set(c.id,{key,impulse:c.impulse});
    if(machine.has(c.a)===machine.has(c.b))continue;
    if(!eligible.has(machine.has(c.a)?c.a:c.b))total+=c.impulse;
  }
  return total;
}
// Caller supplies surface-relative velocity at the wheel axle projected onto the
// wheel rolling tangent, and signed omega*r in the same tangent convention.
export function wheelSlipStep(previous,s) {
  if(!finite(...s.position,s.rollingSpeed,s.forwardSpeed))return {pass:false,state:previous};
  if(!s.contact)return {pass:true,state:null};
  const u=Math.abs(s.rollingSpeed),v=Math.abs(s.forwardSpeed),fast=u>=0.05&&v>=0.05;
  let state=previous?{...previous}:{anchor:[...s.position],fastTicks:0};
  state.fastTicks=fast?state.fastTicks+1:0;
  // Six consecutive above-threshold ticks end the low-speed episode; one tick
  // of threshold chatter cannot renew its anchor.
  if(state.fastTicks>=6)state.anchor=[...s.position];
  const low=v<0.05;
  const ratio=Math.abs(s.rollingSpeed-s.forwardSpeed)/Math.max(u,v,0.05);
  const limit=s.surface==='ramp'?0.40:0.30;
  return {state,pass:low ? u<=0.05&&distance(s.position,state.anchor)<=0.02 : ratio<=limit};
}
export function saturationSample(s,t,expectation={minimumSpeed:0}) {
  if(!finite(s.target,t.angle,t.rate,t.motionFloor,t.torque,expectation.minimumSpeed)||[t.angle,t.rate,t.motionFloor,t.torque].some(v=>v<=0)||expectation.minimumSpeed<0)throw Error('invalid saturation fixture');
  switch(s.mode) {
    case 'position': if(!finite(s.position))throw Error('invalid position');return Boolean(s.atLimit&&Math.abs(s.target-s.position)>t.angle);
    case 'velocity': if(!finite(s.speed))throw Error('invalid speed');return Boolean(s.atLimit&&Math.abs(s.target-s.speed)>t.rate);
    case 'torque': if(!finite(s.torque,s.speed))throw Error('invalid torque');return Math.abs(s.target)>t.torque&&Math.abs(s.target-s.torque)<=t.torque&&expectation.minimumSpeed>t.motionFloor&&Math.abs(s.speed)<t.motionFloor;
    default:throw Error('unknown command mode');
  }
}
export function l1a(x) {
  const flags=['finite','noFall','noDamage','noForbiddenSupport','noSaturation','noReset'];
  const initial=x.initialHold,terminal=x.terminalHold;
  if(!initial||!terminal||!Array.isArray(x.touchdowns)||!x.invariants)return false;
  const ticks=[initial.startTick,initial.endTick,terminal.startTick,terminal.endTick];
  if(!ticks.every(Number.isSafeInteger)||initial.endTick!==0||initial.endTick-initial.startTick<600||terminal.startTick<=0||terminal.endTick-terminal.startTick<600||terminal.endTick>7200)return false;
  return x.dt===1/120&&finite(x.L,x.displacement)&&x.L>0&&x.displacement>=x.L&&flags.every(k=>x.invariants[k]===true)&&x.touchdowns.length>=8&&x.touchdowns.every((t,i)=>Number.isSafeInteger(t.tick)&&t.tick>0&&t.tick<terminal.startTick&&finite(t.forward)&&t.forward>0&&(t.pad===0||t.pad===1)&&(i===0||(t.tick>x.touchdowns[i-1].tick&&t.pad!==x.touchdowns[i-1].pad)));
}
const digest=x=>createHash('sha256').update(x).digest('hex');
export function sealRobustness(levels,seed,secret) {
  const keys=Object.keys(levels).sort();
  if(keys.join(',')!==['startX','startY','heading','mass','payload','slope','friction','disturbance','mirror'].sort().join(',')||keys.some(k=>!Array.isArray(levels[k])||levels[k].length!==3||!levels[k].every(v=>typeof v==='number'&&Number.isFinite(v))))throw Error('nine dimensions, three numeric levels required');
  let counter=0;const rand=n=>parseInt(digest(`${seed}:${counter++}`).slice(0,8),16)%n;
  const nominal=Object.fromEntries(keys.map(k=>[k,levels[k][0]]));
  const candidates=[nominal];
  for(const k of keys)for(const level of levels[k].slice(1))candidates.push({...nominal,[k]:level});
  for(let i=0;i<20;i++)candidates.push(Object.fromEntries(keys.map(k=>[k,levels[k][rand(3)]])));
  const unique=[...new Map(candidates.map(c=>[JSON.stringify(c),c])).values()].map(c=>({id:digest(JSON.stringify(c)),values:c}));
  for(let i=unique.length-1;i>0;i--){const j=rand(i+1);[unique[i],unique[j]]=[unique[j],unique[i]];}
  const tuning=unique.slice(0,Math.ceil(unique.length/2)),heldout=unique.slice(Math.ceil(unique.length/2));
  const body=JSON.stringify(heldout),key=createHash('sha256').update(secret).digest(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const encrypted=Buffer.concat([cipher.update(body),cipher.final()]);
  return {version:VERSION,tuning,commitment:digest(body),caseCount:unique.length,heldoutCount:heldout.length,sealed:{iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),body:encrypted.toString('hex')}};
}
export function openRobustness(protocol,secret) {
  const key=createHash('sha256').update(secret).digest(),decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(protocol.sealed.iv,'hex'));decipher.setAuthTag(Buffer.from(protocol.sealed.tag,'hex'));
  const body=Buffer.concat([decipher.update(Buffer.from(protocol.sealed.body,'hex')),decipher.final()]).toString();
  if(digest(body)!==protocol.commitment)throw Error('commitment mismatch');return JSON.parse(body);
}
export function qualificationPass(cases,evidence,identity) {
  return cases.length>0&&evidence.length===cases.length&&new Set(evidence.map(e=>e.caseId)).size===cases.length&&cases.every(c=>evidence.some(e=>e.caseId===c.id&&e.pass===true&&e.identity===identity));
}
export function loopReachable(start,foot) { return finite(...start,...foot)&&distance(start,foot)<=1.0; }
export function forbiddenSupportFailure(impulses,W0) {
  if(!finite(W0)||W0<=0||!impulses.every(j=>finite(j)&&j>=0))return true;
  let consecutive=0,sum=0;
  for(let i=0;i<impulses.length;i++) {const j=impulses[i];consecutive=j>0.02*W0/120?consecutive+1:0;sum+=j;if(i>=240)sum-=impulses[i-240];if(consecutive>=10||sum>0.05*W0*2)return true;}
  return false;
}
export function saturationFailure(samples) {let ticks=0;for(const sample of samples){if(typeof sample!=='boolean')return true;ticks=sample?ticks+1:0;if(ticks>=60)return true;}return false;}
