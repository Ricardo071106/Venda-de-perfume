import { query } from "../db.js";
import { obterConfiguracoes } from "./configuracoes.js";
import { enviarMensagemPrivada } from "../whatsapp/baileys-client.js";

function formatarMl(v: number): string {
  return Number.isInteger(v) ? `${v}ml` : `${v.toFixed(2)}ml`;
}

function formatarMoeda(v: number): string {
  return `R$ ${v.toFixed(2).replace(".", ",")}`;
}

/** Manda um relatório de vendas pro número do financeiro (configuração
 * telefone_financeiro) sempre que um perfume esgota de verdade por VENDA
 * (qualquer canal — WhatsApp, painel, planilha; não dispara em ajuste de
 * estoque). Escopo do relatório: desde o post mais recente do perfume no
 * grupo (mesma rodada mostrada na mensagem de fechamento), ou todo o
 * histórico se ele nunca foi postado. Falha silenciosamente em log — nunca
 * deve travar o fluxo de venda que já foi concluído com sucesso. */
export async function notificarVendaCompleta(perfumeId: number): Promise<void> {
  try {
    const [perfume] = await query<{
      nome: string;
      preco_ml: number;
      custo_ml: number | null;
      postado_em: string | null;
    }>("SELECT nome, preco_ml, custo_ml, postado_em FROM perfumes WHERE id = $1", [perfumeId]);
    if (!perfume) return;

    const compradores = await query<{ nome: string; ml: string; valor: string }>(
      perfume.postado_em
        ? `SELECT COALESCE(c.nome, '(sem nome)') AS nome, SUM(v.ml_vendido) AS ml, SUM(v.valor_total) AS valor
           FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id
           WHERE v.perfume_id = $1 AND v.data >= $2
           GROUP BY c.nome ORDER BY MIN(v.data)`
        : `SELECT COALESCE(c.nome, '(sem nome)') AS nome, SUM(v.ml_vendido) AS ml, SUM(v.valor_total) AS valor
           FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id
           WHERE v.perfume_id = $1
           GROUP BY c.nome ORDER BY MIN(v.data)`,
      perfume.postado_em ? [perfumeId, perfume.postado_em] : [perfumeId]
    );

    const lista = compradores.map((c) => ({
      nome: c.nome,
      ml: Number(c.ml),
      valor: Number(c.valor),
    }));

    const mlTotal = lista.reduce((acc, c) => acc + c.ml, 0);
    const receitaTotal = lista.reduce((acc, c) => acc + c.valor, 0);
    const custoMl = perfume.custo_ml !== null ? Number(perfume.custo_ml) : null;
    const custoTotal = custoMl !== null ? mlTotal * custoMl : null;
    const lucroTotal = custoTotal !== null ? receitaTotal - custoTotal : null;

    const linhas = [
      `📊 *Relatório — perfume esgotado*`,
      "",
      `*${perfume.nome}*`,
      "",
      `📦 Total vendido: *${formatarMl(mlTotal)}*`,
      `💰 Receita total: *${formatarMoeda(receitaTotal)}*`,
      custoTotal !== null ? `💵 Custo total: *${formatarMoeda(custoTotal)}*` : null,
      lucroTotal !== null ? `📈 Lucro: *${formatarMoeda(lucroTotal)}*` : null,
      "",
      "👥 *Compradores:*",
      lista.length
        ? lista.map((c) => `• ${c.nome}: ${formatarMl(c.ml)} — ${formatarMoeda(c.valor)}`).join("\n")
        : "(nenhuma venda registrada nessa rodada)",
    ].filter((l) => l !== null) as string[];

    const config = await obterConfiguracoes();
    const telefone = config.telefoneFinanceiro?.trim();
    if (!telefone) return;
    const jid = `${telefone.replace(/\D/g, "")}@s.whatsapp.net`;

    await enviarMensagemPrivada(jid, linhas.join("\n"));
  } catch (err) {
    console.error(`Falha ao notificar financeiro sobre perfume esgotado (id ${perfumeId}):`, err);
  }
}
