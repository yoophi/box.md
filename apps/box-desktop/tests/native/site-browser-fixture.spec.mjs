import { expect, test } from "@playwright/test";
import { startBrowserFixture } from "./site-browser-fixture.mjs";

let fixture;
test.beforeAll(async()=>{fixture=await startBrowserFixture({slowMs:30});});
test.afterAll(async()=>{await fixture.close();});

test("fixture pages support history/reload, redirects and dynamic titles",async({page})=>{
  await page.goto(fixture.baseUrl+"/one");
  await expect(page.locator("#reload-count")).toHaveText("방문·새로고침 횟수: 1");
  await page.getByRole("link",{name:"두 번째로 이동"}).click();await expect(page).toHaveTitle("Fixture two");
  await page.goBack();await expect(page).toHaveTitle("Fixture one");
  await page.goForward();await expect(page).toHaveTitle("Fixture two");
  await page.goto(fixture.baseUrl+"/one");
  const count=Number((await page.locator("#reload-count").innerText()).split(": ")[1]);
  await page.reload();await expect(page.locator("#reload-count")).toHaveText(`방문·새로고침 횟수: ${count+1}`);
  await page.goto(fixture.baseUrl+"/redirect");await expect(page).toHaveURL(fixture.baseUrl+"/two?redirect=1");
  await page.goto(fixture.baseUrl+"/title");await expect(page).toHaveTitle("Fixture title updated 🌱");
  await expect(page.locator("#title-state")).toHaveText("제목 변경 완료");
});

test("fixture creates real popup/frame/history cases without confusing their parent",async({page})=>{
  await page.goto(fixture.baseUrl+"/popup");
  const linkPopup=page.waitForEvent("popup");await page.getByRole("link",{name:"target blank 링크"}).click();
  const child=await linkPopup;await expect(child).toHaveURL(fixture.baseUrl+"/two?popup=link");await child.close();
  const scriptPopup=page.waitForEvent("popup");await page.getByRole("button",{name:"window.open"}).click();
  const scripted=await scriptPopup;await expect(scripted).toHaveURL(fixture.baseUrl+"/two?popup=script");await scripted.close();
  await page.goto(fixture.baseUrl+"/iframe");
  const frame=page.frameLocator("iframe");await expect(frame.getByRole("heading",{name:"하위 프레임"})).toBeVisible();
  await frame.getByRole("link",{name:"프레임 안에서 이동"}).click();
  await expect(frame.getByRole("heading",{name:"두 번째 페이지"})).toBeVisible();
  await expect(page).toHaveURL(fixture.baseUrl+"/iframe");await expect(page).toHaveTitle("Fixture main with frame");
  await page.goto(fixture.baseUrl+"/fragment");await page.getByRole("button",{name:"URL과 제목 변경"}).click();
  await expect(page).toHaveURL(fixture.baseUrl+"/fragment?state=2#changed");await expect(page).toHaveTitle("Fixture history changed");
  await page.goBack();await expect(page).toHaveTitle("Fixture history initial");
});

test("fixture exposes selectable rich, oversized and navigation-race content",async({page})=>{
  await page.goto(fixture.baseUrl+"/selection");
  await page.getByRole("button",{name:"검증 원문 선택"}).click();
  const selected=await page.evaluate(()=>getSelection().toString());
  expect(selected).toContain("첫 줄의 Unicode 원문 🌱");
  expect(selected).toContain('**Markdown** 과 <script>alert("실행 금지")</script>');
  expect(selected).toContain("````");

  await page.goto(fixture.baseUrl+"/selection-large");
  await page.getByRole("button",{name:"대용량 원문 선택"}).click();
  expect(await page.evaluate(()=>new TextEncoder().encode(getSelection().toString()).length)).toBeGreaterThan(262144);

  await page.goto(fixture.baseUrl+"/selection-race");
  await page.getByRole("button",{name:"선택 후 주소와 제목 변경"}).click();
  await expect(page).toHaveURL(fixture.baseUrl+"/selection-race?state=2#captured");
  await expect(page).toHaveTitle("선택 경쟁 이후 제목 🌊");
  expect(await page.evaluate(()=>getSelection().toString())).toBe("경쟁 상태에서도 한 번에 읽은 원문 🌊");
});

test("native selection tracker keeps blurred selections and clears explicit deselection or removed DOM",async({page})=>{
  await page.addInitScript({path:"src-tauri/src/infrastructure/site_selection.js"});
  await page.goto(fixture.baseUrl+"/iframe");
  const child=page.frames().find(frame=>frame.parentFrame());
  await child.goto(fixture.baseUrl+"/selection");
  await child.getByRole("button",{name:"검증 원문 선택"}).click();
  const selected=await child.evaluate(()=>getSelection().toString());
  expect(selected).toContain("첫 줄의 Unicode 원문 🌱");
  // WebKit clears Selection and emits selectionchange before reporting blur.
  await child.evaluate(()=>{
    getSelection().removeAllRanges();document.dispatchEvent(new Event('selectionchange'));
    // Keep clearing and blur in one task, as WebKit's native responder transition does.
    const parentBody=window.parent.document.body;parentBody.tabIndex=-1;parentBody.focus();
  });
  await expect.poll(()=>child.evaluate(()=>document.hasFocus())).toBe(false);
  // Reproduce the selection clearing that WKWebView performs on first-responder loss.
  await child.evaluate(()=>getSelection().removeAllRanges());
  expect(await child.evaluate(()=>window.__boxReadSiteSelection())).toBe(selected);
  await child.getByRole("heading",{name:"선택 영역 수집",exact:true}).click();
  await expect.poll(()=>child.evaluate(()=>window.__boxReadSiteSelection())).toBe("");
  await child.getByRole("button",{name:"검증 원문 선택"}).click();
  await page.getByRole("heading",{name:"주 페이지",exact:true}).click();
  await child.evaluate(()=>{getSelection().removeAllRanges();document.querySelector('#selection-content').remove();});
  expect(await child.evaluate(()=>window.__boxReadSiteSelection())).toBe("");
  await child.goto(fixture.baseUrl+"/one");
  expect(await child.evaluate(()=>window.__boxReadSiteSelection())).toBe("");
});

test("absence of a native bridge is reported as unverified, never as denied",async({page})=>{
  await page.goto(fixture.baseUrl+"/ipc");await page.getByRole("button",{name:"접근 거부 확인"}).click();
  await expect(page.locator('#ipc-results li[data-status="missing-bridge"]')).toHaveCount(7);
  await expect(page.locator('#ipc-results li[data-status="denied"]')).toHaveCount(0);
});

for(const mode of ["denied","allowed","other-error","filesystem-denied"]) {
  test(`IPC checker distinguishes ${mode} and never renders credential values`,async({page})=>{
    const messages=[],requests=[];
    page.on("console",message=>messages.push(message.text()));page.on("request",request=>requests.push(request.url()));
    await page.addInitScript((mode)=>{
      window.__TAURI_INTERNALS__={fixtureMarker:true,async invoke(command){
        if(this.fixtureMarker!==true)throw new Error("wrong bridge receiver");
        if(mode==="denied")throw new Error(command+" not allowed on this webview");
        if(mode==="other-error")throw new Error("unrelated missing resource");
        if(mode==="filesystem-denied")throw new Error("Permission denied (os error 13)");
        return {token:"fixture-secret-never-display",content:"fixture-private-response"};
      }};
    },mode);
    await page.goto(fixture.baseUrl+"/ipc");await page.getByRole("button",{name:"접근 거부 확인"}).click();
    const status={denied:"denied",allowed:"unexpected-allow","other-error":"inconclusive-error","filesystem-denied":"inconclusive-error"}[mode];
    await expect(page.locator(`#ipc-results li[data-status="${status}"]`)).toHaveCount(7);
    expect(await page.locator("body").innerText()).not.toContain("fixture-secret-never-display");
    expect(await page.locator("body").innerText()).not.toContain("fixture-private-response");
    expect(messages.join("\n")).not.toContain("fixture-secret-never-display");
    expect(requests.join("\n")).not.toContain("fixture-secret-never-display");
  });
}
