import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {sourceIdentity} from '../scripts/source-identity.mjs';
test('source identity includes uncommitted additions and deletions',()=>{
 const root=mkdtempSync(join(tmpdir(),'source-identity-'));const previous=process.cwd();
 try {process.chdir(root);execFileSync('git',['init','-q']);writeFileSync('file.txt','first');execFileSync('git',['add','file.txt']);execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','fixture']);
 const first=sourceIdentity();assert.deepEqual(sourceIdentity(),first);rmSync('file.txt');const removed=sourceIdentity();assert.notEqual(removed.workingTreeDigest,first.workingTreeDigest);writeFileSync('new.txt','new');assert.notEqual(sourceIdentity().workingTreeDigest,removed.workingTreeDigest);
 }finally{process.chdir(previous);rmSync(root,{recursive:true,force:true});}
});
