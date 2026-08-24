// Reconhece frases do tipo: "vendi 5ml para Maria por 50" (aceita "5 ml", "R$50", "50,00" etc.)
const VENDA_REGEX = /vendi\s+([\d.,]+)\s*ml\s+para\s+([a-zà-ú\s]+?)\s+por\s+r?\$?\s*([\d.,]+)/i;

export interface ComandoVenda {
  mlVendido: number;
  clienteNome: string;
  valorTotal: number;
}

function parseNumeroBr(raw: string): number {
  // aceita tanto "50" quanto "50,00" quanto "1.234,56"
  const normalizado = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  return Number(normalizado);
}

export function parseComandoVenda(texto: string): ComandoVenda | null {
  const match = texto.trim().match(VENDA_REGEX);
  if (!match) return null;
  const [, mlStr, clienteNome, valorStr] = match;
  return {
    mlVendido: parseNumeroBr(mlStr),
    clienteNome: clienteNome.trim(),
    valorTotal: parseNumeroBr(valorStr),
  };
}
