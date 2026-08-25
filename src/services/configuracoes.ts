import { query } from "../db.js";

export const CHAVE_PIX = "pix_key";
export const TEXTO_ENDERECO = "texto_endereco";

const PADRAO: Record<string, string> = {
  [TEXTO_ENDERECO]: "Por favor, me envie seu endereço completo (rua, número, bairro, cidade, CEP) para o envio do seu perfume.",
};

export interface Configuracoes {
  pixKey: string;
  textoEndereco: string;
}

export async function obterConfiguracoes(): Promise<Configuracoes> {
  const rows = await query<{ chave: string; valor: string | null }>(
    "SELECT chave, valor FROM configuracoes WHERE chave IN ($1, $2)",
    [CHAVE_PIX, TEXTO_ENDERECO]
  );
  const mapa = Object.fromEntries(rows.map((r) => [r.chave, r.valor ?? ""]));
  return {
    pixKey: mapa[CHAVE_PIX] ?? "",
    textoEndereco: mapa[TEXTO_ENDERECO] ?? PADRAO[TEXTO_ENDERECO],
  };
}

export async function salvarConfiguracoes(input: { pixKey?: string; textoEndereco?: string }): Promise<Configuracoes> {
  if (input.pixKey !== undefined) {
    await query(
      `INSERT INTO configuracoes (chave, valor) VALUES ($1, $2)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
      [CHAVE_PIX, input.pixKey]
    );
  }
  if (input.textoEndereco !== undefined) {
    await query(
      `INSERT INTO configuracoes (chave, valor) VALUES ($1, $2)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
      [TEXTO_ENDERECO, input.textoEndereco]
    );
  }
  return obterConfiguracoes();
}
