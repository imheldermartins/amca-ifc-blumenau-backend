/** Isolated browser session for the authorized fixture account; no credentials persisted. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer';
import { unzipSync } from 'fflate';
import jwt from '../../dist/services/auth/jwt-service.js';
const directory = resolve('artifacts/pdf-example-helder');
const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
if (manifest.recipient !== 'eusouhelder123@gmail.com') throw new Error('Conta diferente da autorizada');
const token = jwt.signAccessToken({ sub: manifest.userId });
const browser = await puppeteer.launch({ headless: true });
let activePage;
try {
  const page = await browser.newPage();
  await writeFile(resolve(directory, 'browser-check.json'), JSON.stringify({ status: 'running' }));
  activePage = page;
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1500, height: 1100 });
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/auth/refresh')) {
      void request.respond({ status: request.method() === 'OPTIONS' ? 204 : 200, contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': 'http://localhost:5173', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Content-Type, X-Cubs-Client, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' },
        body: request.method() === 'OPTIONS' ? '' : JSON.stringify({ accessToken: token }) });
    } else void request.continue();
  });
  await page.goto(`http://localhost:5173/pt-br/page/${manifest.pages.report}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /Portal Cub[’']s/.test(document.body.innerText), { timeout: 30_000 });
  await page.screenshot({ path: resolve(directory, 'browser-table-relation.png'), fullPage: true });
  const tabs = await page.$$eval('[role="tab"]', (elements) => elements.map((element) => ({ text: element.textContent, label: element.getAttribute('aria-label') })));
  console.log(JSON.stringify({ tabs }));
  await page.evaluate(() => { const button = [...document.querySelectorAll('button')].find((element) => element.textContent?.includes('Editor de blocos')); if (!button) throw new Error('Aba Documento ausente'); button.click(); });
  await page.waitForSelector('[data-recursive-block]');
  if (await page.$eval('#page-content-document', (element) => [...element.querySelectorAll('button')].some((button) => button.textContent?.includes('Gerar PDF')))) throw new Error('PDF ainda aparece dentro do editor');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-mention-id="recursive:child:title"]')].some((element) => element.textContent === 'Título da página do PDF'));
  await page.screenshot({ path: resolve(directory, 'browser-recursive-editor.png'), fullPage: true });
  await page.click('#page-content-tab-files');
  await page.waitForSelector('[role="checkbox"][aria-label="Selecionar linha"]');
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[role="row"]')];
    const row = rows.find((element) => [...element.querySelectorAll('input')].some((input) => input.value === 'Entrega · Portal institucional'));
    const select = row?.querySelector('[role="checkbox"][aria-label="Selecionar linha"]');
    if (!select) throw new Error('Seleção da entrega na Table ausente');
    select.click();
  });
  await page.click('button[aria-label^="Abrir colaboradores da página"]');
  await page.waitForSelector('[role="dialog"]');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some((element) => element.textContent?.includes('Gerar PDF')));
  if (await page.evaluate(() => [...document.querySelectorAll('button')].some((element) => element.textContent?.trim() === 'Gerar PDF em Lote'))) throw new Error('Lote disponível com somente uma linha selecionada');
  if (await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].some((element) => element.textContent?.trim() === 'Gerar PDF da página selecionada'))) throw new Error('Exportação da seleção dentro da modal de usuários');
  await page.screenshot({ path: resolve(directory, 'browser-user-menu-pdf.png'), fullPage: true });
  await page.click('[role="dialog"] button[aria-label="Fechar"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((element) => element.textContent?.trim() === 'Gerar PDF da página selecionada'));
  const selectedResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/pdf') && response.request().method() === 'POST');
  await page.evaluate(() => {
    const action = [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === 'Gerar PDF da página selecionada');
    if (!action?.previousElementSibling?.textContent?.includes('Filtros')) throw new Error('PDF da seleção não está ao lado dos filtros');
    action.click();
  });
  await page.waitForSelector('[data-pdf-filename]');
  if (await page.$('[role="dialog"] [role="checkbox"], [role="dialog"] input[type="checkbox"], [role="dialog"] input[type="search"]')) throw new Error('Seletor redundante de páginas na prévia');
  await page.screenshot({ path: resolve(directory, 'browser-pdf-table-selection.png'), fullPage: true });
  const selectedRequest = await selectedResponse;
  const selectedBody = JSON.parse(selectedRequest.request().postData());
  if (!selectedRequest.ok() || JSON.stringify(selectedBody.childIds) !== JSON.stringify([manifest.pages['delivery-portal']])) throw new Error('IDs selecionados na Table não foram usados na geração');
  await page.waitForSelector('canvas[data-pdf-page-rendered="1"]', { timeout: 60_000 });
  const paintedPixels = await page.$eval('canvas[data-pdf-page-rendered="1"]', (canvas) => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 180 && pixels[i + 1] < 180 && pixels[i + 2] < 180) painted++;
    return painted;
  });
  if (paintedPixels < 1000) throw new Error('Prévia do PDF sem conteúdo desenhado');
  await page.$eval('[data-pdf-preview]', (element) => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: resolve(directory, 'browser-real-pdf-preview.png'), fullPage: true });
  const withoutTitleResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/pdf') && response.request().method() === 'POST');
  await page.evaluate(() => document.querySelector('[role="switch"][aria-label="Incluir título da página"]')?.click());
  const hidden = await withoutTitleResponse;
  if (!hidden.ok() || JSON.parse(hidden.request().postData()).includePageTitle !== false) throw new Error('Switch de título não chegou à API');
  const { DOMMatrix, ImageData, Path2D } = await import('@napi-rs/canvas');
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes = await hidden.buffer();
  let hiddenPages = 0;
  try {
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    try {
      const document = await task.promise;
      hiddenPages = document.numPages;
      const first = await document.getPage(1);
      const content = await first.getTextContent();
      const firstText = content.items.find((item) => 'str' in item && item.str.trim())?.str;
      if (firstText !== 'Exemplo pronto · PDF com Relation') throw new Error(`Título automático ainda presente: ${firstText}`);
    } finally { await task.destroy(); }
  } finally { bytes.fill(0); }
  await page.waitForSelector(`canvas[data-pdf-page-rendered="${hiddenPages}"]`, { timeout: 60_000 });
  await page.$eval('[data-pdf-preview]', (element) => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: resolve(directory, 'browser-pdf-without-page-title.png'), fullPage: true });
  await page.click('[role="dialog"] button[aria-label="Fechar"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await page.evaluate(() => {
    // Exercise real generation while preventing the test from persisting a download.
    HTMLAnchorElement.prototype.click = function () {};
    const row = [...document.querySelectorAll('[role="row"]')].find((element) => [...element.querySelectorAll('input')].some((input) => input.value === 'Entrega · Integração financeira'));
    const select = row?.querySelector('[role="checkbox"][aria-label="Selecionar linha"]');
    if (!select) throw new Error('Segunda entrega da Table ausente');
    select.click();
  });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((element) => element.textContent?.trim() === 'Gerar PDF em Lote'));
  const zipResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/pdf') && response.request().method() === 'POST');
  await page.evaluate(() => [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === 'Gerar PDF em Lote')?.click());
  const zipped = await zipResponse;
  await page.waitForSelector('[data-pdf-batch-success]');
  if (await page.$('[data-pdf-preview],canvas[data-pdf-page-rendered]')) throw new Error('Prévia indevida no lote');
  if (!await page.$eval('[data-pdf-batch-success]', (element) => /\.zip gerado com sucesso$/.test(element.textContent))) throw new Error('Confirmação do ZIP ausente');
  await page.screenshot({ path: resolve(directory, 'browser-zip-success.png'), fullPage: true });
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((element) => element.textContent?.includes('Baixar ZIP'))?.click());
  const zipIds = JSON.parse(zipped.request().postData()).childIds;
  if (!zipped.ok() || zipIds.length !== 2 || !zipIds.includes(manifest.pages['delivery-portal']) || !zipIds.includes(manifest.pages['delivery-finance'])) throw new Error('Lote não corresponde à seleção da Table');
  const zipBytes = await zipped.buffer();
  try {
    const files = unzipSync(zipBytes);
    try { if (Object.keys(files).length !== 2 || Object.entries(files).some(([name, bytes]) => !name.endsWith('.pdf') || new TextDecoder().decode(bytes.slice(0, 4)) !== '%PDF')) throw new Error('ZIP inválido'); }
    finally { Object.values(files).forEach((bytes) => bytes.fill(0)); }
  } finally { zipBytes.fill(0); }
  await page.click('[role="dialog"] button[aria-label="Fechar"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await page.click('button[aria-label^="Abrir colaboradores da página"]');
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some((element) => element.textContent?.includes('Gerar PDF')));
  const ownResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/pdf') && response.request().method() === 'POST');
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((element) => element.textContent?.includes('Gerar PDF'))?.click());
  const own = await ownResponse;
  if (!own.ok() || new URL(own.url()).pathname !== `/api/v1/pages/${manifest.pages.report}/pdf` || 'childIds' in JSON.parse(own.request().postData())) throw new Error('Seleção antiga reaproveitada no PDF individual');
  await page.waitForSelector('canvas[data-pdf-page-rendered="1"]', { timeout: 60_000 });
  await page.click('[role="dialog"] button[aria-label="Fechar"]');
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  await page.evaluate(() => document.querySelectorAll('[role="checkbox"][aria-label="Selecionar linha"][aria-checked="true"]').forEach((element) => element.click()));
  if (await page.evaluate(() => [...document.querySelectorAll('button')].some((element) => /Gerar PDF (em Lote|da página selecionada)/.test(element.textContent)))) throw new Error('Ação da seleção permaneceu após limpar');
  if (errors.length) throw new Error(`Erros no navegador: ${errors.join('; ')}`);
  await writeFile(resolve(directory, 'browser-check.json'), JSON.stringify({ realApi: true, fixtureAccount: manifest.recipient, tableRelation: true, recursiveEditor: true, friendlyRecursiveTitle: true, pdfFromUserMenu: true, batchBesideFilters: true, tableSelectionVerified: true, duplicateSelectorAbsent: true, zipSelectionVerified: true, clearedSelectionVerified: true, realPdfPreview: true, paintedPixels, titleToggleVerified: true, withoutPageTitlePages: hiddenPages, pageErrors: errors }, null, 2));
  console.log(JSON.stringify({ browserChecksPassed: true, screenshotDirectory: directory }));
} catch (error) {
  if (activePage) {
    await activePage.screenshot({ path: resolve(directory, 'browser-diagnostic.png'), fullPage: true });
    console.log(JSON.stringify({ diagnosticUrl: activePage.url(), body: await activePage.evaluate(() => document.body.innerText.slice(0, 2200)) }));
  }
  throw error;
} finally { await browser.close(); }
