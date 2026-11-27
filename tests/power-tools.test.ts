import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  killDevPortProcess,
  mergeLocalPdfs,
  splitLocalPdf,
} from "../src/modules/ledge-system/power-tools.js";

async function makeDummyPdfBase64(pageCount: number): Promise<string> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([200, 200]);
  }
  const bytes = await doc.save();
  return Buffer.from(bytes).toString("base64");
}

describe("Local Power Tools Engine", () => {
  it("merges multiple local PDFs losslessly", async () => {
    const pdfA = await makeDummyPdfBase64(2);
    const pdfB = await makeDummyPdfBase64(3);
    const res = await mergeLocalPdfs([pdfA, pdfB]);
    expect(res.totalPages).toBe(5);
    const loaded = await PDFDocument.load(Buffer.from(res.pdfBase64, "base64"));
    expect(loaded.getPageCount()).toBe(5);
  });

  it("splits selected page ranges from a local PDF", async () => {
    const src = await makeDummyPdfBase64(6);
    const res = await splitLocalPdf(src, "1-2, 5");
    expect(res.originalPages).toBe(6);
    expect(res.extractedPages).toBe(3);
    const loaded = await PDFDocument.load(Buffer.from(res.pdfBase64, "base64"));
    expect(loaded.getPageCount()).toBe(3);
  });

  it("blocks killing protected system PIDs and current process", async () => {
    await expect(killDevPortProcess(0)).rejects.toThrow(/dilindungi/i);
    await expect(killDevPortProcess(4)).rejects.toThrow(/dilindungi/i);
    await expect(killDevPortProcess(process.pid)).rejects.toThrow(/dilindungi/i);
  });
});
