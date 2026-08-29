import { query } from "../db.js";
import { enviarFotoNoGrupo, enviarAvisoLeilao, montarLegendaPerfume } from "../whatsapp/baileys-client.js";
import { obterConfiguracoes } from "./configuracoes.js";

interface PerfumeParaPostar {
  id: number;
  nome: string;
  marca: string | null;
  composicao: string | null;
  fotoUrl: string | null;
  mlFrasco: number;
  precoMl: number;
  estoqueMl: number;
  fragranticaUrl: string | null;
  apcDisponivel: boolean;
  apcPreco: number | null;
  apcMlMinimo: number | null;
  status: string;
  postadoEm: string | null;
}

interface PerfumeParaPostarRow {
  id: number;
  nome: string;
  marca: string | null;
  composicao: string | null;
  foto_url: string | null;
  ml_frasco: number;
  preco_ml: number;
  estoque_ml: number;
  fragrantica_url: string | null;
  apc_disponivel: boolean;
  apc_preco: number | null;
  apc_ml_minimo: number | null;
  status: string;
  postado_em: string | null;
}

async function buscarParaPostar(id: number): Promise<PerfumeParaPostar | null> {
  const [row] = await query<PerfumeParaPostarRow>(
    `SELECT id, nome, marca, composicao, foto_url, ml_frasco, preco_ml, estoque_ml,
            fragrantica_url, apc_disponivel, apc_preco, apc_ml_minimo, status, postado_em
     FROM perfumes WHERE id = $1`,
    [id]
  );
  if (!row) return null;
  return {
    id: row.id,
    nome: row.nome,
    marca: row.marca,
    composicao: row.composicao,
    fotoUrl: row.foto_url,
    mlFrasco: Number(row.ml_frasco),
    precoMl: Number(row.preco_ml),
    estoqueMl: Number(row.estoque_ml),
    fragranticaUrl: row.fragrantica_url,
    apcDisponivel: row.apc_disponivel,
    apcPreco: row.apc_preco !== null ? Number(row.apc_preco) : null,
    apcMlMinimo: row.apc_ml_minimo !== null ? Number(row.apc_ml_minimo) : null,
    status: row.status,
    postadoEm: row.postado_em,
  };
}

/** "Retrato" dos campos que aparecem na legenda do post — usado só pra comparar
 * se algo relevante mudou desde a última publicação, não pra guardar em outro lugar.
 * Propositalmente NÃO inclui estoque_ml (mudaria a cada venda, republicaria demais)
 * nem campos internos (custo) que não aparecem no post. */
export function snapshotConteudoPerfume(p: {
  nome: string;
  marca: string | null;
  composicao: string | null;
  mlFrasco: number;
  precoMl: number;
  fotoUrl: string | null;
  fragranticaUrl: string | null;
}): string {
  return JSON.stringify({
    nome: p.nome,
    marca: p.marca ?? "",
    composicao: p.composicao ?? "",
    mlFrasco: p.mlFrasco,
    precoMl: p.precoMl,
    fotoUrl: p.fotoUrl ?? "",
    fragranticaUrl: p.fragranticaUrl ?? "",
  });
}

/** Posta (ou republica) um perfume no grupo do WhatsApp AGORA, incondicionalmente.
 * Antes de um post NOVO (nunca postado ainda), manda um aviso de texto avisando que
 * o leilão vai abrir — republicação por edição não repete o aviso, só a mensagem
 * principal. Registra o post e atualiza o "retrato" do conteúdo no banco. */
export async function postarPerfumeNoGrupo(id: number): Promise<void> {
  const perfume = await buscarParaPostar(id);
  if (!perfume) throw new Error("Perfume não encontrado.");

  const primeiroPost = !perfume.postadoEm;
  const config = await obterConfiguracoes();

  if (primeiroPost) {
    await enviarAvisoLeilao(
      `⚠️ *Atenção!* Vamos abrir a venda de *${perfume.nome}* agora! Fica de olho aqui no grupo 👀`,
      true
    );
  }

  const legenda = montarLegendaPerfume({
    nome: perfume.nome,
    marca: perfume.marca ?? "",
    composicao: perfume.composicao ?? "",
    mlFrasco: perfume.mlFrasco,
    estoqueMl: perfume.estoqueMl,
    precoMl: perfume.precoMl,
    fragranticaUrl: perfume.fragranticaUrl ?? undefined,
    apcDisponivel: perfume.apcDisponivel,
    apcPreco: perfume.apcPreco,
    apcMlMinimo: perfume.apcMlMinimo,
    mlMinimo: config.mlMinimo,
    assinaturaMarca: config.assinaturaMarca,
  });

  const { messageId } = await enviarFotoNoGrupo({
    fotoUrl: perfume.fotoUrl ?? "",
    legenda,
  });

  const conteudoPostado = snapshotConteudoPerfume(perfume);

  await query(
    "INSERT INTO posts_grupo (perfume_id, whatsapp_message_id) VALUES ($1, $2)",
    [id, messageId]
  );
  await query(
    "UPDATE perfumes SET postado_em = now(), ultimo_conteudo_postado = $1, anuncio_ativo = true WHERE id = $2",
    [conteudoPostado, id]
  );
}

/** Republica automaticamente só se o conteúdo relevante do cadastro (nome, marca,
 * composição, ml, preço, foto, fragrantica) mudou desde a última publicação —
 * usado depois de editar um perfume já postado e ativo. Não faz nada se o perfume
 * nunca foi postado, está esgotado/arquivado, ou nada relevante mudou. */
export async function republicarSeConteudoMudou(id: number): Promise<void> {
  const perfume = await buscarParaPostar(id);
  if (!perfume || !perfume.postadoEm || perfume.status !== "ativo") return;

  const [row] = await query<{ ultimo_conteudo_postado: string | null }>(
    "SELECT ultimo_conteudo_postado FROM perfumes WHERE id = $1",
    [id]
  );
  const conteudoAtual = snapshotConteudoPerfume(perfume);
  if (row?.ultimo_conteudo_postado !== conteudoAtual) {
    await postarPerfumeNoGrupo(id);
  }
}
