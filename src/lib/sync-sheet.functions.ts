import { createServerFn } from "@tanstack/react-start";
import Papa from "papaparse";

const FOLDER_ID = "1yFGbzV1fv94dODsmdy08rowAdC2NdFEl";
const SHEET_NAME = "ControlLarvario - Datos Unicos";
const TAB_NAME = "Datos";
const DRIVE_GW = "https://connector-gateway.lovable.dev/google_drive/drive/v3";
const SHEETS_GW = "https://connector-gateway.lovable.dev/google_sheets/v4";

function authHeaders(connectorKey: string) {
  return {
    Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`,
    "X-Connection-Api-Key": connectorKey,
  };
}

async function driveFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${DRIVE_GW}${path}`, {
    ...init,
    headers: {
      ...authHeaders(process.env.GOOGLE_DRIVE_API_KEY!),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive ${res.status}: ${body}`);
  }
  return res.json();
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

async function findOrCreateSheet(): Promise<string> {
  const q = encodeURIComponent(
    `name='${SHEET_NAME}' and '${FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
  );
  const search = await driveFetch(
    `/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  );
  if (search.files?.length) return search.files[0].id;

  // Create spreadsheet in the target folder using Drive (so it lands in the folder directly)
  const created = await driveFetch(`/files?supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: SHEET_NAME,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [FOLDER_ID],
    }),
  });
  const spreadsheetId = created.id as string;

  // Rename the default first sheet to TAB_NAME
  const meta = await sheetsFetch(`/spreadsheets/${spreadsheetId}`);
  const firstSheetId = meta.sheets?.[0]?.properties?.sheetId;
  if (firstSheetId !== undefined) {
    await sheetsFetch(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId: firstSheetId, title: TAB_NAME },
              fields: "title",
            },
          },
        ],
      }),
    });
  }
  return spreadsheetId;
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
  const [headers, ...rows] = all;
  return { headers, rows };
}

export const syncFilesToSheet = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { files: { name: string; content: string }[] }) => input,
  )
  .handler(async ({ data }) => {
    const spreadsheetId = await findOrCreateSheet();

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
    const existingData = hasHeader ? existingValues.slice(1) : [];

    const seen = new Set<string>();
    const norm = (r: string[]) => r.map((c) => (c ?? "").toString().trim()).join("\u0001");
    for (const r of existingData) seen.add(norm(r));

    const uniqueNew: string[][] = [];
    for (const r of incomingRows) {
      const key = norm(r);
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