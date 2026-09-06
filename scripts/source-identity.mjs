import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export function sourceIdentity() {
 const files=execFileSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],{encoding:'utf8'}).split('\0').filter(Boolean).sort();
 const hash=createHash('sha256');
 for(const path of files)hash.update(path).update('\0').update(readFileSync(path)).update('\0');
 return {head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),workingTreeDigest:hash.digest('hex')};
}
