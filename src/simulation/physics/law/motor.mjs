/** First-order split DC drive allocation; numeric SI inputs only.
 * Reserve voltage at the endpoint of the discrete angular kick. The physics
 * door measures that kick before contacts and gravity are integrated. This is
 * a finite-step approximation, not a coupled continuous-current solver.
 */
export function motorStep(voltage,speed,torqueConstant,resistance,currentLimit,inertia,dt) {
 if(![voltage,speed,torqueConstant,resistance,currentLimit,inertia,dt].every(Number.isFinite)||torqueConstant<=0||resistance<=0||currentLimit<0||inertia<=0||dt<=0)throw new RangeError('invalid motor numbers');
 let current=(voltage-torqueConstant*speed)/(resistance+torqueConstant**2*dt/inertia);
 // This driver does not regenerate or actively brake with power disconnected.
 if(voltage===0||current*voltage<0)current=0;
 current=Math.sign(current)*Math.min(Math.abs(current),currentLimit);
 const torque=torqueConstant*current,nextSpeed=speed+torque*dt/inertia;
 const electricalEnergy=voltage*current*dt;
 const mechanicalEnergy=torque*(speed+nextSpeed)*dt/2;
 // Includes winding heat and dissipation in the current limiting driver.
 const heatEnergy=electricalEnergy-mechanicalEnergy;
 return {current,torque,nextSpeed,electricalEnergy,mechanicalEnergy,heatEnergy};
}
