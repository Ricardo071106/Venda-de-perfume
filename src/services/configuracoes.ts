import { query } from "../db.js";

export const CHAVE_PIX = "pix_key";
export const TEXTO_ENDERECO = "texto_endereco";
export const ML_MINIMO = "ml_minimo";
export const ASSINATURA_MARCA = "assinatura_marca";
export const TELEFONE_FINANCEIRO = "telefone_financeiro";

const TODAS_AS_CHAVES = [CHAVE_PIX, TEXTO_ENDERECO, ML_MINIMO, ASSINATURA_MARCA, TELEFONE_FINANCEIRO];

const PADRAO: Record<string, string> = {
  [TEXTO_ENDERECO]: "Por favor, me envie seu endereço completo (rua, número, bairro, cidade, CEP) para o envio do seu perfume.",
  [ML_MINIMO]: "3",
  [TELEFONE_FINANCEIRO]: "5511985644444",
};

export interface Configuracoes {
  pixKey: string;
  textoEndereco: string;
  mlMinimo: number;
  assinaturaMarca: string;
  telefoneFinanceiro: string;
}

export async function obterConfiguracoes(): Promise<Configuracoes> {
  const rows = await query<{ chave: string; valor: string | null }>(
    `SELECT chave, valor FROM configuracoes WHERE chave IN (${TODAS_AS_CHAVES.map((_, i) => `$${i + 1}`).join(",")})`,
    TODAS_AS_CHAVES
  );
  const mapa = Object.fromEntries(rows.map((r) => [r.chave, r.valor ?? ""]));
  const mlMinimoStr = mapa[ML_MINIMO] ?? PADRAO[ML_MINIMO];
  return {
    pixKey: mapa[CHAVE_PIX] ?? "",
    textoEndereco: mapa[TEXTO_ENDERECO] ?? PADRAO[TEXTO_ENDERECO],
    mlMinimo: Number(mlMinimoStr) || 3,
    assinaturaMarca: mapa[ASSINATURA_MARCA] ?? "",
    telefoneFinanceiro: mapa[TELEFONE_FINANCEIRO] ?? PADRAO[TELEFONE_FINANCEIRO],
  };
}

export async function salvarConfiguracoes(input: {
  pixKey?: string;
  textoEndereco?: string;
  mlMinimo?: number;
  assinaturaMarca?: string;
  telefoneFinanceiro?: string;
}): Promise<Configuracoes> {
  const pares: [string, string][] = [];
  if (input.pixKey !== undefined) pares.push([CHAVE_PIX, input.pixKey]);
  if (input.textoEndereco !== undefined) pares.push([TEXTO_ENDERECO, input.textoEndereco]);
  if (input.mlMinimo !== undefined) pares.push([ML_MINIMO, String(input.mlMinimo)]);
  if (input.assinaturaMarca !== undefined) pares.push([ASSINATURA_MARCA, input.assinaturaMarca]);
  if (input.telefoneFinanceiro !== undefined) pares.push([TELEFONE_FINANCEIRO, input.telefoneFinanceiro]);

  for (const [chave, valor] of pares) {
    await query(
      `INSERT INTO configuracoes (chave, valor) VALUES ($1, $2)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
      [chave, valor]
    );
  }
  return obterConfiguracoes();
}
