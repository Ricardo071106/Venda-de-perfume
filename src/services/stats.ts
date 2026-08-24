import { query } from "../db.js";
import { resumoFinanceiroPorPerfume } from "./financeiro.js";

export interface DashboardStats {
  totalPerfumesAtivos: number;
  estoqueTotalMl: number;
  totalVendidoMl: number;
  receitaTotal: number;
  lucroTotal: number;
  vendasPorPerfume: { nome: string; valor: number }[];
  estoquePorPerfume: { nome: string; valor: number }[];
  vendasRecentes: {
    perfume: string;
    cliente: string;
    ml: number;
    valor: number;
    data: string;
    origem: string;
  }[];
}

export async function obterEstatisticas(): Promise<DashboardStats> {
  const [perfumesAtivos] = await query<{ count: string }>(
    "SELECT count(*)::int AS count FROM perfumes WHERE status = 'ativo'"
  );
  const [estoque] = await query<{ total: string }>(
    "SELECT COALESCE(sum(estoque_ml), 0) AS total FROM perfumes WHERE status = 'ativo'"
  );
  const [vendasAgg] = await query<{ ml: string; receita: string }>(
    "SELECT COALESCE(sum(ml_vendido), 0) AS ml, COALESCE(sum(valor_total), 0) AS receita FROM vendas"
  );

  const financeiro = await resumoFinanceiroPorPerfume();
  const lucroTotal = financeiro.reduce((acc, f) => acc + Number(f.lucro_total), 0);

  const estoquePorPerfume = await query<{ nome: string; estoque_ml: string }>(
    `SELECT nome, estoque_ml FROM perfumes WHERE status = 'ativo'
     ORDER BY estoque_ml DESC LIMIT 8`
  );

  const vendasRecentes = await query<{
    perfume: string;
    cliente: string | null;
    ml_vendido: string;
    valor_total: string;
    data: string;
    origem: string;
  }>(`
    SELECT p.nome AS perfume, c.nome AS cliente, v.ml_vendido, v.valor_total, v.data, v.origem
    FROM vendas v
    JOIN perfumes p ON p.id = v.perfume_id
    LEFT JOIN clientes c ON c.id = v.cliente_id
    ORDER BY v.data DESC
    LIMIT 10
  `);

  return {
    totalPerfumesAtivos: Number(perfumesAtivos?.count ?? 0),
    estoqueTotalMl: Number(estoque?.total ?? 0),
    totalVendidoMl: Number(vendasAgg?.ml ?? 0),
    receitaTotal: Number(vendasAgg?.receita ?? 0),
    lucroTotal,
    vendasPorPerfume: financeiro
      .filter((f) => Number(f.receita_total) > 0)
      .slice(0, 8)
      .map((f) => ({ nome: f.nome, valor: Number(f.receita_total) })),
    estoquePorPerfume: estoquePorPerfume.map((e) => ({
      nome: e.nome,
      valor: Number(e.estoque_ml),
    })),
    vendasRecentes: vendasRecentes.map((v) => ({
      perfume: v.perfume,
      cliente: v.cliente ?? "—",
      ml: Number(v.ml_vendido),
      valor: Number(v.valor_total),
      data: v.data,
      origem: v.origem,
    })),
  };
}
