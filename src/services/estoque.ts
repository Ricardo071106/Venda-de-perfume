import { query } from "../db.js";

export interface EstoqueAtualizado {
  estoqueMl: number;
  status: string;
}

/** Debita estoque e alterna o status pra 'esgotado' automaticamente quando zera.
 * Único ponto que decrementa estoque (venda via WhatsApp ou painel) — mantém a regra
 * de status consistente em qualquer origem. Zera anuncio_ativo quando esgota: a partir
 * daí o perfume só volta a aparecer em "Anúncios ativos" se for anunciado de novo de
 * propósito, não só porque o estoque foi corrigido pra cima depois. */
export async function registrarSaidaEstoque(
  perfumeId: number,
  ml: number,
  motivo: string
): Promise<EstoqueAtualizado> {
  const [row] = await query<{ estoque_ml: number; status: string }>(
    `UPDATE perfumes SET
       estoque_ml = estoque_ml - $1,
       status = CASE WHEN estoque_ml - $1 <= 0 THEN 'esgotado' ELSE 'ativo' END,
       anuncio_ativo = CASE WHEN estoque_ml - $1 <= 0 THEN false ELSE anuncio_ativo END,
       atualizado_em = now()
     WHERE id = $2
     RETURNING estoque_ml, status`,
    [ml, perfumeId]
  );
  await query(
    "INSERT INTO estoque_movimentos (perfume_id, tipo, ml, motivo) VALUES ($1, 'saida', $2, $3)",
    [perfumeId, ml, motivo]
  );
  return { estoqueMl: Number(row.estoque_ml), status: row.status };
}

/** Ajuste manual de estoque (correção de contagem, perda, achado, reabertura por
 * cancelamento etc) — delta pode ser positivo ou negativo. Diferente de venda: fica
 * registrado como tipo 'ajuste' em estoque_movimentos. NÃO mexe em ultimo_conteudo_postado
 * nem em anuncio_ativo quando volta a ter estoque — quem decide se isso deve virar um
 * post novo é explicitamente quem chama (ver "Anunciar de novo" em perfumes.ts), não
 * esse ajuste sozinho. Mas ZERA anuncio_ativo se o ajuste esgotar o perfume, pelo mesmo
 * motivo de registrarSaidaEstoque. */
export async function registrarAjusteEstoque(
  perfumeId: number,
  deltaMl: number,
  motivo: string
): Promise<EstoqueAtualizado> {
  const [row] = await query<{ estoque_ml: number; status: string }>(
    `UPDATE perfumes SET
       estoque_ml = estoque_ml + $1,
       status = CASE WHEN estoque_ml + $1 <= 0 THEN 'esgotado' ELSE 'ativo' END,
       anuncio_ativo = CASE WHEN estoque_ml + $1 <= 0 THEN false ELSE anuncio_ativo END,
       atualizado_em = now()
     WHERE id = $2
     RETURNING estoque_ml, status`,
    [deltaMl, perfumeId]
  );
  await query(
    "INSERT INTO estoque_movimentos (perfume_id, tipo, ml, motivo) VALUES ($1, 'ajuste', $2, $3)",
    [perfumeId, Math.abs(deltaMl), motivo]
  );
  return { estoqueMl: Number(row.estoque_ml), status: row.status };
}
