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

// Lance no leilão do WhatsApp: só o número, com ou sem unidade — "5", "5ml", "5 ml",
// "0,005l", "25l". Ancorado do início ao fim de propósito: uma resposta qualquer
// (ex: "lindo esse perfume!") não pode ser confundida com um lance.
const LANCE_REGEX = /^([\d]+(?:[.,]\d+)?)\s*(ml|l)?$/i;

/** Interpreta uma resposta como lance de quantidade (em ml). Litros (sufixo "l")
 * são convertidos pra ml automaticamente. Retorna null se o texto não for
 * reconhecido como um lance (nesse caso a mensagem é ignorada, não rejeitada). */
export function parseLanceQuantidade(texto: string): number | null {
  const match = texto.trim().match(LANCE_REGEX);
  if (!match) return null;
  const [, numeroStr, unidade] = match;
  const numero = parseNumeroBr(numeroStr);
  if (!Number.isFinite(numero) || numero <= 0) return null;
  return unidade?.toLowerCase() === "l" ? numero * 1000 : numero;
}

// "APC", "apc 10ml", "APC 50 ml" etc. Com número: quantidade específica pra entregar
// no frasco físico + caixa (ex: "APC 50" = 50ml, dentro do vidro original). Sem
// número: leva tudo que sobrar no momento.
const APC_REGEX = /^apc(?:\s*([\d.,]+)\s*(ml|l)?)?$/i;

export interface ComandoApc {
  quantidadeMl: number | null; // null = leva tudo que sobrar
}

/** Interpreta um pedido de APC (frasco físico original + caixa). Retorna null se o
 * texto não for um comando de APC. */
export function parseComandoApc(texto: string): ComandoApc | null {
  const match = texto.trim().match(APC_REGEX);
  if (!match) return null;
  const [, numeroStr, unidade] = match;
  if (!numeroStr) return { quantidadeMl: null };
  const numero = parseNumeroBr(numeroStr);
  if (!Number.isFinite(numero) || numero <= 0) return { quantidadeMl: null };
  const quantidadeMl = unidade?.toLowerCase() === "l" ? numero * 1000 : numero;
  return { quantidadeMl };
}
