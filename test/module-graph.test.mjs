import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildModuleGraph, validateLayers, affectedTests } from '../scripts/module-graph.mjs';

test('package runtime network contract binds service and permits only declared requests and URL parsing', () => {
 const root=mkdtempSync(join(tmpdir(),'sim-network-'));
 const put=(path,text)=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),text);};
 const config={runtimeNetworkDependencies:{'src/application/client.mjs':{namespace:'/api/playtest/',service:'../../scripts/server.mjs',dynamicFetchArguments:['next.url']}},runtimeURLArguments:{'scripts/server.mjs':['req.url','req.headers.origin']}};
 const source="fetch('/api/playtest/config'); fetch(next.url);";
 const graph=()=>buildModuleGraph(root,{entrypoints:['src/application/client.mjs']});
 try {
  put('package.json',JSON.stringify({moduleGraph:config}));
  put('src/application/client.mjs',source);
  put('scripts/server.mjs',"import './service-helper.mjs'; new URL(req.url, 'http://localhost'); new URL(req.headers.origin);");
  put('scripts/service-helper.mjs','export const limit=100;');
  put('test/client.test.mjs',"import '../src/application/client.mjs';");
  put('test/unrelated.test.mjs','export {};');
  assert.deepEqual(graph().errors,[]);
  assert.ok(graph().nodes.has('scripts/service-helper.mjs'));
  assert.deepEqual(validateLayers(graph()),[]);
  assert.deepEqual(affectedTests(buildModuleGraph(root),['scripts/service-helper.mjs']),['test/client.test.mjs']);
  for(const source of ["fetch('/api/other/config');","fetch('/api/playtest/../secret');","fetch('/api/playtest/%2e%2e/secret');","fetch(other.url);","new URL(next.url, import.meta.url);","fetch('/missing.json');"]) {
   put('src/application/client.mjs',source); assert.ok(graph().errors.length,source);
  }
  put('src/application/client.mjs',source);
  put('scripts/server.mjs',"new URL(other.url); fetch(req.url);"); assert.ok(graph().errors.length);
  put('scripts/server.mjs',"import './missing-helper.mjs';");assert.match(graph().errors.join('\n'),/unresolved dependency/);
  config.runtimeNetworkDependencies['src/application/client.mjs'].service='../../scripts/missing.mjs';
  put('package.json',JSON.stringify({moduleGraph:config})); assert.match(graph().errors.join('\n'),/unresolved dependency/);
  put('package.json','{}');assert.ok(graph().errors.length);
 } finally {rmSync(root,{recursive:true,force:true});}
});
