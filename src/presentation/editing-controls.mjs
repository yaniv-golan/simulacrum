import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { transformGroup } from '../model/editing.mjs';
import { CATALOG } from '../model/catalog.mjs';

/** Preview objects never overwrite authoritative rendered body poses. */
export function createEditingControls({scene,camera,renderer,orbit,getPart,getBlueprint,getMode,getMeshes,onCommit}) {
 const proxy=new THREE.Object3D(),preview=new THREE.Group();scene.add(proxy,preview);
 const gizmo=new TransformControls(camera,renderer.domElement);scene.add(gizmo.getHelper());
 gizmo.setTranslationSnap(.025);gizmo.setRotationSnap(Math.PI/12);gizmo.setSize(.8);
 let selected=null,tool='select',dragging=false,dragOrigin=null;
 function clearPreview(){for(const mesh of [...preview.children]){preview.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}}
 function showPreview(parts){clearPreview();for(const part of parts){const shape=CATALOG[part.type].primitives[0],h=shape.halfExtents;const geometry=shape.kind==='cylinder'?new THREE.CylinderGeometry(h[1],h[1],2*h[0],24).rotateZ(-Math.PI/2):new THREE.BoxGeometry(...h.map(v=>2*v));const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0x8cf5cf,transparent:true,opacity:.35,depthWrite:false}));mesh.position.fromArray(part.position);mesh.quaternion.fromArray(part.rotation);preview.add(mesh);}}
 function refresh(){if(dragging)return;const part=getPart(selected);if(!part||getMode()!=='build'||tool==='select'){gizmo.detach();return;}proxy.position.fromArray(part.position);proxy.quaternion.fromArray(part.rotation);gizmo.setMode(tool);gizmo.attach(proxy);}
 gizmo.addEventListener('dragging-changed',event=>{dragging=event.value;orbit.enabled=!dragging;if(dragging){const part=getPart(selected);dragOrigin=part&&structuredClone(part);}else refresh();});
 gizmo.addEventListener('objectChange',()=>{const part=getPart(selected);if(dragging&&part){const before=getBlueprint(),next=transformGroup(before,part.id,proxy.position.toArray(),proxy.quaternion.toArray());showPreview(next.parts.filter((p,i)=>JSON.stringify(p)!==JSON.stringify(before.parts[i])));}});
 gizmo.addEventListener('mouseUp',async()=>{if(!dragOrigin)return;const origin=dragOrigin;dragOrigin=null;const position=proxy.position.toArray(),rotation=proxy.quaternion.toArray();clearPreview();if(position.some((v,i)=>Math.abs(v-origin.position[i])>1e-8)||rotation.some((v,i)=>Math.abs(v-origin.rotation[i])>1e-8))await onCommit({type:'transform',id:origin.id,position,rotation});refresh();});
 function cancel(){dragOrigin=null;if(dragging)gizmo.reset();clearPreview();refresh();}
 function focus(){const meshes=[...getMeshes().values()];if(!meshes.length)return;const bounds=new THREE.Box3();for(const mesh of meshes)bounds.expandByObject(mesh);const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());const radius=Math.max(.3,size.length()*.5),distance=radius/Math.sin(THREE.MathUtils.degToRad(camera.fov*.5))*1.3;const direction=camera.position.clone().sub(orbit.target).normalize();orbit.target.copy(center);camera.position.copy(center).addScaledVector(direction,distance);orbit.update();}
 return {select(id){selected=id;clearPreview();refresh();},setTool(value){tool=value;clearPreview();refresh();},refresh,showPreview,clearPreview,cancel,focus,isDragging:()=>dragging,isHandleActive:()=>gizmo.axis!==null,dispose(){gizmo.dispose();scene.remove(gizmo.getHelper(),proxy,preview);clearPreview();}};
}
