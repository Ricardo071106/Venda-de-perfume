import { syncPerfumesFromSheet, syncVendasManualFromSheet } from "../sheets/sync-from-sheet.js";
import { postarPerfumeNoGrupo } from "./perfumes.js";

export interface ResultadoSync {
  ok: boolean;
  perfumesPostados: string[];
  erro?: string;
  executadoEm: string;
}

let ultimoResultado: ResultadoSync | null = null;
let ultimoResultadoDados: ResultadoSync | null = null;

export function obterUltimoResultadoSync(): ResultadoSync | null {
  return ultimoResultado;
}

export function obterUltimoResultadoSyncDados(): ResultadoSync | null {
  return ultimoResultadoDados;
}

/** Lê a planilha, atualiza o banco, posta perfumes novos no grupo. Chamado ao
 * subir o serviço e sob demanda pelo botão "Atualizar agora" do painel. */
export async function rodarSync(): Promise<ResultadoSync> {
  const perfumesPostados: string[] = [];
  try {
    const paraPostar = await syncPerfumesFromSheet();
    for (const perfume of paraPostar) {
      await postarPerfumeNoGrupo(perfume);
      perfumesPostados.push(perfume.nome);
      console.log(`Perfume postado no grupo: ${perfume.nome}`);
    }
    await syncVendasManualFromSheet();
    ultimoResultado = { ok: true, perfumesPostados, executadoEm: new Date().toISOString() };
  } catch (err) {
    console.error("Erro no ciclo de sincronização:", err);
    ultimoResultado = {
      ok: false,
      perfumesPostados,
      erro: err instanceof Error ? err.message : String(err),
      executadoEm: new Date().toISOString(),
    };
  }
  return ultimoResultado;
}

/** Só sincroniza dados (planilha <-> banco <-> painel) — NÃO posta nada no grupo do
 * WhatsApp. A planilha manda: nome/marca/composição/preço/foto/fragrantica/APC de
 * cada perfume são sempre regravados no banco a partir do que está na planilha
 * (estoque/status continuam sendo espelho do banco pra planilha, como sempre —
 * eles não têm "dono" na planilha, são derivados de venda/ajuste). Botão separado
 * do "Atualizar agora" pra quem só quer alinhar os dados sem disparar publicação. */
export async function sincronizarDados(): Promise<ResultadoSync> {
  try {
    await syncPerfumesFromSheet();
    await syncVendasManualFromSheet();
    ultimoResultadoDados = { ok: true, perfumesPostados: [], executadoEm: new Date().toISOString() };
  } catch (err) {
    console.error("Erro ao sincronizar dados:", err);
    ultimoResultadoDados = {
      ok: false,
      perfumesPostados: [],
      erro: err instanceof Error ? err.message : String(err),
      executadoEm: new Date().toISOString(),
    };
  }
  return ultimoResultadoDados;
}
