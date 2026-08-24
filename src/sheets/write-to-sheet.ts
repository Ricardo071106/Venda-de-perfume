import { appendRow, updateCell } from "./client.js";

export async function marcarPerfumePostado(sheetRow: number): Promise<void> {
  await updateCell(`Perfumes!M${sheetRow}`, "TRUE");
}

export async function registrarVendaNaPlanilha(params: {
  vendaId: number;
  perfumeNome: string;
  clienteNome: string;
  mlVendido: number;
  valorTotal: number;
  data: Date;
  origem: "whatsapp_bot" | "painel_web";
}): Promise<void> {
  const { vendaId, perfumeNome, clienteNome, mlVendido, valorTotal, data, origem } = params;
  await appendRow("Vendas!A2:I", [
    vendaId,
    perfumeNome,
    clienteNome,
    "", // telefone: não capturado nem via WhatsApp nem via painel neste MVP
    mlVendido,
    valorTotal,
    "", // forma_pagamento: pai pode preencher manualmente depois
    data.toISOString(),
    origem,
  ]);
}
