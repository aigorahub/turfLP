// Browser test of the built page, opened as a file as a user opens it: once
// with the solver worker, and once with workers switched off (page mode).
// Needs Chrome: set CHROME_PATH, or install it in the usual place.
//
//   npm run build && npm run test:browser

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const here = dirname(fileURLToPath(import.meta.url));
const file = pathToFileURL(join(here, "..", "dist", "turflp-dashboard.html")).href;
const chrome = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find((p) => p && existsSync(p));
if (!chrome) {
  console.error("Chrome was not found. Set CHROME_PATH.");
  process.exit(1);
}

// Reach at the top-2 box for sizes 1 to 8 of the ice cream data (R package).
const ICECREAM = ["39.2% (47)", "61.7% (74)", "72.5% (87)", "79.2% (95)", "83.3% (100)",
                  "86.7% (104)", "88.3% (106)", "90.0% (108)"];

function check(ok, message) {
  if (!ok) throw new Error(message);
}

async function session(workers) {
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-first-run", ...(process.env.CI ? ["--no-sandbox"] : [])],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    if (!workers) await page.evaluateOnNewDocument(() => { window.Worker = function () { throw new Error("off"); }; });
    await page.goto(file);
    const wait = (fn, arg) => page.waitForFunction(fn, { timeout: 120_000 }, arg);
    const click = (selector) => page.evaluate((s) => document.querySelector(s).click(), selector);
    const clickExample = (title) => page.evaluate((t) =>
      [...document.querySelectorAll(".example")].find((b) => b.textContent.includes(t)).click(), title);
    const idle = () => wait(() => document.getElementById("run").textContent === "Run" &&
                                  !document.getElementById("run").disabled);

    await wait(() => document.getElementById("solver-status").textContent.startsWith("Solver ready"));
    const status = await page.$eval("#solver-status", (e) => e.textContent);
    check(workers === (status === "Solver ready"), `unexpected solver status: ${status}`);

    // An example, all sizes.
    await clickExample("Ice cream");
    await wait(() => /every respondent/.test(document.getElementById("size-hint").textContent));
    check(await page.$eval("#size-to", (e) => e.value) === "8", "default sizes are not 1 to 8");
    await click("#run");
    await wait(() => document.querySelectorAll(".results-table tbody tr[tabindex]").length === 8);
    await idle();
    const reach = await page.$$eval(".results-table tbody tr", (rows) => rows.map((r) => r.children[1].textContent));
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

    // Cancel during the large example keeps the finished sizes; a new run works.
    await clickExample("Cafe");
    await wait(() => /every respondent/.test(document.getElementById("size-hint").textContent));
    await click("#run");
    await wait(() => document.querySelectorAll(".results-table tbody tr[tabindex]").length >= 2);
    await click("#run");
    await idle();
    const cancelled = await page.$$eval(".results-table tbody tr", (rows) => rows.filter((r) => r.textContent.includes("Cancelled")).length);
    check(cancelled > 0, "Cancel did not stop the run");
    await page.evaluate(() => {
      const to = document.getElementById("size-to");
      to.value = "2";
      to.dispatchEvent(new Event("input"));
    });
    await click("#run");
    await wait(() => document.querySelectorAll(".results-table tbody tr[tabindex]").length === 2);
    await idle();

    // A file with an ID column and ratings, then a file with an error.
    const load = (name, text) => page.evaluate((n, t) => {
      const dt = new DataTransfer();
      dt.items.add(new File([t], n, { type: "text/csv" }));
      const input = document.getElementById("file");
      input.files = dt.files;
      input.dispatchEvent(new Event("change"));
    }, name, text);
    await load("ratings.csv", "id;A;B;C\n1;5;1;2\n2;1;4;1\n3;2;2;5\n4;4;1;1\n");
    await wait(() => /every respondent/.test(document.getElementById("size-hint").textContent));
    const info = await page.$eval("#data-info", (e) => e.textContent);
    check(/4 respondents, 3 products, ratings from 1 to 5/.test(info), `file summary: ${info}`);
    check(await page.$eval("#threshold-input", (e) => e.value) === "4", "the threshold is not the top-2 box");
    await click("#run");
    await wait(() => document.querySelectorAll(".results-table tbody tr[tabindex]").length === 3);
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
