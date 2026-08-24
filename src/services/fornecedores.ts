import { query } from "../db.js";

/** Acha o fornecedor pelo nome (case-insensitive) ou cria um novo — usado tanto
 * pelo sync da planilha quanto pelos formulários de criar/editar perfume no painel. */
export async function getOrCreateFornecedorId(nome: string | null | undefined): Promise<number | null> {
  if (!nome?.trim()) return null;
  const existing = await query<{ id: number }>(
    "SELECT id FROM fornecedores WHERE lower(nome) = lower($1) LIMIT 1",
    [nome.trim()]
  );
  if (existing.length > 0) return existing[0].id;
  const inserted = await query<{ id: number }>(
    "INSERT INTO fornecedores (nome) VALUES ($1) RETURNING id",
    [nome.trim()]
  );
  return inserted[0].id;
}
