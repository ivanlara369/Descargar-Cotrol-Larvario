import { createServerFn } from "@tanstack/react-start";
import Papa from "papaparse";

const SPREADSHEET_ID = "1Ww-hTLbebsnCehF5mqWgkBstUYZJu8Es5U59shVsqAg";
const TAB_NAME = "Datos";
const SHEETS_GW = "https://connector-gateway.lovable.dev/google_sheets/v4";

function authHeaders(connectorKey: string) {
  return {
    Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": connectorKey,
  };
}

async function sheetsFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${SHEETS_GW}${path}`, {
    ...init,
    headers: {
      ...authHeaders(process.env.GOOGLE_SHEETS_API_KEY!),
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets ${res.status}: ${body}`);
  }
  return res.json();
}

async function ensureTab(spreadsheetId: string) {
  const meta = await sheetsFetch(`/spreadsheets/${spreadsheetId}`);
  const exists = meta.sheets?.some(
    (s: { properties: { title: string } }) => s.properties.title === TAB_NAME,
  );
  if (!exists) {
    await sheetsFetch(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: TAB_NAME } } }],
      }),
    });
  }
}

function parseFile(content: string): { headers: string[]; rows: string[][] } {
  // Skip first 3 metadata lines; line 4 is header. Strip BOM.
  const clean = content.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/);
  const dataText = lines.slice(3).join("\n");
  const parsed = Papa.parse<string[]>(dataText, {
    skipEmptyLines: true,
  });
  const all = parsed.data.filter((r) => Array.isArray(r) && r.length > 1);
  if (all.length === 0) return { headers: [], rows: [] };
  const sanitizeCell = (v: unknown) =>
    (v ?? "")
      .toString()
      // Quita BOM, caracteres de control (excepto tab) y espacios NBSP
      .replace(/\uFEFF/g, "")
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
      .replace(/\u00A0/g, " ")
      .trim();
  const sanitizeRow = (r: string[]) => r.map(sanitizeCell);
  const [headers, ...rows] = all.map(sanitizeRow);
  return { headers, rows };
}

export const syncFilesToSheet = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { files: { name: string; content: string }[] }) => input,
  )
  .handler(async ({ data }) => {
    const spreadsheetId = SPREADSHEET_ID;
    await ensureTab(spreadsheetId);

    // Combine incoming rows
    let combinedHeaders: string[] = [];
    const incomingRows: string[][] = [];
    for (const f of data.files) {
      const { headers, rows } = parseFile(f.content);
      if (headers.length && !combinedHeaders.length) combinedHeaders = headers;
      for (const r of rows) incomingRows.push(r);
    }

    // Read existing sheet values
    const existing = await sheetsFetch(
      `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(TAB_NAME)}!A1:ZZ`,
    );
    const existingValues: string[][] = existing.values || [];
  const hasHeader = existingValues.length > 0;
  const headerRow = hasHeader ? existingValues[0] : combinedHeaders;
  const existingData = hasHeader ? existingValues.slice(1) : [];

    const seen = new Set<string>();
    const norm = (r: string[]) => r.map((c) => (c ?? "").toString().trim()).join("\u0001");
    for (const r of existingData) seen.add(norm(r));
    const headerKey = norm(headerRow || []);

    const uniqueNew: string[][] = [];
    for (const r of incomingRows) {
      const key = norm(r);
      if (key === headerKey) continue; // nunca duplicar encabezado
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueNew.push(r);
    }

    // Write header if missing
    if (!hasHeader && combinedHeaders.length) {
      await sheetsFetch(
        `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(TAB_NAME)}!A1?valueInputOption=RAW`,
        {
          method: "PUT",
          body: JSON.stringify({ values: [combinedHeaders] }),
        },
      );
      // Congelar fila 1 (encabezado fijo) + negrita
      const meta = await sheetsFetch(`/spreadsheets/${spreadsheetId}`);
      const tab = meta.sheets?.find(
        (s: { properties: { title: string; sheetId: number } }) =>
          s.properties.title === TAB_NAME,
      );
      const sheetId = tab?.properties?.sheetId;
      if (sheetId !== undefined) {
        await sheetsFetch(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
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

    // Append unique rows
    if (uniqueNew.length) {
      await sheetsFetch(
        `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(TAB_NAME)}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: "POST",
          body: JSON.stringify({ values: uniqueNew }),
        },
      );
    }

    return {
      spreadsheetId,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      totalIncoming: incomingRows.length,
      inserted: uniqueNew.length,
      duplicates: incomingRows.length - uniqueNew.length,
      existingBefore: existingData.length,
    };
  });