import { query } from "../db.js";
import { enviarFotoNoGrupo, enviarMensagemGrupo } from "../whatsapp/baileys-client.js";
import { registrarAjusteEstoque } from "./estoque.js";
import { listarCompradores, formatarListaCompradores, montarMensagemEsgotado } from "./leilao.js";
import { notificarVendaCompleta } from "./notificacaoFinanceiro.js";
import { postarPerfumeNoGrupo, republicarSeConteudoMudou } from "./publicacao.js";

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
  apcPreco: number | null;
  apcMlMinimo: number | null;
  postadoEm: string | null;
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
  apc_preco: number | null;
  apc_ml_minimo: number | null;
  postado_em: string | null;
}

const SELECT_PERFUME = `
  SELECT p.id, p.nome, p.marca, p.composicao, p.foto_url, p.fragrantica_url,
         p.ml_frasco, p.preco_ml, p.custo_ml, p.estoque_ml, p.status, p.apc_disponivel, p.apc_preco,
         p.apc_ml_minimo, p.postado_em
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
    apcPreco: r.apc_preco !== null ? Number(r.apc_preco) : null,
    apcMlMinimo: r.apc_ml_minimo !== null ? Number(r.apc_ml_minimo) : null,
    postadoEm: r.postado_em,
  };
}

/** Lista todos os perfumes (disponíveis e esgotados) com todos os campos —
 * usada pelo painel tanto na venda rápida quanto na aba "Todos os perfumes".
 * Não inclui perfumes arquivados (removidos do catálogo, mas com histórico
 * preservado no banco — ver removerPerfume). */
export async function listarPerfumes(): Promise<Perfume[]> {
  const rows = await query<PerfumeRow>(
    `${SELECT_PERFUME} WHERE p.arquivado_em IS NULL ORDER BY p.status ASC, p.nome ASC`
  );
  return rows.map(mapRow);
}

export async function buscarPerfume(id: number): Promise<Perfume | null> {
  const rows = await query<PerfumeRow>(`${SELECT_PERFUME} WHERE p.id = $1`, [id]);
  return rows[0] ? mapRow(rows[0]) : null;
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
  apcPreco?: number | null;
  apcMlMinimo?: number | null;
}

/** Cria um perfume novo direto pelo painel (fonte única de dados — sem planilha).
 * Se "postar no grupo" for marcado, publica no WhatsApp imediatamente; se o envio
 * falhar (ex: WhatsApp temporariamente desconectado), o perfume continua criado
 * normalmente — só loga o erro, dá pra postar depois pela aba "Anúncios ativos". */
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
  const apcPreco = input.apcPreco && input.apcPreco > 0 ? input.apcPreco : null;
  const apcMlMinimo = input.apcMlMinimo && input.apcMlMinimo > 0 ? input.apcMlMinimo : null;

  const [inserted] = await query<{ id: number }>(
    `INSERT INTO perfumes (nome, marca, composicao, foto_url, fragrantica_url, ml_frasco,
     preco_ml, custo_ml, estoque_ml, status, apc_disponivel, apc_preco, apc_ml_minimo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ativo',$10,$11,$12) RETURNING id`,
    [nome, marca, composicao, fotoUrl, fragranticaUrl, input.mlFrasco, input.precoMl,
      input.custoMl ?? null, estoqueMl, apcDisponivel, apcPreco, apcMlMinimo]
  );
  const id = inserted.id;

  if (input.postarNoGrupo) {
    try {
      await postarPerfumeNoGrupo(id);
    } catch (err) {
      console.error(`Perfume "${nome}" (id ${id}) criado, mas falhou ao postar no grupo:`, err);
    }
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
  apcPreco?: number | null;
  apcMlMinimo?: number | null;
  postarNoGrupo?: boolean;
}

/** Edita os dados cadastrais de um perfume já existente (não move estoque —
 * pra isso ver ajustarEstoquePainel). Se o perfume já foi postado antes e algo
 * relevante mudou (nome, marca, composição, ml, preço, foto, fragrantica),
 * republica automaticamente. Se nunca foi postado e `postarNoGrupo` foi marcado
 * agora, publica pela primeira vez. Falha de envio ao WhatsApp não derruba a
 * edição — só fica registrada no log. */
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
  const apcPrecoBruto = patch.apcPreco !== undefined ? patch.apcPreco : atual.apcPreco;
  const apcPreco = apcPrecoBruto && apcPrecoBruto > 0 ? apcPrecoBruto : null;
  const apcMlMinimoBruto = patch.apcMlMinimo !== undefined ? patch.apcMlMinimo : atual.apcMlMinimo;
  const apcMlMinimo = apcMlMinimoBruto && apcMlMinimoBruto > 0 ? apcMlMinimoBruto : null;

  if (!Number.isFinite(mlFrasco) || mlFrasco <= 0) throw new Error("ml do frasco precisa ser maior que zero.");
  if (!Number.isFinite(precoMl) || precoMl <= 0) throw new Error("Preço/ml precisa ser maior que zero.");

  await query(
    `UPDATE perfumes SET nome=$1, marca=$2, composicao=$3, foto_url=$4, fragrantica_url=$5,
     ml_frasco=$6, preco_ml=$7, custo_ml=$8, apc_disponivel=$9, apc_preco=$10, apc_ml_minimo=$11, atualizado_em=now()
     WHERE id=$12`,
    [nome, marca, composicao, fotoUrl, fragranticaUrl, mlFrasco, precoMl, custoMl, apcDisponivel, apcPreco, apcMlMinimo, id]
  );

  try {
    if (patch.postarNoGrupo && !atual.postadoEm) {
      await postarPerfumeNoGrupo(id);
    } else {
      await republicarSeConteudoMudou(id);
    }
  } catch (err) {
    console.error(`Perfume "${nome}" (id ${id}) editado, mas falhou ao (re)publicar no grupo:`, err);
  }

  return (await buscarPerfume(id))!;
}

/** Remove um perfume do catálogo/painel. Se não houver histórico (vendas/
 * movimentos/posts), apaga a linha de verdade. Se houver — a chave estrangeira
 * não deixaria apagar mesmo, e não queríamos mesmo: em vez disso, arquiva
 * (some do painel, mas vendas/movimentos/receita continuam intactos no banco
 * pra referência financeira). */
export async function removerPerfume(id: number): Promise<void> {
  try {
    await query("DELETE FROM perfumes WHERE id = $1", [id]);
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "23503") {
      await query("UPDATE perfumes SET arquivado_em = now() WHERE id = $1", [id]);
    } else {
      throw err;
    }
  }
}

export interface AjusteEstoqueResultado {
  estoqueMl: number;
  status: string;
}

/** Ajuste manual de estoque pelo painel (correção de contagem, perda, achado etc,
 * não uma venda) — delta pode ser positivo (entrada) ou negativo (saída).
 * `anunciarDeNovo`: se marcado e o perfume já tiver sido postado antes (ex: "comprei
 * mais Xml desse perfume"), republica no grupo imediatamente. Sem marcar, o ajuste
 * só corrige o número, sem mexer no post existente. */
export async function ajustarEstoquePainel(
  id: number,
  deltaMl: number,
  motivo?: string,
  anunciarDeNovo = false
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

  if (anunciarDeNovo && atual.postadoEm) {
    try {
      await postarPerfumeNoGrupo(id);
    } catch (err) {
      console.error(`Perfume "${atual.nome}" (id ${id}) ajustado, mas falhou ao republicar no grupo:`, err);
    }
  }

  return resultado;
}

/** Encerra a venda de um perfume manualmente pelo painel, independente de quanto ml
 * ainda resta — zera o estoque (fica 'esgotado') e dispara no grupo a mesma mensagem
 * de fechamento (com foto + lista de compradores) que sairia se ele tivesse esgotado
 * organicamente por venda, além do relatório financeiro de praxe. */
export async function encerrarVendaManual(id: number): Promise<{ ok: true }> {
  const [atual] = await query<{ nome: string; estoque_ml: number; foto_url: string | null; postado_em: string | null }>(
    "SELECT nome, estoque_ml, foto_url, postado_em FROM perfumes WHERE id = $1",
    [id]
  );
  if (!atual) throw new Error("Perfume não encontrado.");
  const estoqueAtual = Number(atual.estoque_ml);
  if (estoqueAtual <= 0) {
    throw new Error("Esse perfume já está esgotado.");
  }

  await registrarAjusteEstoque(id, -estoqueAtual, "venda encerrada manualmente via painel");

  const compradores = await listarCompradores(id, atual.postado_em);
  const mensagemEsgotado = montarMensagemEsgotado(atual.nome, formatarListaCompradores(compradores));

  if (atual.foto_url) {
    await enviarFotoNoGrupo({ fotoUrl: atual.foto_url, legenda: mensagemEsgotado });
  } else {
    await enviarMensagemGrupo(mensagemEsgotado);
  }

  await notificarVendaCompleta(id);

  return { ok: true };
}

/** Republica um perfume já anunciado antes, agora — mesmo que nada tenha mudado no
 * cadastro. Útil pra dar um empurrão de novo num perfume que ainda tem estoque, ou
 * que acabou de ser reposto. Só funciona se ainda tiver ml disponível e já tiver
 * sido postado antes. */
export async function marcarParaAnunciar(id: number): Promise<{ ok: true }> {
  const [atual] = await query<{ estoque_ml: number; status: string; postado_em: string | null }>(
    "SELECT estoque_ml, status, postado_em FROM perfumes WHERE id = $1",
    [id]
  );
  if (!atual) throw new Error("Perfume não encontrado.");
  if (!atual.postado_em) {
    throw new Error('Esse perfume ainda não foi postado no grupo — marque "postar no grupo" ao editar.');
  }
  if (Number(atual.estoque_ml) <= 0 || atual.status !== "ativo") {
    throw new Error("Esse perfume está esgotado — reponha o estoque antes de anunciar de novo.");
  }
  await postarPerfumeNoGrupo(id);
  return { ok: true };
}
