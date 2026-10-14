// Browser test of the built page, opened as a file as a user opens it: once
// with the solver worker, and once with workers switched off (page mode).
// Needs Chrome: set CHROME_PATH, or install it in the usual place.
//
//   npm run build && npm run test:browser

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { findChrome } from "../chrome.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const file = pathToFileURL(join(here, "..", "dist", "turflp-dashboard.html")).href;
const chrome = findChrome();

// Reach at the top-2 box for sizes 1 to 8 of the ice cream data (R package).
const ICECREAM = ["39.2% (47)", "61.7% (74)", "72.5% (87)", "79.2% (95)", "83.3% (100)",
                  "86.7% (104)", "88.3% (106)", "90.0% (108)"];

function check(ok, message) {
  if (!ok) throw new Error(message);
}

async function session(workers) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    if (!workers) await page.addInitScript(() => { window.Worker = function () { throw new Error("off"); }; });
    // With workers, keep each worker, and hold back a "ready" reply while __holdReady is set.
    if (workers) await page.addInitScript(() => {
      const Native = window.Worker;
      window.__workers = [];
      window.Worker = class extends Native {
        constructor(...args) { super(...args); window.__workers.push(this); }
        get onmessage() { return super.onmessage; }
        set onmessage(fn) {
          super.onmessage = (e) => {
            if (e.data?.type === "ready" && window.__holdReady) { window.__release = () => fn.call(this, e); return; }
            fn.call(this, e);
          };
        }
      };
    });
    await page.goto(file);
    const wait = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 120_000 });
    const click = (selector) => page.evaluate((s) => document.querySelector(s).click(), selector);
    const clickExample = (title) => page.evaluate((t) =>
      [...document.querySelectorAll(".example")].find((b) => b.textContent.includes(t)).click(), title);
    const idle = () => wait(() => document.getElementById("run").textContent === "Run" &&
                                  !document.getElementById("run").disabled);

    await wait(() => document.getElementById("solver-status").textContent.startsWith("Solver ready"));
    const status = await page.$eval("#solver-status", (e) => e.textContent);
    check(workers === (status === "Solver ready"), `unexpected solver status: ${status}`);

    // The icon is in the file, and the link preview image is on the host.
    const icon = await page.$eval('link[rel="icon"][type="image/svg+xml"]', (e) => e.href);
    check(icon.startsWith("data:image/svg+xml,"), "the icon is not in the file");
    check(await page.evaluate((src) => { const i = new Image(); i.src = src; return i.decode().then(() => true, () => false); }, icon),
          "the icon is not a readable image");
    const card = await page.$eval('meta[property="og:image"]', (e) => e.content);
    check(card === "https://turf.aigora.ai/og.png", `link preview image: ${card}`);

    // An example, all sizes.
    await clickExample("Ice cream");
    await wait(() => /every respondent/.test(document.getElementById("size-hint").textContent));
    check(await page.$eval("#size-to", (e) => e.value) === "8", "default sizes are not 1 to 8");
    await click("#run");
    await wait(() => document.querySelectorAll(".size-table tbody tr[tabindex]").length === 8);
    await idle();
    const reach = await page.$$eval(".size-table tbody tr", (rows) => rows.map((r) => r.children[1].textContent));
    check(JSON.stringify(reach) === JSON.stringify(ICECREAM), `ice cream reach: ${reach}`);
    check(await page.$$eval(".curve .dot", (d) => d.length) === 8, "the reach curve does not have 8 points");
    check(await page.$$eval(".bar-row.is-in", (r) => r.length) === 8, "the bars do not mark 8 products");

    // Keyboard: Enter on a point of the curve selects it and keeps the focus there.
    await page.evaluate(() => document.querySelector('.curve .hit[data-size="3"]').focus());
    await page.keyboard.press("Enter");
    const focus = await page.evaluate(() => ({
      size: document.activeElement?.getAttribute("data-size"),
      title: document.querySelector(".headline-title").textContent,
    }));
    check(focus.size === "3" && focus.title.startsWith("3 products"), `keyboard selection: ${JSON.stringify(focus)}`);

    // The stages and the trade-off of the selected size, then the columns with what each product adds.
    await wait(() => document.querySelectorAll(".stage").length === 3 && !document.querySelector(".stage .skeleton") &&
                     document.querySelector(".frontier-table") && !document.querySelector(".hint.live"));
    const stage1 = await page.$eval(".stage .stage-value", (e) => e.textContent);
    check(stage1 === "72.5%", `stage 1 value: ${stage1}`);
    const frontierTop = await page.$eval(".frontier-table tbody tr td", (e) => e.textContent);
    check(frontierTop === "72.5% (87)", `first frontier point: ${frontierTop}`);
    await click('.segmented [data-value="columns"]');
    check(await page.$$eval(".columns .column", (c) => c.length) === 8, "the columns chart does not have 8 columns");
    const parts = await page.$$eval(".contrib li", (rows) => rows.map((r) => r.querySelector(".contrib-total").textContent));
    check(parts.length === 3 && parts[2] === "72.5%", `contributions of size 3: ${parts}`);
    await click('.segmented [data-value="line"]');

    // Stage 2 set to none: one stage.
    await page.evaluate(() => {
      const s = document.getElementById("stage2");
      s.value = "none";
      s.dispatchEvent(new Event("change"));
    });
    check(await page.$eval("#stage3", (e) => e.disabled), "stage 3 is not disabled without stage 2");
    await click("#run");
    await wait(() => document.querySelectorAll(".size-table tbody tr[tabindex]").length === 8);
    await idle();
    await wait(() => document.querySelectorAll(".stage").length === 1);
    await page.evaluate(() => {
      const s = document.getElementById("stage2");
      s.value = "frequency";
      s.dispatchEvent(new Event("change"));
    });

    // A worker that fails after it starts is replaced. Run stays disabled until the
    // new worker is ready, and a run after that finishes.
    if (workers) {
      await page.evaluate(() => {
        window.__holdReady = true;
        window.__workers.at(-1).dispatchEvent(new ErrorEvent("error", { message: "test failure" }));
      });
      await wait(() => typeof window.__release === "function");
      const during = await page.evaluate(() => ({
        disabled: document.getElementById("run").disabled,
        status: document.getElementById("solver-status").textContent,
      }));
      check(during.disabled && during.status.startsWith("Loading"), `during replacement: ${JSON.stringify(during)}`);
      await click("#run");
      await page.evaluate(() => { window.__holdReady = false; window.__release(); });
      await idle();
      await click("#run");
      await wait(() => document.querySelectorAll(".size-table tbody tr[tabindex]").length === 8);
      await idle();
    }

    // Cancel during the large example keeps the finished sizes; a new run works.
    await clickExample("Cafe");
    await wait(() => /every respondent/.test(document.getElementById("size-hint").textContent));
    await click("#run");
    await wait(() => document.querySelectorAll(".size-table tbody tr[tabindex]").length >= 2);
    await click("#run");
    await idle();
    const cancelled = await page.$$eval(".size-table tbody tr", (rows) => rows.filter((r) => r.textContent.includes("Cancelled")).length);
    check(cancelled > 0, "Cancel did not stop the run");
    await page.evaluate(() => {
      const to = document.getElementById("size-to");
      to.value = "2";
      to.dispatchEvent(new Event("input"));
    });
    await click("#run");
    await wait(() => document.querySelectorAll(".size-table tbody tr[tabindex]").length === 2);
    await idle();

    // A file with an ID column and ratings, then a file with an error.
    const load = (name, text) => page.evaluate(([n, t]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([t], n, { type: "text/csv" }));
      const input = document.getElementById("file");
      input.files = dt.files;
      input.dispatchEvent(new Event("change"));
    }, [name, text]);
    await load("ratings.csv", "id;A;B;C\n1;5;1;2\n2;1;4;1\n3;2;2;5\n4;4;1;1\n");
    await wait(() => /every respondent/.test(document.getElementById("size-hint").textContent));
    const info = await page.$eval("#data-info", (e) => e.textContent);
    check(/4 respondents, 3 products, ratings from 1 to 5/.test(info), `file summary: ${info}`);
    check(await page.$eval("#threshold-input", (e) => e.value) === "4", "the threshold is not the top-2 box");
    await click("#run");
    await wait(() => document.querySelectorAll(".size-table tbody tr[tabindex]").length === 3);
    const title = await page.$eval(".headline-title", (e) => e.textContent);
    check(title === "3 products reach 100.0% of respondents", `ratings title: ${title}`);
    await load("bad.csv", "A,B\n1,0\n1,x\n");
    await wait(() => !document.getElementById("data-error").hidden);
    const error = await page.$eval("#data-error", (e) => e.textContent);
    check(/Line 3, product "B"/.test(error), `error text: ${error}`);

    check(errors.length === 0, `console errors: ${errors.join(" | ")}`);
    console.log(`ok (${workers ? "worker" : "page"} mode)`);
  } finally {
    await browser.close();
  }
}

await session(true);
await session(false);
