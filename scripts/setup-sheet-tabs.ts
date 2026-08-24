// Cria (se ainda não existirem) as 4 abas esperadas pela planilha, com o
// cabeçalho já preenchido na linha 1. Rodar com: npm run setup-sheets
import "dotenv/config";
import { sheets, SPREADSHEET_ID } from "../src/sheets/client.js";

const ABAS: Record<string, string[]> = {
  Perfumes: [
    "id", "nome", "marca", "composição", "foto_url", "ml_frasco",
    "preço_ml", "custo_ml", "fornecedor", "estoque_ml", "status",
    "postar_no_grupo", "postado", "repor_ml", "fragrantica_url",
  ],
  Vendas: [
    "id", "perfume", "cliente", "telefone", "ml_vendido",
    "valor_total", "forma_pagamento", "data", "origem",
  ],
  Fornecedores: ["nome", "contato", "observações"],
  Financeiro: ["(fórmulas manuais — o bot não escreve aqui)"],
};

async function main() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existentes = new Set(
    (meta.data.sheets ?? []).map((s) => s.properties?.title).filter(Boolean)
  );

  const faltando = Object.keys(ABAS).filter((nome) => !existentes.has(nome));

  if (faltando.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: faltando.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
    console.log(`Abas criadas: ${faltando.join(", ")}`);
  } else {
    console.log("Todas as abas já existiam.");
  }

  for (const [nome, cabecalho] of Object.entries(ABAS)) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${nome}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [cabecalho] },
    });
  }
  console.log("Cabeçalhos escritos na linha 1 de cada aba.");
}

main().catch((err) => {
  console.error("Falha ao configurar as abas:", err);
  process.exit(1);
});
