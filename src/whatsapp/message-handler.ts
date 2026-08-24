import type { WAMessage } from "@whiskeysockets/baileys";
import { config } from "../config.js";
import { parseComandoVenda } from "./commands.js";
import { buscarPerfumePorMensagemRespondida, registrarVendaWhatsApp } from "../services/vendas.js";

function extrairMensagem(msg: WAMessage): {
  remoteJid: string;
  senderPhone: string;
  fromMe: boolean;
  texto: string | undefined;
  quotedMessageId: string | undefined;
} {
  const remoteJid = msg.key.remoteJid ?? "";
  const fromMe = Boolean(msg.key.fromMe);
  const participant = msg.key.participant ?? msg.key.remoteJid ?? "";
  const senderPhone = participant.split("@")[0];

  const texto = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? undefined;
  const quotedMessageId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId ?? undefined;

  return { remoteJid, senderPhone, fromMe, texto, quotedMessageId };
}

/** Processa cada mensagem recebida no WhatsApp: só age em reply a um perfume
 * postado, no grupo certo, vindo de um número autorizado, com o formato de
 * comando de venda reconhecido (ver whatsapp/commands.ts). */
export async function tratarMensagemRecebida(msg: WAMessage): Promise<void> {
  const dados = extrairMensagem(msg);
  if (!dados.remoteJid) return;

  // WHATSAPP_GROUP_ID ainda não configurado: em vez de travar (config.whatsapp.groupId
  // lançaria erro), loga o remoteJid de toda mensagem recebida — inclusive as suas
  // próprias (fromMe), já que testar mandando pelo número do próprio bot é comum.
  // É assim que você descobre o ID certo pra colar no .env/Render.
  const groupIdConfigurado = process.env.WHATSAPP_GROUP_ID?.trim();
  if (!groupIdConfigurado) {
    console.log(`[setup] Mensagem recebida em "${dados.remoteJid}" — se for o grupo certo, copie esse valor pro WHATSAPP_GROUP_ID.`);
    return;
  }

  if (dados.fromMe || !dados.texto || !dados.quotedMessageId) return;
  if (dados.remoteJid !== groupIdConfigurado) return;
  if (!config.adminPhoneNumbers.includes(dados.senderPhone)) return;

  const comando = parseComandoVenda(dados.texto);
  if (!comando) return;

  const perfume = await buscarPerfumePorMensagemRespondida(dados.quotedMessageId);
  if (!perfume) {
    console.warn("Comando de venda recebido, mas não achei o perfume da mensagem respondida.");
    return;
  }

  await registrarVendaWhatsApp(perfume, comando);
  console.log(`Venda registrada via WhatsApp: ${comando.mlVendido}ml de "${perfume.nome}" para ${comando.clienteNome}`);
}
