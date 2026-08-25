import { query } from "../db.js";
import { registrarSaidaEstoque } from "./estoque.js";
import { registrarVendaNaPlanilha } from "../sheets/write-to-sheet.js";
import { getOrCreateCliente } from "./vendas.js";
import { obterConfiguracoes } from "./configuracoes.js";

export interface PerfumeParaLance {
  id: number;
  nome: string;
  estoqueMl: number;
  precoMl: number;
  estoqueInicialLeilao: number | null;
}

export interface LanceInput {
  perfume: PerfumeParaLance;
  quantidadeMl: number;
  compradorJid: string;
  compradorTelefone: string;
  compradorNome: string;
}

export interface ResultadoLance {
  ok: boolean;
  mentionJid: string;
  mensagemGrupo: string;
  mensagensMarco: string[];
  mensagemEsgotado?: string;
  mensagemPrivada?: string;
}

// Marcos anunciados no grupo conforme o estoque vai sendo vendido, na ordem pedida.
const MARCOS: { fracao: number; rotulo: string }[] = [
  { fracao: 0.25, rotulo: "1/4" },
  { fracao: 1 / 3, rotulo: "1/3" },
  { fracao: 0.5, rotulo: "1/2" },
  { fracao: 1, rotulo: "1/1" },
];

function formatarMl(v: number): string {
  return Number.isInteger(v) ? `${v}ml` : `${v.toFixed(2)}ml`;
}

function formatarMoeda(v: number): string {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

/** Processa um lance feito por reply no grupo (qualquer participante, não só admin).
 * Se couber no estoque: debita, registra a venda (mesma lógica de sempre — banco é a
 * fonte da verdade, ecoa na planilha), calcula quais marcos de venda (1/4, 1/3, 1/2, 1/1)
 * foram cruzados, e monta a mensagem privada com valor a pagar + PIX + pedido de endereço.
 * Se não couber: recusa sem mexer em nada. */
export async function registrarLance(input: LanceInput): Promise<ResultadoLance> {
  const { perfume, quantidadeMl, compradorJid, compradorTelefone, compradorNome } = input;

  if (quantidadeMl > perfume.estoqueMl) {
    return {
      ok: false,
      mentionJid: compradorJid,
      mensagemGrupo: `❌ @${compradorTelefone}, só restam *${formatarMl(perfume.estoqueMl)}* de *${perfume.nome}* — peça uma quantidade menor.`,
      mensagensMarco: [],
    };
  }

  const valorTotal = Math.round(quantidadeMl * perfume.precoMl * 100) / 100;
  const clienteId = await getOrCreateCliente(compradorNome, compradorTelefone);

  const inserted = await query<{ id: number }>(
    `INSERT INTO vendas (perfume_id, cliente_id, ml_vendido, valor_total, origem)
     VALUES ($1, $2, $3, $4, 'whatsapp_bot') RETURNING id`,
    [perfume.id, clienteId, quantidadeMl, valorTotal]
  );

  const estoqueAntes = perfume.estoqueMl;
  const { estoqueMl: estoqueDepois } = await registrarSaidaEstoque(
    perfume.id,
    quantidadeMl,
    "lance no leilão via whatsapp"
  );

  // Baseline do leilão: se ainda não existir (perfume antigo, ou primeiro lance depois
  // de um post novo), usa o estoque de antes desse lance e grava pra próxima vez.
  let baseline = perfume.estoqueInicialLeilao;
  if (baseline === null || baseline <= 0) {
    baseline = estoqueAntes;
    await query(
      "UPDATE perfumes SET estoque_inicial_leilao = $1 WHERE id = $2 AND estoque_inicial_leilao IS NULL",
      [baseline, perfume.id]
    );
  }

  const vendidoAntes = baseline - estoqueAntes;
  const vendidoDepois = baseline - estoqueDepois;
  const mensagensMarco = MARCOS.filter(
    (m) => vendidoAntes < baseline! * m.fracao && baseline! * m.fracao <= vendidoDepois
  ).map((m) => `🔥 Já vendemos *${m.rotulo}* do estoque de *${perfume.nome}*!`);

  await registrarVendaNaPlanilha({
    vendaId: inserted[0].id,
    perfumeNome: perfume.nome,
    clienteNome: compradorNome,
    mlVendido: quantidadeMl,
    valorTotal,
    data: new Date(),
    origem: "whatsapp_bot",
  });

  const config = await obterConfiguracoes();
  const mensagemPrivada = [
    `Oi! Você comprou *${formatarMl(quantidadeMl)}* de *${perfume.nome}*.`,
    "",
    `💰 Total: *${formatarMoeda(valorTotal)}*`,
    "",
    "💳 Chave PIX para pagamento:",
    config.pixKey?.trim() ? config.pixKey.trim() : "(chave PIX ainda não configurada — a gente te avisa)",
    "",
    config.textoEndereco,
  ].join("\n");

  return {
    ok: true,
    mentionJid: compradorJid,
    mensagemGrupo: `✅ @${compradorTelefone} comprou *${formatarMl(quantidadeMl)}* de *${perfume.nome}*!\n\n*Estoque restante: ${formatarMl(estoqueDepois)}.*`,
    mensagensMarco,
    mensagemEsgotado: estoqueDepois <= 0 ? `❌ *${perfume.nome}* esgotado! Obrigado a todos que compraram 🙏` : undefined,
    mensagemPrivada,
  };
}
