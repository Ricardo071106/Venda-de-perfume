import { query } from "../db.js";
import { enviarFotoNoGrupo, enviarAvisoLeilao, montarLegendaPerfume } from "../whatsapp/baileys-client.js";
import { marcarPerfumePostado } from "../sheets/write-to-sheet.js";
import { appendRow, readRange, updateCells, clearRange } from "../sheets/client.js";
import { registrarAjusteEstoque } from "./estoque.js";
import { obterConfiguracoes } from "./configuracoes.js";
import { snapshotConteudoPerfume, type PerfumeParaPostar } from "../sheets/sync-from-sheet.js";

export interface Perfume {
  id: number;
  nome: string;
  marca: string | null;
  composicao: string | null;
  fotoUrl: string | null;
  fragranticaUrl: string | null;
  mlFrasco: number;
  precoMl: number;
  custoMl: number | null;
  estoqueMl: number;
  status: string;
  apcDisponivel: boolean;
}

interface PerfumeRow {
  id: number;
  nome: string;
  marca: string | null;
  composicao: string | null;
  foto_url: string | null;
  fragrantica_url: string | null;
  ml_frasco: number;
  preco_ml: number;
  custo_ml: number | null;
  estoque_ml: number;
  status: string;
  apc_disponivel: boolean;
}

const SELECT_PERFUME = `
  SELECT p.id, p.nome, p.marca, p.composicao, p.foto_url, p.fragrantica_url,
         p.ml_frasco, p.preco_ml, p.custo_ml, p.estoque_ml, p.status, p.apc_disponivel
  FROM perfumes p
`;

function mapRow(r: PerfumeRow): Perfume {
  return {
    id: r.id,
    nome: r.nome,
    marca: r.marca,
    composicao: r.composicao,
    fotoUrl: r.foto_url,
    fragranticaUrl: r.fragrantica_url,
    mlFrasco: Number(r.ml_frasco),
    precoMl: Number(r.preco_ml),
    custoMl: r.custo_ml !== null ? Number(r.custo_ml) : null,
    estoqueMl: Number(r.estoque_ml),
    status: r.status,
    apcDisponivel: r.apc_disponivel,
  };
}

/** Lista todos os perfumes (disponíveis e esgotados) com todos os campos —
 * usada pelo painel tanto na venda rápida quanto na aba "Todos os perfumes". */
export async function listarPerfumes(): Promise<Perfume[]> {
  const rows = await query<PerfumeRow>(`${SELECT_PERFUME} ORDER BY p.status ASC, p.nome ASC`);
  return rows.map(mapRow);
}

export async function buscarPerfume(id: number): Promise<Perfume | null> {
  const rows = await query<PerfumeRow>(`${SELECT_PERFUME} WHERE p.id = $1`, [id]);
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Acha a linha (1-indexada) do perfume na aba Perfumes procurando pelo id na coluna A —
 * mais robusto que confiar no sheet_row salvo no banco, que pode estar desatualizado
 * se a planilha foi editada manualmente entre um sync e outro. */
async function encontrarLinhaDoPerfume(perfumeId: number): Promise<number | null> {
  const rows = await readRange("Perfumes!A2:A");
  for (let i = 0; i < rows.length; i++) {
    if (Number(rows[i][0]) === perfumeId) return i + 2;
  }
  return null;
}

export interface NovoPerfumeInput {
  nome: string;
  marca?: string;
  composicao?: string;
  fotoUrl?: string;
  fragranticaUrl?: string;
  mlFrasco: number;
  precoMl: number;
  custoMl?: number | null;
  estoqueMl?: number;
  postarNoGrupo?: boolean;
  apcDisponivel?: boolean;
}

/** Cria um perfume novo direto pelo painel: grava no banco e também adiciona a
 * linha correspondente na planilha (com o id já preenchido), pra ficar do mesmo
 * jeito que um perfume criado via planilha + sync — inclusive o "postar no
 * grupo": se marcado, o próximo sync publica ele, igual à planilha. */
export async function criarPerfume(input: NovoPerfumeInput): Promise<Perfume> {
  const nome = input.nome?.trim();
  if (!nome) throw new Error("Nome é obrigatório.");
  if (!Number.isFinite(input.mlFrasco) || input.mlFrasco <= 0) {
    throw new Error("ml do frasco precisa ser maior que zero.");
  }
  if (!Number.isFinite(input.precoMl) || input.precoMl <= 0) {
    throw new Error("Preço/ml precisa ser maior que zero.");
  }

  const marca = input.marca?.trim() || null;
  const composicao = input.composicao?.trim() || null;
  const fotoUrl = input.fotoUrl?.trim() || null;
  const fragranticaUrl = input.fragranticaUrl?.trim() || null;
  const estoqueMl = input.estoqueMl && input.estoqueMl > 0 ? input.estoqueMl : input.mlFrasco;
  const apcDisponivel = Boolean(input.apcDisponivel);

  const [inserted] = await query<{ id: number }>(
    `INSERT INTO perfumes (nome, marca, composicao, foto_url, fragrantica_url, ml_frasco,
     preco_ml, custo_ml, estoque_ml, status, apc_disponivel)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ativo',$10) RETURNING id`,
    [nome, marca, composicao, fotoUrl, fragranticaUrl, input.mlFrasco, input.precoMl,
      input.custoMl ?? null, estoqueMl, apcDisponivel]
  );
  const id = inserted.id;

  const sheetRow = await appendRow("Perfumes!A2:O", [
    id, nome, marca ?? "", composicao ?? "", fotoUrl ?? "", input.mlFrasco, input.precoMl,
    input.custoMl ?? "", estoqueMl, "ativo",
    input.postarNoGrupo ? "TRUE" : "", "", "", fragranticaUrl ?? "", apcDisponivel ? "TRUE" : "",
  ]);
  if (sheetRow) {
    await query("UPDATE perfumes SET sheet_row = $1 WHERE id = $2", [sheetRow, id]);
  }

  return (await buscarPerfume(id))!;
}

export interface PatchPerfumeInput {
  nome?: string;
  marca?: string;
  composicao?: string;
  fotoUrl?: string;
  fragranticaUrl?: string;
  mlFrasco?: number;
  precoMl?: number;
  custoMl?: number | null;
  apcDisponivel?: boolean;
}

/** Edita os dados cadastrais de um perfume já existente (não move estoque —
 * pra isso ver ajustarEstoquePainel). Reflete a mudança na planilha também. */
export async function atualizarPerfume(id: number, patch: PatchPerfumeInput): Promise<Perfume> {
  const atual = await buscarPerfume(id);
  if (!atual) throw new Error("Perfume não encontrado.");

  const nome = (patch.nome ?? atual.nome).trim();
  if (!nome) throw new Error("Nome não pode ficar vazio.");
  const marca = patch.marca !== undefined ? (patch.marca.trim() || null) : atual.marca;
  const composicao = patch.composicao !== undefined ? (patch.composicao.trim() || null) : atual.composicao;
  const fotoUrl = patch.fotoUrl !== undefined ? (patch.fotoUrl.trim() || null) : atual.fotoUrl;
  const fragranticaUrl = patch.fragranticaUrl !== undefined ? (patch.fragranticaUrl.trim() || null) : atual.fragranticaUrl;
  const mlFrasco = patch.mlFrasco ?? atual.mlFrasco;
  const precoMl = patch.precoMl ?? atual.precoMl;
  const custoMl = patch.custoMl !== undefined ? patch.custoMl : atual.custoMl;
  const apcDisponivel = patch.apcDisponivel !== undefined ? patch.apcDisponivel : atual.apcDisponivel;

  if (!Number.isFinite(mlFrasco) || mlFrasco <= 0) throw new Error("ml do frasco precisa ser maior que zero.");
  if (!Number.isFinite(precoMl) || precoMl <= 0) throw new Error("Preço/ml precisa ser maior que zero.");

  await query(
    `UPDATE perfumes SET nome=$1, marca=$2, composicao=$3, foto_url=$4, fragrantica_url=$5,
     ml_frasco=$6, preco_ml=$7, custo_ml=$8, apc_disponivel=$9, atualizado_em=now()
     WHERE id=$10`,
    [nome, marca, composicao, fotoUrl, fragranticaUrl, mlFrasco, precoMl, custoMl, apcDisponivel, id]
  );

  const sheetRow = await encontrarLinhaDoPerfume(id);
  if (sheetRow) {
    await updateCells([
      { range: `Perfumes!B${sheetRow}`, value: nome },
      { range: `Perfumes!C${sheetRow}`, value: marca ?? "" },
      { range: `Perfumes!D${sheetRow}`, value: composicao ?? "" },
      { range: `Perfumes!E${sheetRow}`, value: fotoUrl ?? "" },
      { range: `Perfumes!F${sheetRow}`, value: mlFrasco },
      { range: `Perfumes!G${sheetRow}`, value: precoMl },
      { range: `Perfumes!H${sheetRow}`, value: custoMl ?? "" },
      { range: `Perfumes!N${sheetRow}`, value: fragranticaUrl ?? "" },
      { range: `Perfumes!O${sheetRow}`, value: apcDisponivel ? "TRUE" : "" },
    ]);
  }

  return (await buscarPerfume(id))!;
}

/** Remove um perfume do catálogo. Só apaga de verdade se não houver histórico
 * (vendas/movimentos/posts) — nesse caso a exclusão violaria a chave estrangeira
 * e o erro é traduzido pra uma mensagem clara em vez de vazar o erro do Postgres. */
export async function removerPerfume(id: number): Promise<void> {
  try {
    await query("DELETE FROM perfumes WHERE id = $1", [id]);
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "23503") {
      throw new Error(
        "Não é possível remover: esse perfume já tem vendas ou movimentações de estoque registradas. Zere o estoque em vez disso — ele vira 'esgotado' automaticamente."
      );
    }
    throw err;
  }

  const sheetRow = await encontrarLinhaDoPerfume(id);
  if (sheetRow) {
    await clearRange(`Perfumes!A${sheetRow}:O${sheetRow}`);
  }
}

export interface AjusteEstoqueResultado {
  estoqueMl: number;
  status: string;
}

/** Ajuste manual de estoque pelo painel (correção de contagem, perda, achado etc,
 * não uma venda) — delta pode ser positivo (entrada) ou negativo (saída). */
export async function ajustarEstoquePainel(
  id: number,
  deltaMl: number,
  motivo?: string
): Promise<AjusteEstoqueResultado> {
  if (!Number.isFinite(deltaMl) || deltaMl === 0) {
    throw new Error("Informe uma quantidade diferente de zero.");
  }
  const atual = await buscarPerfume(id);
  if (!atual) throw new Error("Perfume não encontrado.");
  if (atual.estoqueMl + deltaMl < 0) {
    throw new Error(`Ajuste inválido: estoque ficaria negativo (atual: ${atual.estoqueMl}ml).`);
  }

  const resultado = await registrarAjusteEstoque(id, deltaMl, motivo?.trim() || "ajuste manual via painel");

  const sheetRow = await encontrarLinhaDoPerfume(id);
  if (sheetRow) {
    await updateCells([
      { range: `Perfumes!I${sheetRow}`, value: resultado.estoqueMl },
      { range: `Perfumes!J${sheetRow}`, value: resultado.status },
    ]);
  }

  return resultado;
}

/** Posta (ou republica, se o conteúdo mudou desde a última vez) um perfume no
 * grupo do WhatsApp e registra o post no banco + na planilha. Antes de um post
 * NOVO (nunca postado ainda), manda um aviso de texto avisando que o leilão vai
 * abrir — republicação por edição não repete o aviso, só a mensagem principal. */
export async function postarPerfumeNoGrupo(perfume: PerfumeParaPostar): Promise<void> {
  const [atual] = await query<{ postado_em: string | null; apc_disponivel: boolean }>(
    "SELECT postado_em, apc_disponivel FROM perfumes WHERE id = $1",
    [perfume.id]
  );
  const primeiroPost = !atual?.postado_em;
  const config = await obterConfiguracoes();

  if (primeiroPost) {
    await enviarAvisoLeilao(
      `⚠️ *Atenção!* Vamos abrir a venda de *${perfume.nome}* agora! Fica de olho aqui no grupo 👀`,
      true
    );
  }

  const legenda = montarLegendaPerfume({
    nome: perfume.nome,
    marca: perfume.marca,
    composicao: perfume.composicao,
    mlFrasco: perfume.mlFrasco,
    estoqueMl: perfume.estoqueMl,
    precoMl: perfume.precoMl,
    fragranticaUrl: perfume.fragranticaUrl,
    apcDisponivel: Boolean(atual?.apc_disponivel),
    mlMinimo: config.mlMinimo,
    assinaturaMarca: config.assinaturaMarca,
  });

  const { messageId } = await enviarFotoNoGrupo({
    fotoUrl: perfume.fotoUrl,
    legenda,
  });

  const conteudoPostado = snapshotConteudoPerfume(perfume);

  await query(
    "INSERT INTO posts_grupo (perfume_id, whatsapp_message_id) VALUES ($1, $2)",
    [perfume.id, messageId]
  );
  await query(
    "UPDATE perfumes SET postado_em = now(), ultimo_conteudo_postado = $1 WHERE id = $2",
    [conteudoPostado, perfume.id]
  );
  await marcarPerfumePostado(perfume.sheetRow);
}
