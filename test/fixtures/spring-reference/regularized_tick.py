"""Independent planar complete-tick reference; no native or application imports."""
import mpmath as mp
import json, argparse, time
from pathlib import Path

class Reference:
 def __init__(self, mass='1', precision=60, mutant=None, damping='0'):
  mp.mp.dps=precision;self.mutant=mutant;self.precision=precision;self.mass=mp.mpf(mass);self.damping=mp.mpf(damping);self.dampingWork=mp.mpf(0)
  self.h=mp.mpf(1)/480;self.k=mp.mpf(3);self.rest=mp.mpf('.32');self.eps=mp.mpf(2)**-52
  self.q=list(map(mp.mpf,['.12','0','0','0','.18','0','.24','0','0']));self.v=[mp.mpf(0)]*9
  I=[self.mass*(mp.mpf('.06')**2+mp.mpf('.008')**2)/3]+[(mp.mpf('.008')**2+mp.mpf('.02')**2)/3]*2
  self.W=[n for m,i in zip([self.mass,mp.mpf(1),mp.mpf(1)],I)for n in [1/m,1/m,1/i]]
  om=2*mp.pi*10**6;self.erp_h=om/(self.h*om+2);self.gamma=1/(self.h*om*(self.h*om+2))
  self.motorC=1/(self.eps*self.h**2*self.k);self.trace=[];self.samples=[];self.maxResidual=mp.mpf(0)
  self.tick=0;self.energy0=self.energy();self.preparationWork=mp.mpf(0);self.hardWork=mp.mpf(0);self.springWork=mp.mpf(0)
 def dot(self,a,b):return mp.fdot(a,b)
 def metric(self,a,b):return mp.fsum(a[i]*self.W[i]*b[i]for i in range(9))
 def rotate(self,angle,p):
  c,s=mp.cos(angle),mp.sin(angle);return[c*p[0]-s*p[1],s*p[0]+c*p[1]]
 def point(self,i,local):
  arm=self.rotate(self.q[3*i+2],list(map(mp.mpf,local)));return[self.q[3*i+k]+arm[k]for k in range(2)]
 def linear(self,a,b,pa,pb,d):
  row=[mp.mpf(0)]*9
  for body,sign in [(a,-1),(b,1)]:
   if body is None:continue
   point=pa if self.mutant=='separate-anchor-reactions' and sign==-1 else pb
   arm=[point[k]-self.q[3*body+k]for k in range(2)]
   row[3*body]=sign*d[0];row[3*body+1]=sign*d[1];row[3*body+2]=sign*(arm[0]*d[1]-arm[1]*d[0])
  gap=self.dot(d,[pb[i]-pa[i]for i in range(2)])
  return row,gap
 def geometry(self):
  groups=[];gaps=[]
  for a,b,pa,pb in [(None,0,[mp.mpf(0)]*2,self.point(0,['-.12',0])),(None,1,[mp.mpf(0),mp.mpf('.18')],self.point(1,[0,0])),(0,2,self.point(0,['.12',0]),self.point(2,[0,0]))]:
   angle=0 if a is None else self.q[3*a+2]
   group=[self.linear(a,b,pa,pb,self.rotate(angle,d))for d in [[0,1],[-1,0]]];groups.append(group)
   gaps.extend(pb[i]-pa[i]for i in range(2))
  delta=self.q[8]-self.q[5];angular=[mp.mpf(0)]*9
  factor=mp.cos(delta/2)/2;angular[5]=-factor;angular[8]=factor
  pa=self.point(1,[0,0]);pb=self.point(2,[0,0]);normal=self.rotate(self.q[5],[mp.mpf('.6'),mp.mpf('.8')])
  transverse=self.linear(1,2,pa,pb,normal);groups.append([(angular,mp.sin(delta/2)),transverse]);gaps.extend([transverse[1],delta])
  direction=self.rotate(self.q[5],[mp.mpf('.8'),mp.mpf('-.6')]);motor,length=self.linear(1,2,pa,pb,direction)
  rows=[];bias=[];C=[]
  for group in groups:
   finalized=[]
   for row,gap in group:
    b=self.erp_h*gap
    for prior,pb in finalized:
     coeff=self.metric(row,prior)/self.metric(prior,prior)
     row=[x-coeff*y for x,y in zip(row,prior)];b-=coeff*pb
    finalized.append((row,b));rows.append(row);bias.append(b);C.append(self.gamma*self.metric(row,row))
  return rows,bias,C,motor,length,gaps
 def kinetic(self):return mp.fsum(self.v[i]**2/self.W[i]for i in range(9))/2
 def potential(self):return self.k*(self.geometry()[4]-self.rest)**2/2
 def energy(self):return self.kinetic()+self.potential()
 def solve(self,rows,C,bias,old):
  A=mp.matrix([[self.metric(a,b)+(C[i]if i==j else 0)for j,b in enumerate(rows)]for i,a in enumerate(rows)])
  rhs=mp.matrix([self.dot(row,self.v)+bias[i]-C[i]*old[i]for i,row in enumerate(rows)])
  # Independent row scaling before pivoted elimination; retained source precision
  # is fixed, including the binary64 EPS in the declared elastic law.
  scale=[mp.sqrt(A[i,i])for i in range(len(rows))]
  scaled=mp.matrix([[A[i,j]/scale[i]/scale[j]for j in range(len(rows))]for i in range(len(rows))])
  solved=mp.lu_solve(scaled,mp.matrix([rhs[i]/scale[i]for i in range(len(rows))]));change=[solved[i]/scale[i]for i in range(len(rows))]
  residual=max(abs(mp.fdot(A[i,:],change)-rhs[i])/(abs(rhs[i])+mp.fsum(abs(A[i,j]*change[j])for j in range(len(rows))) or 1)for i in range(len(rows)))
  self.maxResidual=max(self.maxResidual,residual)
  if residual>mp.mpf(10)**(-self.precision+12):raise ArithmeticError('independent equation residual')
  impulse=[-mp.fsum(rows[j][i]*change[j]for j in range(len(rows)))for i in range(9)]
  before=self.v[:];self.v=[before[i]+self.W[i]*impulse[i]for i in range(9)]
  midpoint=[(a+b)/2 for a,b in zip(before,self.v)]
  work=[-change[i]*self.dot(row,midpoint)for i,row in enumerate(rows)]
  self.lastDelta=change[:]
  return [a+b for a,b in zip(old,change)],work
 def step(self,record=False):
  initial=self.energy();rows,bias,C,_,_,_=self.geometry()
  if self.mutant!='skip-preparation':
   _,work=self.solve(rows,C,[mp.mpf(0)]*8,[mp.mpf(0)]*8);self.preparationWork+=mp.fsum(work)
  if self.damping:
   # Ordinary endpoint damper: COM attachments supply equal/opposite linear
   # impulses, with no invented off-manifold angular force term.
   f=[mp.mpf(0)]*9;direction=self.rotate(self.q[5],[mp.mpf('.8'),mp.mpf('-.6')])
   for i in range(2):f[3+i]=-direction[i];f[6+i]=direction[i]
   saved=self.v[:];self.v=[self.W[i]*f[i]for i in range(9)]
   self.solve(rows,C,[mp.mpf(0)]*8,[mp.mpf(0)]*8)
   response=self.v[:];self.v=saved
   mobility=self.dot(f,response);speed=self.dot(f,self.v);dt=self.h*4
   impulse=-dt*self.damping*speed/(1+dt*self.damping*mobility)
   if self.mutant=='anti-damper':impulse=-impulse
   before=self.kinetic();self.v=[x+impulse*y for x,y in zip(self.v,response)]
   self.dampingWork+=self.kinetic()-before
  for sub in range(4):
   rows,bias,C,motor,length,_=self.geometry();rows.append(motor);C.append(self.motorC)
   elastic=(length-self.rest)*self.h*self.k*self.motorC;bias.append(elastic)
   old=[mp.mpf(0)]*9
   old,work=self.solve(rows,C,bias,old);self.hardWork+=mp.fsum(work[:8]);self.springWork+=work[8]
   biasedMotor=old[8];elasticTarget=self.h*self.k*(length-self.rest)
   beforeDrift=self.potential();driftQ=self.q[:];driftV=self.v[:]
   for i in range(3):
    self.q[3*i]+=self.h*self.v[3*i];self.q[3*i+1]+=self.h*self.v[3*i+1]
    self.q[3*i+2]+=self.h*self.v[3*i+2]if self.mutant=='exact-angle-drift'else 2*mp.atan(self.h*self.v[3*i+2]/2)
   deltaU=self.potential()-beforeDrift
   if self.mutant!='stale-post-rows':
    rows,_,C,motor,length,gaps=self.geometry();rows.append(motor);C.append(self.motorC)
   if self.mutant=='resample-elastic':elastic=(length-self.rest)*self.h*self.k*self.motorC
   if self.mutant=='drop-pass-impulse':old=[mp.mpf(0)]*9
   old,work=self.solve(rows,C,[mp.mpf(0)]*8+[elastic],old);self.hardWork+=mp.fsum(work[:8]);self.springWork+=work[8]
   if record:self.trace.append({'tick':self.tick,'sub':sub,'q':self.q[:],'v':self.v[:],'deltaU':deltaU,'motorTotalAppliedImpulse':biasedMotor+self.lastDelta[8],'elasticImpulseTarget':elasticTarget,'driftQ':driftQ,'driftV':driftV,'hardWorkPost':mp.fsum(work[:8]),'motorWorkPost':work[8],'impulses':old[:]})
  self.tick+=1
  sample={'tick':self.tick,'q':self.q[:],'v':self.v[:],'energy':self.energy(),'deltaEnergy':self.energy()-initial,'gaps':self.geometry()[5]}
  self.samples.append(sample);return sample
 def summary(self):
  return {'ticks':self.tick,'massRatio':self.mass,'damping':self.damping,'dampingWork':self.dampingWork,'precision':self.precision,'q':self.q,'v':self.v,'initialEnergy':self.energy0,'energy':self.energy(),'maxEquationResidual':self.maxResidual,'preparationWork':self.preparationWork,'hardWork':self.hardWork,'springWork':self.springWork,'trace':self.trace,'samples':self.samples}

def default(o):return mp.nstr(o,70)if isinstance(o,(mp.mpf,mp.mpc))else str(o)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--ticks',type=int,default=1);p.add_argument('--precision',type=int,default=60);p.add_argument('--mass',default='1');p.add_argument('--damping',default='0');p.add_argument('--output');p.add_argument('--mutant');a=p.parse_args();ref=Reference(a.mass,a.precision,a.mutant,a.damping);start=time.monotonic()
 for _ in range(a.ticks):ref.step(record=a.ticks<=2)
 report=ref.summary();report['seconds']=time.monotonic()-start;report['status']='INDEPENDENT_NUMERICAL_REFERENCE_NOT_CERTIFIED';text=json.dumps(report,default=default,indent=2)+'\n'
 if a.output:Path(a.output).write_text(text)
 print(json.dumps({k:report[k]for k in ['ticks','seconds','energy','maxEquationResidual','status']},default=default))
