import { query } from "../db.js";
import { registrarVendaNaPlanilha } from "../sheets/write-to-sheet.js";
import { registrarSaidaEstoque } from "./estoque.js";
import type { ComandoVenda } from "../whatsapp/commands.js";

interface PerfumePorMensagem {
  id: number;
  nome: string;
  estoque_ml: number;
}

export async function buscarPerfumePorMensagemRespondida(
  quotedMessageId: string
): Promise<PerfumePorMensagem | null> {
  const rows = await query<PerfumePorMensagem>(
    `SELECT p.id, p.nome, p.estoque_ml
     FROM posts_grupo pg
     JOIN perfumes p ON p.id = pg.perfume_id
     WHERE pg.whatsapp_message_id = $1
     LIMIT 1`,
    [quotedMessageId]
  );
  return rows[0] ?? null;
}

async function getOrCreateCliente(nome: string): Promise<number | null> {
  if (!nome?.trim()) return null;
  const existing = await query<{ id: number }>(
    "SELECT id FROM clientes WHERE lower(nome) = lower($1) LIMIT 1",
    [nome.trim()]
  );
  if (existing.length > 0) return existing[0].id;
  const inserted = await query<{ id: number }>(
    "INSERT INTO clientes (nome) VALUES ($1) RETURNING id",
    [nome.trim()]
  );
  return inserted[0].id;
}

/** Registra uma venda capturada via comando no WhatsApp: grava no banco e ecoa na planilha. */
export async function registrarVendaWhatsApp(
  perfume: PerfumePorMensagem,
  comando: ComandoVenda
): Promise<void> {
  const clienteId = await getOrCreateCliente(comando.clienteNome);

  const inserted = await query<{ id: number }>(
    `INSERT INTO vendas (perfume_id, cliente_id, ml_vendido, valor_total, origem)
     VALUES ($1, $2, $3, $4, 'whatsapp_bot') RETURNING id`,
    [perfume.id, clienteId, comando.mlVendido, comando.valorTotal]
  );

  await registrarSaidaEstoque(perfume.id, comando.mlVendido, "venda via whatsapp");

  await registrarVendaNaPlanilha({
    vendaId: inserted[0].id,
    perfumeNome: perfume.nome,
    clienteNome: comando.clienteNome,
    mlVendido: comando.mlVendido,
    valorTotal: comando.valorTotal,
    data: new Date(),
    origem: "whatsapp_bot",
  });
}

export interface VendaPainelResultado {
  vendaId: number;
  valorTotal: number;
  estoqueMl: number;
  status: string;
}

/** Registra uma venda lançada pelo painel administrativo: você só informa quanto foi
 * vendido (e opcionalmente pra quem) — o valor é calculado a partir do preço/ml cadastrado. */
export async function registrarVendaPainel(params: {
  perfumeId: number;
  mlVendido: number;
  clienteNome?: string;
}): Promise<VendaPainelResultado> {
  if (!Number.isFinite(params.mlVendido) || params.mlVendido <= 0) {
    throw new Error("Informe uma quantidade de ml maior que zero.");
  }

  const perfumeRows = await query<{ id: number; nome: string; preco_ml: number; estoque_ml: number }>(
    "SELECT id, nome, preco_ml, estoque_ml FROM perfumes WHERE id = $1",
    [params.perfumeId]
  );
  const perfume = perfumeRows[0];
  if (!perfume) throw new Error("Perfume não encontrado.");
  if (params.mlVendido > Number(perfume.estoque_ml)) {
    throw new Error(`Estoque insuficiente: só há ${perfume.estoque_ml}ml disponíveis.`);
  }

  const valorTotal = Math.round(params.mlVendido * Number(perfume.preco_ml) * 100) / 100;
  const clienteId = await getOrCreateCliente(params.clienteNome ?? "");

  const inserted = await query<{ id: number }>(
    `INSERT INTO vendas (perfume_id, cliente_id, ml_vendido, valor_total, origem)
     VALUES ($1, $2, $3, $4, 'painel_web') RETURNING id`,
    [perfume.id, clienteId, params.mlVendido, valorTotal]
  );

  const { estoqueMl, status } = await registrarSaidaEstoque(perfume.id, params.mlVendido, "venda via painel");

  await registrarVendaNaPlanilha({
    vendaId: inserted[0].id,
    perfumeNome: perfume.nome,
    clienteNome: params.clienteNome ?? "",
    mlVendido: params.mlVendido,
    valorTotal,
    data: new Date(),
    origem: "painel_web",
  });

  return { vendaId: inserted[0].id, valorTotal, estoqueMl, status };
}
