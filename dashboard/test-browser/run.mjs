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

    // Light by default, also with a dark system setting; the button switches and the choice is kept.
    if (workers) {
      const theme = () => page.evaluate(() => [document.documentElement.dataset.theme ?? "light",
        getComputedStyle(document.body).backgroundColor, document.getElementById("theme").textContent]);
      await page.emulateMedia({ colorScheme: "dark" });
      const first = await theme();
      check(first[0] === "light" && first[1] === "rgb(247, 246, 242)", `default theme: ${first}`);
      await click("#theme");
      check((await theme())[0] === "dark" && (await theme())[2] === "Light mode", "the theme button does not switch to dark");
      await page.reload();
      await wait(() => document.getElementById("solver-status").textContent.startsWith("Solver ready"));
      check((await theme())[0] === "dark", "the dark choice is not kept");
      await click("#theme");
      check((await theme())[0] === "light", "the theme button does not switch back to light");
      await page.emulateMedia({ colorScheme: "light" });
    }

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

    // The deep dive runs only on request.
    check(!(await page.$(".frontier-table")) && !(await page.$(".comparison")), "the deep dive ran before it was asked for");
    await click(".deep-dive .button-secondary");
    // Focus on a product bar survives the renders of the analysis replies.
    await page.evaluate(() => document.querySelector('.bar-row[data-product="0"]').focus());
    // The comparison and the trade-off of the selected size, then the columns with what each product adds.
    await wait(() => document.querySelector(".frontier-table") && !document.querySelector(".hint.live"));
    const comparison = await page.$$eval(".comparison p", (c) => c.map((x) => x.textContent));
    check(comparison.length === 2 && comparison[0] === "The 3 most popular products reach 81 (67.5%), 6 fewer." &&
          comparison[1] === "Greedy, which adds the best product one at a time, reaches as many.", `comparison: ${comparison}`);
    check(await page.evaluate(() => document.activeElement?.getAttribute("data-product")) === "0",
          "a solver reply moved the focus from the product bar");
    const frontierTop = await page.$eval(".frontier-table tbody tr td", (e) => e.textContent);
    check(frontierTop === "87 (72.5%)", `first frontier point: ${frontierTop}`);
    // Penetration only breaks ties: no table, stat, or chart shows it. The trade-off marks all respondents.
    const shown = await page.evaluate(() => [...document.querySelectorAll("#results th, #results .stat dt")].map((e) => e.textContent));
    check(!shown.some((t) => /penetration|^Time$/i.test(t)), `penetration or time is shown: ${shown}`);
    const all = await page.$eval(".frontier .ceiling-label", (e) => e.textContent);
    check(all === "All 120 respondents", `respondents line: ${all}`);
    await click('.segmented [data-value="columns"]');
    check(await page.$$eval(".columns .column", (c) => c.length) === 8, "the columns chart does not have 8 columns");
    const parts = await page.$$eval(".contrib tbody tr", (rows) => rows.map((r) => r.lastElementChild.textContent));
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

    // Fixed products: two checked products are in every portfolio, and the sizes start at 2.
    const fixedNames = await page.$$eval("#fixed-list .fixed-name", (n) => [6, 8].map((j) => n[j].textContent));
    await click('#fixed-list input[value="6"]');
    await click('#fixed-list input[value="8"]');
    await wait(() => /the fixed ones included/.test(document.getElementById("size-hint").textContent));
    check(await page.$eval("#size-from", (e) => e.value) === "2", "with 2 fixed products the sizes do not start at 2");
    await click("#run");
    await idle();
    const fixedRows = await page.$$eval(".size-table tbody tr[tabindex] .products", (c) => c.map((x) => x.textContent));
    check(fixedRows.length > 1 && fixedRows.every((t) => fixedNames.every((n) => t.includes(`${n} (fixed)`))),
          `rows without the fixed products: ${fixedRows}`);
    await click(".deep-dive .button-secondary");
    await wait(() => document.querySelector(".frontier-table") && !document.querySelector(".hint.live"));
    const frontierRows = await page.$$eval(".frontier-table tbody .products", (c) => c.map((x) => x.textContent));
    check(frontierRows.every((t) => fixedNames.every((n) => t.includes(n))), `frontier without the fixed products: ${frontierRows}`);
    await click('.segmented [data-value="columns"]');
    const firstParts = await page.$$eval(".contrib tbody tr th", (r) => r.slice(0, 2).map((x) => x.textContent));
    check(firstParts.every((t) => t.includes("(fixed)")), `contributions do not start with the fixed products: ${firstParts}`);
    await click('.segmented [data-value="line"]');

    // The fixed-product list sorts by reach, high to low and then low to high, and by name.
    const listed = () => page.$$eval("#fixed-list .fixed-item", (items) => items.map((i) => ({
      name: i.querySelector(".fixed-name").textContent, reach: parseFloat(i.querySelector(".fixed-reach").textContent),
    })));
    await click('.fixed-sort[data-sort="reach"]');
    const high = await listed();
    check(JSON.stringify(high.map((i) => i.reach)) === JSON.stringify(high.map((i) => i.reach).sort((a, b) => b - a)),
          `not sorted by reach, high to low: ${high.map((i) => i.reach)}`);
    check(high.length > 1 && high[0].reach > high.at(-1).reach, "the example has products of equal reach only");
    await click('.fixed-sort[data-sort="reach"]');
    const low = await listed();
    check(low[0].reach === Math.min(...low.map((i) => i.reach)), "a second click does not reverse the order");
    await click('.fixed-sort[data-sort="name"]');
    const names = (await listed()).map((i) => i.name);
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    check(JSON.stringify(names) === JSON.stringify([...names].sort(collator.compare)), `not sorted by name: ${names}`);
    check(JSON.stringify(high.map((i) => i.name).sort()) === JSON.stringify([...names].sort()),
          "sorting changed the set of products");
    check(await page.$$eval("#fixed-list input:checked", (b) => b.map((x) => x.value).sort().join()) === "6,8",
          "sorting changed the fixed products");

    // Cancel during the large example keeps the finished sizes; a new run works.
    await clickExample("Cafe");
    await wait(() => /every respondent/.test(document.getElementById("size-hint").textContent));
    // Another data set clears the fixed products.
    check(await page.$$eval("#fixed-list input:checked", (b) => b.length) === 0 &&
          await page.$eval("#size-from", (e) => e.value) === "1", "the fixed products survive a new data set");
    await click("#run");
    await wait(() => document.querySelectorAll(".size-table tbody tr[tabindex]").length >= 2);
    // A fixed-product change during a run leaves the run going; it keeps its own settings.
    await click('#fixed-list input[value="0"]');
    check(await page.$eval("#run", (e) => e.textContent) === "Cancel", "a fixed-product change stopped the run");
    await click("#run");
    await idle();
    await click("#fixed-clear");
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
    // A threshold change unfixes a product that then reaches no one, and says so.
    await click('#fixed-list input[value="1"]');
    await wait(() => /1 fixed/.test(document.getElementById("fixed-hint").textContent));
    await page.evaluate(() => {
      const i = document.getElementById("threshold-input");
      i.value = "5";
      i.dispatchEvent(new Event("change"));
    });
    await wait(() => /B reaches no respondent at this threshold, so it is no longer fixed/
      .test(document.getElementById("fixed-hint").textContent));
    const boxB = await page.$eval('#fixed-list input[value="1"]', (e) => [e.checked, e.disabled]);
    check(!boxB[0] && boxB[1], `product B after the threshold change: ${boxB}`);
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
