import { syncPerfumesFromSheet, syncVendasManualFromSheet } from "../sheets/sync-from-sheet.js";
import { postarPerfumeNoGrupo } from "./perfumes.js";

export interface ResultadoSync {
  ok: boolean;
  perfumesPostados: string[];
  erro?: string;
  executadoEm: string;
}

let ultimoResultado: ResultadoSync | null = null;

export function obterUltimoResultadoSync(): ResultadoSync | null {
  return ultimoResultado;
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
