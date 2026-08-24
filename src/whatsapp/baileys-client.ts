import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcodeTerminal from "qrcode-terminal";
import pino from "pino";
import { config } from "../config.js";

const logger = pino({ level: "silent" });

let sock: WASocket | null = null;

export type OnMensagem = (msg: WAMessage) => void | Promise<void>;

/** Abre a conexão com o WhatsApp. Na primeira vez, imprime o QR code no terminal
 * pra escanear com o número dedicado do bot. Nas próximas, reusa a sessão salva
 * em config.whatsapp.authFolder e conecta sozinho, sem precisar escanear de novo. */
export async function iniciarWhatsApp(onMensagem: OnMensagem): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(config.whatsapp.authFolder);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({ version, auth: state, logger });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nEscaneie o QR code abaixo no WhatsApp do número do bot (Aparelhos conectados > Conectar um aparelho):\n");
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("WhatsApp conectado.");
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const deslogado = statusCode === DisconnectReason.loggedOut;
      console.warn(`Conexão com o WhatsApp caiu (status ${statusCode}).`);
      if (deslogado) {
        console.error(
          `Sessão desconectada pelo próprio WhatsApp — apague a pasta "${config.whatsapp.authFolder}" e rode de novo pra escanear o QR code.`
        );
      } else {
        console.log("Tentando reconectar...");
        iniciarWhatsApp(onMensagem).catch((err) => console.error("Falha ao reconectar:", err));
      }
    }
  });

  sock.ev.on("messages.upsert", ({ messages }) => {
    for (const msg of messages) {
      Promise.resolve(onMensagem(msg)).catch((err) =>
        console.error("Erro processando mensagem recebida:", err)
      );
    }
  });
}

export async function enviarFotoNoGrupo(params: {
  fotoUrl: string;
  legenda: string;
}): Promise<{ messageId: string }> {
  if (!sock) {
    throw new Error("WhatsApp ainda não conectado — tente novamente no próximo ciclo de sync.");
  }
  const enviado = await sock.sendMessage(config.whatsapp.groupId, {
    image: { url: params.fotoUrl },
    caption: params.legenda,
  });
  const messageId = enviado?.key?.id;
  if (!messageId) {
    throw new Error("WhatsApp não retornou o id da mensagem enviada.");
  }
  return { messageId };
}

export function montarLegendaPerfume(p: {
  nome: string;
  marca: string;
  composicao: string;
  mlFrasco: number;
  estoqueMl: number;
  precoMl: number;
  fragranticaUrl?: string;
}): string {
  const linhas = [
    `*${p.nome}*${p.marca ? ` (${p.marca})` : ""}`,
    "",
    `💰 *R$${p.precoMl.toFixed(2)}/ml*`,
    `📦 *Disponível: ${p.estoqueMl}ml* (frasco de ${p.mlFrasco}ml)`,
    p.composicao ? `\n🌸 ${p.composicao}` : null,
    p.fragranticaUrl ? `\n🔗 Fragrantica:\n${p.fragranticaUrl}` : null,
  ];
  return linhas.filter((l) => l !== null).join("\n");
}
