// Authored rotations may contain admitted rounding error. Geometry readers use
// the same normalized representation as the compiler and physical body poses.
export function normalizeQuaternion(q) {
 const norm=Math.hypot(...q);
 return q.map(value=>value/norm);
}
export function multiplyQuaternion(a,b) {
 const [x,y,z,w]=a,[X,Y,Z,W]=b;
 return [w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z];
}
export function rotateVector(rotation,v) {
 const q=normalizeQuaternion(rotation);
 return multiplyQuaternion(multiplyQuaternion(q,[...v,0]),[-q[0],-q[1],-q[2],q[3]]).slice(0,3);
}
