import { createSession } from '../../src/simulation/session.mjs';
import { createClock } from '../../src/application/clock.mjs';
import { deterministicProjection } from '../../src/model/tick.mjs';
const configuration={power:{cells:[],motors:[],wires:[],signalWires:[],receivers:[],controllers:[],sensors:[]},gravity:[0,-9.81,0],joints:[],bodies:[{position:[0,10,0],velocity:[0,0,0],mass:1,shape:'box',halfExtents:[.1,.1,.1],fixed:false,rotation:[0,0,0,1],friction:0.5,restitution:0}]};
const session=await createSession(configuration),canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
let lastCursor,trace=[];
function render(){
 const result=session.observe('scene','full',lastCursor);
 if(result.ok){for(const frame of result.frames)trace.push(deterministicProjection(frame));lastCursor=result.cursor;}
 const frame=session.observe().frames.at(-1),position=frame.physics[0].position;
 ctx.fillStyle='#f8fafc';ctx.fillRect(0,0,900,480);
 ctx.strokeStyle='#b5c5d1';ctx.fillStyle='#536675';ctx.font='14px system-ui';
 for(let y=0;y<=12;y+=2){const py=440-y*32;ctx.beginPath();ctx.moveTo(50,py);ctx.lineTo(850,py);ctx.stroke();ctx.fillText(`${y} m`,8,py+5);}
 ctx.fillStyle='#167c9e';ctx.fillRect(450+position[0]*32-8,440-position[1]*32-8,16,16);
 document.querySelector('#state').textContent=`Tick ${frame.tick} · height ${position[1].toFixed(3)} m · velocity ${frame.physics[0].velocity[1].toFixed(3)} m/s`;
}
const clock=createClock(session,{requestFrame:requestAnimationFrame,cancelFrame:cancelAnimationFrame,render});
document.querySelector('#start-btn').onclick=()=>clock.start();
document.querySelector('#pause').onclick=()=>clock.pause();
document.querySelector('#step').onclick=()=>{clock.pause();session.step(1);render();};
window.advanceTime=ms=>{clock.pause();clock.advanceTime(ms);};
window.render_game_to_text=()=>JSON.stringify({coordinates:'x right, y up, z depth; meters',...session.observe().frames.at(-1)});
window.probe={session,clock,trace:()=>trace,configuration};
render();
