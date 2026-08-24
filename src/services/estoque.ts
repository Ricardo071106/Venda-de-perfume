import { query } from "../db.js";

export interface EstoqueAtualizado {
  estoqueMl: number;
  status: string;
}

/** Debita estoque e alterna o status pra 'esgotado' automaticamente quando zera.
 * Único ponto que decrementa estoque (venda via WhatsApp, planilha ou painel) — mantém a regra de status consistente em qualquer origem. */
export async function registrarSaidaEstoque(
  perfumeId: number,
  ml: number,
  motivo: string
): Promise<EstoqueAtualizado> {
  const [row] = await query<{ estoque_ml: number; status: string }>(
    `UPDATE perfumes SET
       estoque_ml = estoque_ml - $1,
       status = CASE WHEN estoque_ml - $1 <= 0 THEN 'esgotado' ELSE 'ativo' END,
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

/** Ajuste manual de estoque (correção de contagem, perda, etc.) — delta pode ser
 * positivo ou negativo. Diferente de venda/reposição: fica registrado como tipo
 * 'ajuste' em estoque_movimentos, pra não misturar com histórico de vendas de verdade. */
export async function registrarAjusteEstoque(
  perfumeId: number,
  deltaMl: number,
  motivo: string
): Promise<EstoqueAtualizado> {
  const [row] = await query<{ estoque_ml: number; status: string }>(
    `UPDATE perfumes SET
       estoque_ml = estoque_ml + $1,
       status = CASE WHEN estoque_ml + $1 <= 0 THEN 'esgotado' ELSE 'ativo' END,
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

/** Repõe estoque e volta o status pra 'ativo' quando sai de zero/negativo. */
export async function registrarEntradaEstoque(
  perfumeId: number,
  ml: number,
  motivo: string
): Promise<EstoqueAtualizado> {
  const [row] = await query<{ estoque_ml: number; status: string }>(
    `UPDATE perfumes SET
       estoque_ml = estoque_ml + $1,
       status = CASE WHEN estoque_ml + $1 > 0 THEN 'ativo' ELSE status END,
       atualizado_em = now()
     WHERE id = $2
     RETURNING estoque_ml, status`,
    [ml, perfumeId]
  );
  await query(
    "INSERT INTO estoque_movimentos (perfume_id, tipo, ml, motivo) VALUES ($1, 'entrada', $2, $3)",
    [perfumeId, ml, motivo]
  );
  return { estoqueMl: Number(row.estoque_ml), status: row.status };
}
