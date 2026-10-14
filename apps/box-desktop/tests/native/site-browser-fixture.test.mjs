import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtemp, readFile, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { startBrowserFixture } from "./site-browser-fixture.mjs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

test("serves the browsing cases and independent permalink documents over loopback", async(t) => {
  const fixture = await startBrowserFixture({ slowMs: 25 });t.after(fixture.close);
  const info = await fetch(`${fixture.baseUrl}/fixture-info`).then(r=>r.json());
  assert.equal(info.workspacePath, fixture.workspacePath);
  assert.match(fixture.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  const one = await readFile(fixture.sourceDocumentPath, "utf8");
  const two = await readFile(fixture.targetDocumentPath, "utf8");
  assert.match(one, /permalink: qa-source/);assert.match(two, /permalink: qa-target/);
  assert.ok(one.includes(`${fixture.baseUrl}/one`));
  for(const path of ["/", "/one", "/two", "/title", "/fragment", "/popup", "/iframe", "/embedded", "/ipc", "/selection", "/selection-large", "/selection-race"]) {
    const response=await fetch(fixture.baseUrl+path);assert.equal(response.status,200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.ok((await response.text()).includes('<script src="/fixture.js" defer>'));
  }
  const redirect=await fetch(`${fixture.baseUrl}/redirect`);
  assert.equal(new URL(redirect.url).pathname,"/two");assert.equal(new URL(redirect.url).search,"?redirect=1");
  assert.equal((await fetch(`${fixture.baseUrl}/error`)).status,503);
  assert.equal((await fetch(`${fixture.baseUrl}/missing`)).status,404);
  assert.equal((await fetch(`${fixture.baseUrl}/one`,{method:"POST"})).status,405);
  const started=performance.now();const slow=await fetch(`${fixture.baseUrl}/slow`).then(r=>r.text());
  assert.ok(performance.now()-started>=20);assert.ok(slow.includes("느린 응답 완료"));
  await assert.rejects(fetch(`${fixture.baseUrl}/disconnect`));
  assert.equal(await readFile(fixture.sourceDocumentPath,"utf8"),one);
});

test("rejects foreign Host headers instead of exposing local fixture metadata", async(t) => {
  const fixture=await startBrowserFixture();t.after(fixture.close);
  const response=await new Promise((resolve,reject)=>{
    const req=request(`${fixture.baseUrl}/fixture-info`,{headers:{Host:"untrusted.example"}},res=>{res.resume();resolve(res);});
    req.on("error",reject);req.end();
  });
  assert.equal(response.statusCode,403);
});

test("shutdown cancels an unfinished response, removes only its own files and is repeatable", async() => {
  const other=await mkdtemp(join(tmpdir(),"box-fixture-unrelated-"));
  const keep=join(other,"keep.md");await writeFile(keep,"original unrelated document");
  const fixture=await startBrowserFixture();
  try {
    const response=await fetch(`${fixture.baseUrl}/stall`);
    const reader=response.body.getReader();const first=await reader.read();assert.equal(first.done,false);
    await fixture.close();await fixture.close();
    await assert.rejects(access(dirname(fixture.workspacePath)));
    await assert.rejects(fetch(`${fixture.baseUrl}/one`));
    assert.equal(await readFile(keep,"utf8"),"original unrelated document");
  } finally { await fixture.close();await rm(other,{recursive:true,force:true}); }
});

test("CLI prints reproducible metadata and SIGTERM cleans its own workspace", {timeout:5000}, async(t) => {
  const child=spawn(process.execPath,[fileURLToPath(new URL("./site-browser-fixture.mjs",import.meta.url)),"--slow-ms","10"],{stdio:["ignore","pipe","pipe"]});
  t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill("SIGTERM");});
  const lines=createInterface({input:child.stdout});t.after(()=>lines.close());
  const [line]=await once(lines,"line");const info=JSON.parse(line);
  assert.equal(info.pid,child.pid);assert.equal(info.slowMs,10);
  assert.equal((await fetch(info.baseUrl+"/one")).status,200);
  await access(info.sourceDocumentPath);
  const exited=once(child,"exit");child.kill("SIGTERM");
  const [code,signal]=await exited;assert.equal(code,0);assert.equal(signal,null);
  await assert.rejects(access(dirname(info.workspacePath)));
});
