import type { UserDocumentFile } from "@/types";
import * as pdfjs from "pdfjs-dist";

interface TextLine {
  tag?: string;
  posX: number;
  scaleX: number;
  strings: string[];
}

export async function extractPDF(source: UserDocumentFile): Promise<string[]> {
  const task = pdfjs.getDocument(new Uint8Array(source.content));
  const pdf = await task.promise;

  let pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const textLines: Record<number, TextLine> = {};

    let minX = Infinity;

    for (const text of textContent.items) {
      if ("str" in text) {
        const [scaleX, _, __, ___, posX, posY] = text.transform;

        if (posX < minX) {
          minX = posX;
        }

        textLines[posY] ??= { strings: [], posX, scaleX };
        textLines[posY].strings.push(text.str);
      }
    }

    const yValues = Object.keys(textLines)
      .map((y) => Number(y))
      .sort((a, b) => b - a);
    let stringified = "";

    for (const y of yValues) {
      const line = textLines[y];
      const spaces = Math.max(Math.min(Math.floor((line.posX - minX) / line.scaleX), 64), 0);
      const content = " ".repeat(spaces) + line.strings.join("");

      stringified += content + "\n";
    }

    pages.push(stringified);
  }

  return pages;
}
