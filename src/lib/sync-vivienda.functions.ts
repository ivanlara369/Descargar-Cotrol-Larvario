import { createServerFn } from "@tanstack/react-start";
import Papa from "papaparse";

const SPREADSHEET_ID = "1Iu54czbjVvHzVD9WQGHpkINxwRqz9K9dTwwURXpExVs";
const TAB_NAME = "Datos";
const SHEETS_GW = "https://connector-gateway.lovable.dev/google_sheets/v4";

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": process.env.GOOGLE_SHEETS_API_KEY!,
  };
}

async function sheetsFetch(path: string, init?: RequestInit) {
  const maxAttempts = 5;
  let lastBody = "";
  let lastStatus = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(`${SHEETS_GW}${path}`, {
      ...init,
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    if (res.ok) return res.json();
    lastStatus = res.status;
    lastBody = await res.text();
    if (res.status !== 429 && res.status < 500) break;
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(30_000, 2000 * Math.pow(2, attempt));
    await new Promise((r) => setTimeout(r, waitMs));
  }
  throw new Error(`Sheets ${lastStatus}: ${lastBody}`);
}

function sanitizeCell(v: unknown) {
  return (v ?? "")
    .toString()
    .replace(/\uFEFF/g, "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/\u00A0/g, " ")
    .trim();
}

function parseFile(
  name: string,
  content: string,
): { headers: string[]; rows: string[][] } {
  const clean = content.replace(/^\uFEFF/, "");
  const isTxt = /\.txt$/i.test(name);

  if (isTxt) {
    const parsed = Papa.parse<string[]>(clean, {
      delimiter: "\t",
      skipEmptyLines: true,
    });
    const all = parsed.data.filter((r) => Array.isArray(r) && r.length > 1);
    if (!all.length) return { headers: [], rows: [] };
    const [headers, ...rows] = all.map((r) => r.map(sanitizeCell));
    return { headers, rows };
  }

  const lines = clean.split(/\r?\n/);
  const dataText = lines.slice(3).join("\n");
  const parsed = Papa.parse<string[]>(dataText, { skipEmptyLines: true });
  const all = parsed.data.filter((r) => Array.isArray(r) && r.length > 1);
  if (!all.length) return { headers: [], rows: [] };
  const [headers, ...rows] = all.map((r) => r.map(sanitizeCell));
  return { headers, rows };
}

export const syncViviendaToSheet = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { files: { name: string; content: string }[] }) => input,
  )
  .handler(async ({ data }) => {
    let combinedHeaders: string[] = [];
    const incomingRows: string[][] = [];
    for (const f of data.files) {
      const { headers, rows } = parseFile(f.name, f.content);
      if (headers.length && !combinedHeaders.length) combinedHeaders = headers;
      for (const r of rows) incomingRows.push(r);
    }

    const meta0 = await sheetsFetch(`/spreadsheets/${SPREADSHEET_ID}`);
    const tabExists = meta0.sheets?.some(
      (s: { properties: { title: string } }) => s.properties.title === TAB_NAME,
    );
    if (!tabExists) {
      await sheetsFetch(`/spreadsheets/${SPREADSHEET_ID}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: TAB_NAME } } }],
        }),
      });
    }

    const existing = await sheetsFetch(
      `/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(TAB_NAME)}`,
    );
    const existingValues: string[][] = existing.values || [];
    const hasHeader = existingValues.length > 0;
    const headerRow = hasHeader ? existingValues[0] : combinedHeaders;
    const existingData = hasHeader ? existingValues.slice(1) : [];

    const seen = new Set<string>();
    const norm = (r: string[]) =>
      r.map((c) => (c ?? "").toString().trim()).join("\u0001");
    for (const r of existingData) seen.add(norm(r));
    const headerKey = norm(headerRow || []);

    const uniqueNew: string[][] = [];
    for (const r of incomingRows) {
      const key = norm(r);
      if (key === headerKey) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueNew.push(r);
    }

    if (!hasHeader && combinedHeaders.length) {
      await sheetsFetch(
        `/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(TAB_NAME)}!A1?valueInputOption=RAW`,
        {
          method: "PUT",
          body: JSON.stringify({ values: [combinedHeaders] }),
        },
      );
      const meta = await sheetsFetch(`/spreadsheets/${SPREADSHEET_ID}`);
      const tab = meta.sheets?.find(
        (s: { properties: { title: string; sheetId: number } }) =>
          s.properties.title === TAB_NAME,
      );
      const sheetId = tab?.properties?.sheetId;
      if (sheetId !== undefined) {
        await sheetsFetch(`/spreadsheets/${SPREADSHEET_ID}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({
            requests: [
              {
                updateSheetProperties: {
                  properties: {
                    sheetId,
                    gridProperties: { frozenRowCount: 1 },
                  },
                  fields: "gridProperties.frozenRowCount",
                },
              },
              {
                repeatCell: {
                  range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                  cell: {
                    userEnteredFormat: {
                      textFormat: { bold: true },
                      backgroundColor: { red: 0.93, green: 0.93, blue: 0.93 },
                    },
                  },
                  fields: "userEnteredFormat(textFormat,backgroundColor)",
                },
              },
            ],
          }),
        });
      }
    }

    if (uniqueNew.length) {
      await sheetsFetch(
        `/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(TAB_NAME)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: "POST",
          body: JSON.stringify({ values: uniqueNew }),
        },
      );
    }

    return {
      spreadsheetId: SPREADSHEET_ID,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`,
      totalIncoming: incomingRows.length,
      inserted: uniqueNew.length,
      duplicates: incomingRows.length - uniqueNew.length,
      existingBefore: existingData.length,
    };
  });