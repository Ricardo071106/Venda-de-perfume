import { query } from "../db.js";
import { registrarVendaNaPlanilha } from "../sheets/write-to-sheet.js";
import { registrarSaidaEstoque } from "./estoque.js";
import { notificarVendaCompleta } from "./notificacaoFinanceiro.js";
import type { ComandoVenda } from "../whatsapp/commands.js";

interface PerfumePorMensagem {
  id: number;
  nome: string;
  estoque_ml: number;
  preco_ml: number;
  estoque_inicial_leilao: number | null;
  foto_url: string | null;
  postado_em: string | null;
  apc_disponivel: boolean;
  apc_preco: number | null;
  ml_frasco: number;
  apc_ml_minimo: number | null;
}

export async function buscarPerfumePorMensagemRespondida(
  quotedMessageId: string
): Promise<PerfumePorMensagem | null> {
  const rows = await query<PerfumePorMensagem>(
    `SELECT p.id, p.nome, p.estoque_ml, p.preco_ml, p.estoque_inicial_leilao,
            p.foto_url, p.postado_em, p.apc_disponivel, p.apc_preco, p.ml_frasco, p.apc_ml_minimo
     FROM posts_grupo pg
     JOIN perfumes p ON p.id = pg.perfume_id
     WHERE pg.whatsapp_message_id = $1
     LIMIT 1`,
    [quotedMessageId]
  );
  return rows[0] ?? null;
}

/** Acha (por nome) ou cria um cliente. Se telefone for informado e o cliente
 * já existir sem telefone salvo, atualiza — útil pra quem compra pelo grupo
 * (a gente só sabe o telefone, o nome vem do perfil do WhatsApp). */
export async function getOrCreateCliente(nome: string, telefone?: string): Promise<number | null> {
  if (!nome?.trim()) return null;
  const existing = await query<{ id: number; telefone: string | null }>(
    "SELECT id, telefone FROM clientes WHERE lower(nome) = lower($1) LIMIT 1",
    [nome.trim()]
  );
  if (existing.length > 0) {
    if (telefone && !existing[0].telefone) {
      await query("UPDATE clientes SET telefone = $1 WHERE id = $2", [telefone, existing[0].id]);
    }
    return existing[0].id;
  }
  const inserted = await query<{ id: number }>(
    "INSERT INTO clientes (nome, telefone) VALUES ($1, $2) RETURNING id",
    [nome.trim(), telefone ?? null]
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

  const estoqueAntes = Number(perfume.estoque_ml);
  const { estoqueMl: estoqueDepois } = await registrarSaidaEstoque(perfume.id, comando.mlVendido, "venda via whatsapp");
  if (estoqueAntes > 0 && estoqueDepois <= 0) {
    await notificarVendaCompleta(perfume.id);
  }

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

  const estoqueAntes = Number(perfume.estoque_ml);
  const { estoqueMl, status } = await registrarSaidaEstoque(perfume.id, params.mlVendido, "venda via painel");
  if (estoqueAntes > 0 && estoqueMl <= 0) {
    await notificarVendaCompleta(perfume.id);
  }

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
