import { query } from "../db.js";

export interface ResumoFinanceiroPerfume {
  perfume_id: number;
  nome: string;
  ml_vendido_total: number;
  receita_total: number;
  custo_total: number;
  lucro_total: number;
}

/**
 * Resumo de receita/custo/lucro por perfume, com base nas vendas registradas.
 * A aba "Financeiro" da planilha replica essa mesma lógica via QUERY/SUMIF nativos
 * do Sheets; esta função serve para relatórios via código/CLI se necessário.
 */
export async function resumoFinanceiroPorPerfume(): Promise<ResumoFinanceiroPerfume[]> {
  return query<ResumoFinanceiroPerfume>(`
    SELECT
      p.id AS perfume_id,
      p.nome,
      COALESCE(SUM(v.ml_vendido), 0) AS ml_vendido_total,
      COALESCE(SUM(v.valor_total), 0) AS receita_total,
      COALESCE(SUM(v.ml_vendido * p.custo_ml), 0) AS custo_total,
      COALESCE(SUM(v.valor_total) - SUM(v.ml_vendido * p.custo_ml), 0) AS lucro_total
    FROM perfumes p
    LEFT JOIN vendas v ON v.perfume_id = p.id
    GROUP BY p.id, p.nome
    ORDER BY lucro_total DESC
  `);
}
