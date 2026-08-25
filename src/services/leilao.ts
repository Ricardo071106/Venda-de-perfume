import { query } from "../db.js";
import { registrarSaidaEstoque, registrarAjusteEstoque } from "./estoque.js";
import { registrarVendaNaPlanilha } from "../sheets/write-to-sheet.js";
import { readRange, clearRange } from "../sheets/client.js";
import { getOrCreateCliente } from "./vendas.js";
import { obterConfiguracoes } from "./configuracoes.js";
import { notificarVendaCompleta } from "./notificacaoFinanceiro.js";

export interface PerfumeParaLance {
  id: number;
  nome: string;
  estoqueMl: number;
  precoMl: number;
  estoqueInicialLeilao: number | null;
  postadoEm: string | null;
  apcDisponivel: boolean;
  apcPreco: number | null; // preço fixo do APC (não é ml x preço/ml) — null = usa o preço/ml normal
  mlFrasco: number; // usado só pra calcular o mínimo do APC com quantidade (50% do vidro)
}

export interface LanceInput {
  perfume: PerfumeParaLance;
  tipo: "quantidade" | "apc";
  quantidadeMl?: number; // obrigatório quando tipo === "quantidade"; opcional em "apc" (ausente = leva tudo que sobrar)
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

function ehMultiploValido(ml: number): boolean {
  return Number.isInteger(ml) && (ml % 3 === 0 || ml % 5 === 0 || ml % 10 === 0);
}

interface Comprador {
  nome: string;
  ml: number;
}

/** Quem já comprou desse perfume nessa rodada de leilão (desde o post mais recente),
 * agregado por pessoa — usado nas mensagens de marco e na de fechamento. */
async function listarCompradores(perfumeId: number, postadoEm: string | null): Promise<Comprador[]> {
  const rows = await query<{ nome: string; total_ml: string }>(
    postadoEm
      ? `SELECT c.nome, SUM(v.ml_vendido) AS total_ml
         FROM vendas v JOIN clientes c ON c.id = v.cliente_id
         WHERE v.perfume_id = $1 AND v.origem = 'whatsapp_bot' AND v.data >= $2
         GROUP BY c.nome ORDER BY MIN(v.data)`
      : `SELECT c.nome, SUM(v.ml_vendido) AS total_ml
         FROM vendas v JOIN clientes c ON c.id = v.cliente_id
         WHERE v.perfume_id = $1 AND v.origem = 'whatsapp_bot'
         GROUP BY c.nome ORDER BY MIN(v.data)`,
    postadoEm ? [perfumeId, postadoEm] : [perfumeId]
  );
  return rows.map((r) => ({ nome: r.nome, ml: Number(r.total_ml) }));
}

function formatarListaCompradores(lista: Comprador[]): string {
  if (!lista.length) return "(ninguém ainda)";
  return lista.map((c) => `• ${c.nome}: *${formatarMl(c.ml)}*`).join("\n");
}

function recusa(compradorJid: string, compradorTelefone: string, texto: string): ResultadoLance {
  return {
    ok: false,
    mentionJid: compradorJid,
    mensagemGrupo: `❌ @${compradorTelefone}, ${texto}`,
    mensagensMarco: [],
  };
}

/** Processa um lance feito por reply no grupo (qualquer participante, não só admin) —
 * quantidade normal (múltiplo de 3/5/10, respeitando o mínimo configurado) ou APC
 * (arremata o frasco físico original + caixa — "APC 50" entrega 50ml dentro do vidro
 * original; "APC" sem número leva tudo que sobrar; preço é o apc_preco fixo cadastrado,
 * ou o preço/ml normal se não tiver um configurado). Se válido: debita, registra a
 * venda (banco é a fonte da verdade, ecoa na planilha), calcula marcos de venda (1/4,
 * 1/3, 1/2, 1/1) com a lista de quem já comprou, e monta a mensagem privada com valor +
 * PIX + pedido de endereço. Se inválido: recusa sem mexer em nada. */
export async function registrarLance(input: LanceInput): Promise<ResultadoLance> {
  const { perfume, compradorJid, compradorTelefone, compradorNome } = input;
  const config = await obterConfiguracoes();

  let quantidadeReal: number;
  let valorTotal: number;
  let motivoEstoque: string;

  if (input.tipo === "apc") {
    if (!perfume.apcDisponivel) {
      return recusa(compradorJid, compradorTelefone, `*${perfume.nome}* não tem opção de APC (frasco + caixa) disponível.`);
    }
    if (perfume.estoqueMl <= 0) {
      return recusa(compradorJid, compradorTelefone, `*${perfume.nome}* já esgotou, não dá mais pra arrematar o APC.`);
    }
    if (input.quantidadeMl !== undefined) {
      // "APC 50" — quantidade específica pra entregar no frasco físico + caixa.
      // Mínimo de 50% do vidro: abaixo disso não compensa abrir mão do frasco original.
      const minimoApc = perfume.mlFrasco * 0.5;
      if (input.quantidadeMl < minimoApc) {
        return recusa(compradorJid, compradorTelefone, `o mínimo pro APC é *${formatarMl(minimoApc)}* (50% do vidro de ${formatarMl(perfume.mlFrasco)}) — peça uma quantidade maior, ou *APC* sem número pra levar tudo que sobrar.`);
      }
      if (input.quantidadeMl > perfume.estoqueMl) {
        return recusa(compradorJid, compradorTelefone, `só restam *${formatarMl(perfume.estoqueMl)}* de *${perfume.nome}* — peça um APC com quantidade menor.`);
      }
      quantidadeReal = input.quantidadeMl;
    } else {
      quantidadeReal = perfume.estoqueMl; // "APC" sem número: leva tudo que sobrar
    }
    // Preço fixo configurado no cadastro do perfume tem prioridade; sem ele, cai no
    // preço/ml normal (comportamento de antes de existir esse campo).
    valorTotal = perfume.apcPreco && perfume.apcPreco > 0
      ? perfume.apcPreco
      : Math.round(quantidadeReal * perfume.precoMl * 100) / 100;
    motivoEstoque = "APC (frasco + caixa) via whatsapp";
  } else {
    const quantidadeMl = input.quantidadeMl ?? 0;
    if (quantidadeMl > perfume.estoqueMl) {
      return recusa(compradorJid, compradorTelefone, `só restam *${formatarMl(perfume.estoqueMl)}* de *${perfume.nome}* — peça uma quantidade menor.`);
    }
    if (quantidadeMl < config.mlMinimo) {
      return recusa(compradorJid, compradorTelefone, `o pedido mínimo é de *${formatarMl(config.mlMinimo)}*.`);
    }
    if (!ehMultiploValido(quantidadeMl)) {
      return recusa(compradorJid, compradorTelefone, `só aceitamos pedidos em múltiplos de 3ml, 5ml ou 10ml (ex: 3, 5, 6, 9, 10, 15, 20...).`);
    }
    quantidadeReal = quantidadeMl;
    valorTotal = Math.round(quantidadeMl * perfume.precoMl * 100) / 100;
    motivoEstoque = "lance no leilão via whatsapp";
  }

  const clienteId = await getOrCreateCliente(compradorNome, compradorTelefone);

  const inserted = await query<{ id: number }>(
    `INSERT INTO vendas (perfume_id, cliente_id, ml_vendido, valor_total, origem)
     VALUES ($1, $2, $3, $4, 'whatsapp_bot') RETURNING id`,
    [perfume.id, clienteId, quantidadeReal, valorTotal]
  );

  const estoqueAntes = perfume.estoqueMl;
  const { estoqueMl: estoqueDepois } = await registrarSaidaEstoque(perfume.id, quantidadeReal, motivoEstoque);

  if (estoqueAntes > 0 && estoqueDepois <= 0) {
    await notificarVendaCompleta(perfume.id); // já engole os próprios erros, nunca derruba o lance
  }

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

  await registrarVendaNaPlanilha({
    vendaId: inserted[0].id,
    perfumeNome: perfume.nome,
    clienteNome: compradorNome,
    mlVendido: quantidadeReal,
    valorTotal,
    data: new Date(),
    origem: "whatsapp_bot",
  });

  const compradores = await listarCompradores(perfume.id, perfume.postadoEm);
  const listaTexto = formatarListaCompradores(compradores);

  const vendidoAntes = baseline - estoqueAntes;
  const vendidoDepois = baseline - estoqueDepois;
  const mensagensMarco = MARCOS.filter(
    (m) => vendidoAntes < baseline! * m.fracao && baseline! * m.fracao <= vendidoDepois
  ).map(
    (m) =>
      `🔥 Já vendemos *${m.rotulo}* do estoque de *${perfume.nome}*!\n\n👥 *Quem já pediu:*\n${listaTexto}`
  );

  const mensagemPrivada = [
    input.tipo === "apc"
      ? `Oi! Você arrematou o *APC* (frasco + caixa) de *${perfume.nome}* — *${formatarMl(quantidadeReal)}*.`
      : `Oi! Você comprou *${formatarMl(quantidadeReal)}* de *${perfume.nome}*.`,
    "",
    `🧾 Venda #${inserted[0].id}`,
    `💰 Total: *${formatarMoeda(valorTotal)}*`,
    "",
    "💳 Chave PIX para pagamento:",
    config.pixKey?.trim() ? config.pixKey.trim() : "(chave PIX ainda não configurada — a gente te avisa)",
    "",
    config.textoEndereco,
  ].join("\n");

  const mensagemEsgotado =
    estoqueDepois <= 0
      ? [
          `🏁 *Venda encerrada: ${perfume.nome}!*`,
          "",
          "👥 *Quem comprou:*",
          listaTexto,
          "",
          "Obrigado a todos que compraram 🙏",
        ].join("\n")
      : undefined;

  return {
    ok: true,
    mentionJid: compradorJid,
    mensagemGrupo:
      input.tipo === "apc"
        ? `✅ @${compradorTelefone} arrematou o *APC* de *${perfume.nome}* (${formatarMl(quantidadeReal)}, frasco + caixa)!\n\n*Estoque restante: ${formatarMl(estoqueDepois)}.*`
        : `✅ @${compradorTelefone} comprou *${formatarMl(quantidadeReal)}* de *${perfume.nome}*!\n\n*Estoque restante: ${formatarMl(estoqueDepois)}.*`,
    mensagensMarco,
    mensagemEsgotado,
    mensagemPrivada,
  };
}

export interface ResultadoCancelamento {
  ok: boolean;
  mensagemGrupo: string;
}

/** Cancela TODOS os lances (normais e/ou APC — não faz diferença, os dois só viram
 * uma linha em `vendas` com o ml que foi tirado do estoque) que esse telefone fez
 * nesse perfume, na rodada atual (desde o post mais recente). Some tudo e devolve
 * ao estoque de uma vez — registrado como ajuste (dispara republicação automática
 * se o perfume tinha esgotado e volta a ter estoque). Apaga as vendas do banco e da
 * planilha, como se nunca tivessem acontecido. */
export async function cancelarLances(params: {
  perfumeId: number;
  perfumeNome: string;
  postadoEm: string | null;
  compradorTelefone: string;
}): Promise<ResultadoCancelamento> {
  const { perfumeId, perfumeNome, postadoEm, compradorTelefone } = params;

  const clientes = await query<{ id: number }>(
    "SELECT id FROM clientes WHERE telefone = $1",
    [compradorTelefone]
  );
  if (clientes.length === 0) {
    return {
      ok: false,
      mensagemGrupo: `❌ @${compradorTelefone}, você não tem nenhum lance registrado em *${perfumeNome}* pra cancelar.`,
    };
  }
  const clienteIds = clientes.map((c) => c.id);

  const vendas = await query<{ id: number; ml_vendido: string }>(
    postadoEm
      ? `SELECT id, ml_vendido FROM vendas
         WHERE perfume_id = $1 AND origem = 'whatsapp_bot' AND cliente_id = ANY($2) AND data >= $3`
      : `SELECT id, ml_vendido FROM vendas
         WHERE perfume_id = $1 AND origem = 'whatsapp_bot' AND cliente_id = ANY($2)`,
    postadoEm ? [perfumeId, clienteIds, postadoEm] : [perfumeId, clienteIds]
  );

  if (vendas.length === 0) {
    return {
      ok: false,
      mensagemGrupo: `❌ @${compradorTelefone}, você não tem nenhum lance registrado em *${perfumeNome}* pra cancelar.`,
    };
  }

  const totalMl = vendas.reduce((acc, v) => acc + Number(v.ml_vendido), 0);
  const idsVendas = vendas.map((v) => v.id);

  await query("DELETE FROM vendas WHERE id = ANY($1)", [idsVendas]);
  const resultado = await registrarAjusteEstoque(perfumeId, totalMl, "cancelamento de lance via whatsapp");

  // Limpa as linhas correspondentes na aba Vendas (elas tinham o id da venda na
  // coluna A) — como se a venda nunca tivesse sido lançada.
  const vendasRows = await readRange("Vendas!A2:I");
  for (let i = 0; i < vendasRows.length; i++) {
    if (idsVendas.includes(Number(vendasRows[i][0]))) {
      await clearRange(`Vendas!A${i + 2}:I${i + 2}`);
    }
  }

  return {
    ok: true,
    mensagemGrupo: `❌ @${compradorTelefone} cancelou *${formatarMl(totalMl)}* de *${perfumeNome}*.\n\n*Estoque agora: ${formatarMl(resultado.estoqueMl)}.*`,
  };
}
