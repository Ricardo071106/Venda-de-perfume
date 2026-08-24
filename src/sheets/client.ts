import { google } from "googleapis";
import { config } from "../config.js";

function credenciaisGoogle(): { credentials: object } | { keyFile: string } {
  if (config.google.serviceAccountJsonBase64) {
    const json = Buffer.from(config.google.serviceAccountJsonBase64, "base64").toString("utf-8");
    return { credentials: JSON.parse(json) };
  }
  if (config.google.serviceAccountJsonPath) {
    return { keyFile: config.google.serviceAccountJsonPath };
  }
  throw new Error(
    "Configure GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 (produção) ou GOOGLE_SERVICE_ACCOUNT_JSON_PATH (local)."
  );
}

const auth = new google.auth.GoogleAuth({
  ...credenciaisGoogle(),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

export const sheets = google.sheets({ version: "v4", auth });
export const SPREADSHEET_ID = config.google.spreadsheetId;

export async function readRange(range: string): Promise<string[][]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });
  return (res.data.values as string[][]) ?? [];
}

/** Adiciona uma linha ao final da tabela. Retorna o número da linha (1-indexado)
 * onde ela caiu, ou null se a API não informar (não deveria acontecer). */
export async function appendRow(range: string, row: unknown[]): Promise<number | null> {
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
  const updatedRange = res.data.updates?.updatedRange ?? "";
  const match = updatedRange.match(/!\D*(\d+)/);
  return match ? Number(match[1]) : null;
}

export async function updateCell(a1Cell: string, value: unknown): Promise<void> {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: a1Cell,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[value]] },
  });
}

/** Mesma coisa que várias chamadas de updateCell, só que numa única requisição à API. */
export async function updateCells(updates: { range: string; value: unknown }[]): Promise<void> {
  if (!updates.length) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: updates.map((u) => ({ range: u.range, values: [[u.value]] })),
    },
  });
}

/** Limpa o conteúdo de um intervalo (ex: uma linha inteira) sem deslocar as linhas
 * abaixo — usado ao remover um perfume, pra não invalidar o sheet_row de outros. */
export async function clearRange(range: string): Promise<void> {
  await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range });
}
