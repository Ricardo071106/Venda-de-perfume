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

function formatarPreco(v: number): string {
  return `R$${v.toFixed(2).replace(".", ",")}`;
}

function formatarMl(v: number): string {
  return Number.isInteger(v) ? `${v}ml` : `${v.toFixed(2)}ml`;
}

// Quantidades usadas pra montar a tabela de preço pronta na legenda — mesmos
// valores aceitos como lance (múltiplos de 3, 5 ou 10).
const QUANTIDADES_TABELA = [3, 5, 10];

export function montarLegendaPerfume(p: {
  nome: string;
  marca: string;
  composicao: string;
  mlFrasco: number;
  estoqueMl: number;
  precoMl: number;
  fragranticaUrl?: string;
  apcDisponivel?: boolean;
  apcPreco?: number | null;
  mlMinimo?: number;
  assinaturaMarca?: string;
}): string {
  const mlMinimo = p.mlMinimo ?? 3;
  const tabelaPreco = QUANTIDADES_TABELA.filter((q) => q >= mlMinimo && q <= p.estoqueMl)
    .map((q) => `${q}ml: ${formatarPreco(q * p.precoMl)}`)
    .join("\n");
  const linhaApc = p.apcDisponivel
    ? p.apcPreco
      ? `📦🚀 *APC (frasco + caixa original): ${formatarPreco(p.apcPreco)}*`
      : `📦🚀 *APC disponível!* (frasco + caixa original)`
    : null;

  const linhas = [
    `*${p.nome}*${p.marca ? ` (${p.marca})` : ""}`,
    "",
    `💰 *${formatarPreco(p.precoMl)}/ml*`,
    `📦 *Disponível: ${p.estoqueMl}ml* (frasco de ${p.mlFrasco}ml)`,
    p.composicao ? `\n🌸 ${p.composicao}` : null,
    p.fragranticaUrl ? `\n🔗 Fragrantica:\n${p.fragranticaUrl}` : null,
    tabelaPreco ? `\n-----------------------------\n${tabelaPreco}` : null,
    linhaApc,
    "-----------------------------",
    "",
    "✅ *Como comprar:*",
    `Responda esta mensagem com a quantidade em ml que quer (múltiplos de 3, 5 ou 10 — ex: *5ml* ou *5*). Mínimo: ${mlMinimo}ml.`,
    p.apcDisponivel
      ? `Ou responda *APC* pra levar o frasco + caixa original (tudo que sobrar) ou *APC 50* pra pedir uma quantidade específica dentro do vidro (mínimo de ${formatarMl(p.mlFrasco * 0.5)}, 50% do vidro).`
      : null,
    "Vamos te chamar no privado com o valor e a chave PIX.",
    "Se mudar de ideia, responda *cancelar* pra desfazer seu(s) lance(s) nesse perfume.",
    p.assinaturaMarca ? `\n${p.assinaturaMarca}` : null,
  ];
  return linhas.filter((l) => l !== null).join("\n");
}

/** Manda o aviso de "vai abrir o leilão" antes do post com foto — mensagem de texto
 * simples, sem imagem, só pra dar uma prévia de que a venda desse perfume vai começar.
 * mencionarTodos: se true, notifica todo mundo do grupo (equivalente ao "@all" nativo). */
export async function enviarAvisoLeilao(texto: string, mencionarTodos = false): Promise<void> {
  if (!sock) {
    throw new Error("WhatsApp ainda não conectado — tente novamente no próximo ciclo de sync.");
  }
  let mentions: string[] = [];
  if (mencionarTodos) {
    try {
      const metadata = await sock.groupMetadata(config.whatsapp.groupId);
      mentions = metadata.participants.map((p) => p.id);
    } catch (err) {
      console.warn("Não consegui buscar os participantes do grupo pra marcar @todos:", err);
    }
  }
  const textoFinal = mencionarTodos ? `${texto}\n\n@all` : texto;
  await sock.sendMessage(config.whatsapp.groupId, { text: textoFinal, mentions });
}

/** Manda uma mensagem de texto no grupo, opcionalmente marcando (@) participantes —
 * jids em `mentions` viram menção de verdade se o texto contiver "@<telefone>". */
export async function enviarMensagemGrupo(texto: string, mentions: string[] = []): Promise<void> {
  if (!sock) {
    throw new Error("WhatsApp ainda não conectado.");
  }
  await sock.sendMessage(config.whatsapp.groupId, { text: texto, mentions });
}

/** Manda uma mensagem privada (DM) pro jid de um participante do grupo. */
export async function enviarMensagemPrivada(jid: string, texto: string): Promise<void> {
  if (!sock) {
    throw new Error("WhatsApp ainda não conectado.");
  }
  await sock.sendMessage(jid, { text: texto });
}
