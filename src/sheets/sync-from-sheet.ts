import { readRange, updateCell } from "./client.js";
import { query } from "../db.js";
import { registrarEntradaEstoque, registrarSaidaEstoque } from "../services/estoque.js";
import { getOrCreateFornecedorId } from "../services/fornecedores.js";

// Aba "Perfumes": A id | B nome | C marca | D composicao | E foto_url | F ml_frasco
//                 G preco_ml | H custo_ml | I fornecedor | J estoque_ml | K status
//                 L postar_no_grupo | M postado | N repor_ml | O fragrantica_url
//
// estoque_ml (J) e status (K, 'ativo'/'esgotado') são espelho do banco: o bot
// regrava esses valores a cada ciclo, não edite direto ali. Para repor estoque,
// preencha repor_ml (N) com a quantidade que entrou — o bot soma no banco,
// volta o status pra 'ativo' se estava esgotado, e limpa a célula.
const PERFUMES_RANGE = "Perfumes!A2:O";

// Aba "Vendas": A id | B perfume | C cliente | D telefone | E ml_vendido
//               F valor_total | G forma_pagamento | H data | I origem
const VENDAS_RANGE = "Vendas!A2:I";

export interface PerfumeParaPostar {
  id: number;
  nome: string;
  marca: string;
  composicao: string;
  fotoUrl: string;
  mlFrasco: number;
  precoMl: number;
  estoqueMl: number;
  fragranticaUrl: string;
  sheetRow: number;
}

/** "Retrato" dos campos que aparecem na legenda do post — usado só pra comparar
 * se algo relevante mudou desde a última publicação, não pra guardar em outro lugar.
 * Propositalmente NÃO inclui estoque_ml (mudaria a cada venda, republicaria demais)
 * nem campos internos (custo, fornecedor) que não aparecem no post. */
export function snapshotConteudoPerfume(p: {
  nome: string;
  marca: string;
  composicao: string;
  mlFrasco: number;
  precoMl: number;
  fotoUrl: string;
  fragranticaUrl: string;
}): string {
  return JSON.stringify({
    nome: p.nome,
    marca: p.marca,
    composicao: p.composicao,
    mlFrasco: p.mlFrasco,
    precoMl: p.precoMl,
    fotoUrl: p.fotoUrl,
    fragranticaUrl: p.fragranticaUrl,
  });
}

/** Sincroniza a aba Perfumes -> Postgres. Retorna perfumes marcados para postar que ainda não foram postados. */
export async function syncPerfumesFromSheet(): Promise<PerfumeParaPostar[]> {
  const rows = await readRange(PERFUMES_RANGE);
  const paraPostar: PerfumeParaPostar[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const sheetRow = i + 2; // offset porque a leitura começa em A2
    const [
      idCell, nome, marca, composicao, fotoUrl, mlFrascoStr,
      precoMlStr, custoMlStr, fornecedorNome, estoqueMlStr, status,
      postarNoGrupo, postado, reporMlStr, fragranticaUrl,
    ] = row;

    if (!nome?.trim()) continue; // linha vazia

    const mlFrasco = Number(mlFrascoStr ?? 0);
    const precoMl = Number(precoMlStr ?? 0);
    const custoMl = custoMlStr ? Number(custoMlStr) : null;
    const fornecedorId = await getOrCreateFornecedorId(fornecedorNome);

    let perfumeId: number;
    let estoqueMl: number;
    let precisaRepublicar = false;

    if (idCell?.trim()) {
      // Perfume já existe: estoque_ml e status NÃO vêm da planilha aqui (são espelho
      // do banco, ver comentário no topo do arquivo) — só os demais campos.
      perfumeId = Number(idCell);
      await query(
        `UPDATE perfumes SET nome=$1, marca=$2, composicao=$3, foto_url=$4, ml_frasco=$5,
         preco_ml=$6, custo_ml=$7, fornecedor_id=$8,
         sheet_row=$9, fragrantica_url=$10, atualizado_em=now()
         WHERE id=$11`,
        [nome, marca, composicao, fotoUrl, mlFrasco, precoMl, custoMl, fornecedorId,
          sheetRow, fragranticaUrl || null, perfumeId]
      );

      const reporMl = Number(reporMlStr ?? 0);
      let statusAtual: string;
      if (reporMl > 0) {
        const resultado = await registrarEntradaEstoque(perfumeId, reporMl, "reposição via planilha");
        estoqueMl = resultado.estoqueMl;
        statusAtual = resultado.status;
        await updateCell(`Perfumes!N${sheetRow}`, ""); // limpa a célula processada
      } else {
        const atual = await query<{ estoque_ml: number; status: string }>(
          "SELECT estoque_ml, status FROM perfumes WHERE id = $1",
          [perfumeId]
        );
        estoqueMl = Number(atual[0]?.estoque_ml ?? 0);
        statusAtual = atual[0]?.status ?? "ativo";
      }
      await updateCell(`Perfumes!J${sheetRow}`, estoqueMl); // espelha o banco na planilha
      await updateCell(`Perfumes!K${sheetRow}`, statusAtual); // idem pro status ('ativo'/'esgotado')

      // Já foi postado antes e algum campo do post (nome/marca/composição/ml/preço/
      // foto/fragrantica) mudou desde a última publicação? Marca pra republicar —
      // não importa se veio de edição na planilha ou no painel (o painel também
      // escreve nesses mesmos campos da planilha).
      const [jaPublicado] = await query<{ postado_em: string | null; ultimo_conteudo_postado: string | null }>(
        "SELECT postado_em, ultimo_conteudo_postado FROM perfumes WHERE id = $1",
        [perfumeId]
      );
      const conteudoAtual = snapshotConteudoPerfume({
        nome, marca: marca ?? "", composicao: composicao ?? "", mlFrasco, precoMl,
        fotoUrl: fotoUrl ?? "", fragranticaUrl: fragranticaUrl ?? "",
      });
      // ultimo_conteudo_postado nulo com postado_em preenchido = perfume publicado antes
      // desse controle existir (sem retrato pra comparar) — trata como "mudou" também,
      // pra não ficar travado pra sempre sem nunca republicar.
      if (
        jaPublicado?.postado_em &&
        statusAtual === "ativo" &&
        jaPublicado.ultimo_conteudo_postado !== conteudoAtual
      ) {
        precisaRepublicar = true;
      }
    } else {
      // Perfume novo: aqui sim a planilha define o estoque inicial.
      estoqueMl = estoqueMlStr ? Number(estoqueMlStr) : mlFrasco;
      const inserted = await query<{ id: number }>(
        `INSERT INTO perfumes (nome, marca, composicao, foto_url, ml_frasco, preco_ml,
         custo_ml, fornecedor_id, estoque_ml, status, sheet_row, fragrantica_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [nome, marca, composicao, fotoUrl, mlFrasco, precoMl, custoMl, fornecedorId,
          estoqueMl, status || "ativo", sheetRow, fragranticaUrl || null]
      );
      perfumeId = inserted[0].id;
      await updateCell(`Perfumes!A${sheetRow}`, perfumeId);
    }

    const jaPostado = Boolean(postado?.trim());
    const deveSerPostado = String(postarNoGrupo).trim().toUpperCase() === "TRUE";

    if ((deveSerPostado && !jaPostado) || precisaRepublicar) {
      paraPostar.push({
        id: perfumeId,
        nome,
        marca: marca ?? "",
        composicao: composicao ?? "",
        fotoUrl: fotoUrl ?? "",
        mlFrasco,
        precoMl,
        estoqueMl,
        fragranticaUrl: fragranticaUrl ?? "",
        sheetRow,
      });
    }
  }

  return paraPostar;
}

async function getOrCreateCliente(nome: string, telefone: string): Promise<number | null> {
  if (!nome?.trim()) return null;
  const existing = await query<{ id: number }>(
    "SELECT id FROM clientes WHERE lower(nome) = lower($1) LIMIT 1",
    [nome.trim()]
  );
  if (existing.length > 0) return existing[0].id;
  const inserted = await query<{ id: number }>(
    "INSERT INTO clientes (nome, telefone) VALUES ($1, $2) RETURNING id",
    [nome.trim(), telefone ?? null]
  );
  return inserted[0].id;
}

/** Sincroniza vendas lançadas manualmente na aba Vendas (linhas sem id e sem origem preenchida). */
export async function syncVendasManualFromSheet(): Promise<void> {
  const rows = await readRange(VENDAS_RANGE);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const sheetRow = i + 2;
    const [idCell, perfumeNome, clienteNome, telefone, mlVendidoStr, valorTotalStr, formaPagamento, data, origem] = row;

    if (!perfumeNome?.trim()) continue;
    if (idCell?.trim()) continue; // já processada
    if (origem?.trim()) continue; // veio do bot do whatsapp, não é lançamento manual

    const perfumeRows = await query<{ id: number; estoque_ml: number }>(
      "SELECT id, estoque_ml FROM perfumes WHERE lower(nome) = lower($1) LIMIT 1",
      [perfumeNome.trim()]
    );
    if (perfumeRows.length === 0) {
      console.warn(`Venda na linha ${sheetRow}: perfume "${perfumeNome}" não encontrado, pulando.`);
      continue;
    }
    const perfume = perfumeRows[0];
    const mlVendido = Number(mlVendidoStr ?? 0);
    const valorTotal = Number(valorTotalStr ?? 0);
    const clienteId = await getOrCreateCliente(clienteNome ?? "", telefone ?? "");

    const inserted = await query<{ id: number }>(
      `INSERT INTO vendas (perfume_id, cliente_id, ml_vendido, valor_total, forma_pagamento, origem, sheet_row)
       VALUES ($1,$2,$3,$4,$5,'manual_planilha',$6) RETURNING id`,
      [perfume.id, clienteId, mlVendido, valorTotal, formaPagamento ?? null, sheetRow]
    );

    await registrarSaidaEstoque(perfume.id, mlVendido, "venda manual planilha");

    await updateCell(`Vendas!A${sheetRow}`, inserted[0].id);
  }
}
