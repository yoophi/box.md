import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const pages = {
  "/": ["box.md native browser audit", `<h1>사이트 브라우징 검증</h1><p>각 페이지를 실제 box.md QA 앱의 사이트 브라우저에서 여세요.</p><dl id="workspace"></dl><nav>
    <a href="/one">첫 페이지 / 이력·새로고침</a><a href="/two">두 번째 페이지</a><a href="/redirect">HTTP redirect</a><a href="/title">동적 제목</a>
    <a href="/fragment">같은 문서의 URL 변경</a><a href="/popup">새 창 링크</a><a href="/iframe">하위 프레임</a><a href="/slow">17초 느린 응답</a>
    <a href="/stall">완료되지 않는 로드</a><a href="/error">HTTP 503</a><a href="/disconnect">연결 끊김</a><a href="/ipc">앱 명령 접근 거부</a></nav>`],
  "/one": ["Fixture one", `<h1>첫 페이지</h1><p id="reload-count"></p><a href="/two">두 번째로 이동</a><p>이동 후 앱의 뒤로·앞으로 버튼을 사용하세요. 새로고침하면 횟수가 늘어납니다.</p>`],
  "/two": ["Fixture two", `<h1>두 번째 페이지</h1><a href="/one">첫 번째로 이동</a><p>현재 주소와 제목을 확인하세요.</p>`],
  "/title": ["Fixture title initial", `<h1>동적 제목</h1><p id="title-state">제목 변경 대기</p>`],
  "/fragment": ["Fixture history initial", `<h1>같은 문서에서 이력 변경</h1><button id="push-state">URL과 제목 변경</button><p id="history-state"></p>`],
  "/popup": ["Fixture popup", `<h1>새 창 요청</h1><a href="/two?popup=link" target="_blank">target blank 링크</a><button id="open-popup">window.open</button><p>QA 앱에서는 새 앱 창을 만들지 않고 현재 사이트 영역이 이동해야 합니다.</p>`],
  "/iframe": ["Fixture main with frame", `<h1>주 페이지</h1><p>주소는 /iframe, 제목은 Fixture main with frame을 유지해야 합니다.</p><iframe title="검증 하위 프레임" src="/embedded"></iframe>`],
  "/embedded": ["Fixture frame only", `<h1>하위 프레임</h1><a href="/two?frame=1">프레임 안에서 이동</a>`],
  "/slow": ["Fixture slow completed", `<h1>느린 응답 완료</h1><a href="/one">정상 페이지로 이동</a>`],
  "/stall": ["Fixture unfinished load", `<h1>로드가 완료되지 않는 페이지</h1><p>앱에서 안내를 확인하고 다른 주소로 이동하거나 새로고침하세요.</p>`],
  "/error": ["Fixture HTTP 503", `<h1>HTTP 503</h1><p>HTTP 오류 응답도 이 페이지의 본문은 표시할 수 있습니다.</p><a href="/one">정상 페이지로 이동</a>`],
  "/ipc": ["Fixture IPC boundary", `<h1>외부 페이지의 앱 명령 접근</h1><p>결과가 모두 거부여야 합니다. 브리지가 없거나 다른 오류이면 미검증입니다.</p><button id="check-ipc">접근 거부 확인</button><ul id="ipc-results"></ul><p>허용된 경우에도 응답 값은 표시하거나 기록하지 않습니다.</p>`],
};
const css = `body{margin:0;background:#f5f3eb;color:#223a34;font:16px/1.7 system-ui}main{max-width:760px;padding:36px;margin:auto}h1{font:32px Georgia,serif}a,button{color:#244f42}nav{display:grid;gap:12px}button{padding:10px 14px;background:#eae8de;border:1px solid #bcbfab;border-radius:5px}iframe{width:100%;height:240px;border:1px solid #bcbfab}dd{overflow-wrap:anywhere;margin:0 0 12px}li[data-status=unexpected-allow]{color:#9b4837}`;
const script = `
const path = location.pathname;
if(path === '/') {
  fetch('/fixture-info').then(r => r.json()).then(info => {
    for(const [label, value] of [['작업 디렉터리', info.workspacePath], ['첫 문서', info.sourceDocumentPath], ['두 번째 문서', info.targetDocumentPath]]) {
      const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;document.querySelector('#workspace').append(dt,dd);
    }
  });
}
if(path === '/one') {
  const count=Number(sessionStorage.getItem('box-fixture.reload') || '0')+1;
  sessionStorage.setItem('box-fixture.reload',String(count));document.querySelector('#reload-count').textContent='방문·새로고침 횟수: '+count;
}
if(path === '/title') setTimeout(() => { document.title='Fixture title updated 🌱';document.querySelector('#title-state').textContent='제목 변경 완료'; },350);
if(path === '/fragment') {
  const update=()=>{const changed=location.search.includes('state=2');document.title=changed?'Fixture history changed':'Fixture history initial';document.querySelector('#history-state').textContent=location.pathname+location.search+location.hash;};
  document.querySelector('#push-state').addEventListener('click',()=>{history.pushState({},'', '/fragment?state=2#changed');update();});window.addEventListener('popstate',update);update();
}
if(path === '/popup') document.querySelector('#open-popup').addEventListener('click',()=>window.open('/two?popup=script','fixture-popup'));
if(path === '/ipc') document.querySelector('#check-ipc').addEventListener('click',async(event)=>{
  const button=event.currentTarget;button.disabled=true;
  const list=document.querySelector('#ipc-results');list.replaceChildren();
  try {
    const info=await fetch('/fixture-info').then(r=>r.json());
    const internals=window.__TAURI_INTERNALS__;
    const invoke=typeof internals?.invoke==='function'?internals.invoke.bind(internals):null;
    for(const [command,args] of [
      ['get_app_info',{}],
      ['open_document',{path:info.sourceDocumentPath}],
      ['list_workspace_documents',{path:info.workspacePath}],
      ['get_workbench_connection',{}],
      ['get_document_mcp_grant',{generation:'external-child',runId:'external-child'}],
      ['revoke_document_mcp_grant',{grantId:'external-child'}],
    ]) {
      let status='missing-bridge';
      if(typeof invoke==='function') {
        try { await invoke(command,args);status='unexpected-allow'; }
        catch(error) {
          const message=typeof error==='string'?error:error?.message || '';
          const acl=message.includes(command+' not allowed') || message==='command not allowed on any window/webview/URL context';
          const callerGuard=command==='get_workbench_connection' && /only the app page|current page cannot request|this window cannot request/i.test(message);
          status=acl || callerGuard?'denied':'inconclusive-error';
        }
      }
      // Never display, POST or log response values, raw errors or connection credentials.
      const row=document.createElement('li');row.dataset.command=command;row.dataset.status=status;row.textContent=command+': '+status;list.append(row);
    }
  } finally { button.disabled=false; }
});
`;

function html(title, body) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/fixture.css"><script src="/fixture.js" defer></script></head><body><main>${body}</main></body></html>`;
}

/** Owns only freshly created disposable files and a loopback server; never accepts a user directory. */
export async function startBrowserFixture({ port = 0, slowMs = 17000 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !Number.isInteger(slowMs) || slowMs < 0 || slowMs > 60000) throw new Error("Invalid fixture port or delay");
  const root = await mkdtemp(join(tmpdir(), "box-md-browser-fixture-"));
  const workspacePath = join(root, "workspace");
  const sockets = new Set(), timers = new Set();
  let info, closing;
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!info) { response.writeHead(503);response.end("Fixture starting");return; }
    const hosts = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
    if (!hosts.includes(request.headers.host)) { response.writeHead(403);response.end("Loopback host required");return; }
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405, { Allow: "GET, HEAD" });response.end();return; }
    const path = new URL(request.url, info.baseUrl).pathname;
    const send = (status, type, body) => { if (!response.destroyed) { response.writeHead(status, { "Content-Type": type });response.end(body); } };
    if (path === "/redirect") { response.writeHead(302, { Location: "/two?redirect=1" });response.end();return; }
    if (path === "/disconnect") { request.socket.destroy();return; }
    if (path === "/fixture-info") { send(200, "application/json; charset=utf-8", JSON.stringify(info));return; }
    if (path === "/fixture.js") { send(200, "text/javascript; charset=utf-8", script);return; }
    if (path === "/fixture.css") { send(200, "text/css; charset=utf-8", css);return; }
    const page = pages[path];
    if (!page) { send(404, "text/plain; charset=utf-8", "No fixture route");return; }
    const body = html(...page);
    if (path === "/slow") {
      const timer = setTimeout(() => { timers.delete(timer);send(200, "text/html; charset=utf-8", body); }, slowMs);
      timers.add(timer);response.once("close",()=>{clearTimeout(timer);timers.delete(timer);});return;
    }
    if (path === "/stall") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });response.write(body);
      return; // Deliberately keep this response unfinished until navigation or fixture shutdown.
    }
    send(path === "/error" ? 503 : 200, "text/html; charset=utf-8", body);
  });
  server.on("connection", (socket) => { sockets.add(socket);socket.once("close",()=>sockets.delete(socket)); });
  const close = () => closing ??= (async () => {
    const closed = new Promise((resolve) => server.close(resolve));
    for (const timer of timers) clearTimeout(timer);
    timers.clear();for(const socket of sockets) socket.destroy();
    await closed;await rm(root, { recursive: true, force: true });
  })();
  try {
    await new Promise((resolve, reject) => { server.once("error", reject);server.listen(port, "127.0.0.1", resolve); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    info = { baseUrl, workspacePath, sourceDocumentPath: join(workspacePath, "source.md"), targetDocumentPath: join(workspacePath, "target.md"), slowMs };
    await mkdir(workspacePath);
    await writeFile(info.sourceDocumentPath, `---\npermalink: qa-source\ntitle: QA 첫 문서\nsummary: 사이트 탐색 중 초안 유지 검증\n---\n# 첫 문서\n\n원본을 유지할 본문\n\n[검증 사이트](${baseUrl}/one)\n\n[[qa-target]]\n`);
    await writeFile(info.targetDocumentPath, "---\npermalink: qa-target\ntitle: QA 두 번째 문서\n---\n# 두 번째 문서\n\n다른 관계가 유지될 문서\n");
    return { ...info, close };
  } catch(error) { await close();throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { port: { type: "string" }, "slow-ms": { type: "string" } } });
  const fixture = await startBrowserFixture({ port: Number(values.port ?? 0), slowMs: Number(values["slow-ms"] ?? 17000) });
  const { close, ...info } = fixture;
  process.stdout.write(JSON.stringify({ ...info, pid: process.pid }) + "\n");
  let stopping = false;
  const stop = async () => { if (stopping) return;stopping = true;await close();process.exit(0); };
  process.on("SIGINT", stop);process.on("SIGTERM", stop);
}
