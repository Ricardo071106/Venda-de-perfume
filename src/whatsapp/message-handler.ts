import type { WAMessage } from "@whiskeysockets/baileys";
import { config } from "../config.js";
import { parseComandoVenda, parseLanceQuantidade, parseComandoApc, ehComandoCancelar } from "./commands.js";
import { buscarPerfumePorMensagemRespondida, registrarVendaWhatsApp } from "../services/vendas.js";
import { registrarLance, cancelarLances } from "../services/leilao.js";
import { enviarMensagemGrupo, enviarMensagemPrivada, enviarFotoNoGrupo } from "./baileys-client.js";

function extrairMensagem(msg: WAMessage): {
  remoteJid: string;
  participantJid: string;
  senderPhone: string;
  pushName: string;
  fromMe: boolean;
  texto: string | undefined;
  quotedMessageId: string | undefined;
} {
  const remoteJid = msg.key.remoteJid ?? "";
  const fromMe = Boolean(msg.key.fromMe);
  const participantJid = msg.key.participant ?? msg.key.remoteJid ?? "";
  const senderPhone = participantJid.split("@")[0];
  const pushName = msg.pushName ?? "";

  const texto = msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? undefined;
  const quotedMessageId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId ?? undefined;

  return { remoteJid, participantJid, senderPhone, pushName, fromMe, texto, quotedMessageId };
}

/** Processa cada mensagem recebida no WhatsApp. Sempre em reply a um perfume postado,
 * no grupo certo. Quatro comportamentos possíveis:
 * 1) Admin responde "vendi 5ml para Fulana por 50" -> registra venda manual/offline.
 * 2) Qualquer participante responde "cancelar" -> apaga todos os lances (normal e/ou
 *    APC) que ELE MESMO fez nesse perfume na rodada atual, devolve o ml ao estoque.
 * 3) Qualquer participante responde com a quantidade ("5", "5ml", "0,5l") -> lance
 *    normal (múltiplo de 3/5/10, respeitando o mínimo configurado).
 * 4) Qualquer participante responde "APC" (leva tudo que sobrar) ou "APC 50" (leva
 *    50ml especificamente) -> arremata o frasco físico original + caixa.
 * Lance válido: debita estoque, confirma no grupo marcando a pessoa, e manda o valor +
 * PIX + pedido de endereço no privado dela. Se esgotar, fecha com foto + lista de quem comprou. */
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

  if (dados.fromMe || !dados.texto) return;
  if (dados.remoteJid !== groupIdConfigurado) return;

  // "cancelar" é um comando explícito e inequívoco — vale a pena avisar quando não
  // deu certo, diferente de lance/APC (que ficam quietos pra não responder qualquer
  // mensagem solta do grupo). Sem reply nenhum: não dá pra saber qual perfume é.
  if (ehComandoCancelar(dados.texto) && !dados.quotedMessageId) {
    await enviarMensagemGrupo(
      `❌ @${dados.senderPhone}, pra cancelar, *responda* (reply) direto na mensagem/foto do perfume que você quer cancelar — não dá pra saber qual é só pelo "cancelar" solto.`,
      [dados.participantJid]
    );
    return;
  }

  if (!dados.quotedMessageId) return;

  // 1) Comando de admin (venda manual/offline) — frase completa, só de números autorizados.
  if (config.adminPhoneNumbers.includes(dados.senderPhone)) {
    const comando = parseComandoVenda(dados.texto);
    if (comando) {
      const perfume = await buscarPerfumePorMensagemRespondida(dados.quotedMessageId);
      if (!perfume) {
        console.warn("Comando de venda recebido, mas não achei o perfume da mensagem respondida.");
        return;
      }
      await registrarVendaWhatsApp(perfume, comando);
      console.log(`Venda registrada via WhatsApp: ${comando.mlVendido}ml de "${perfume.nome}" para ${comando.clienteNome}`);
      return;
    }
  }

  // 2) Cancelar — some com todos os lances (normal e/ou APC) que essa pessoa fez
  // nesse perfume, na rodada atual, e devolve o ml ao estoque.
  if (ehComandoCancelar(dados.texto)) {
    const perfumeCancelar = await buscarPerfumePorMensagemRespondida(dados.quotedMessageId);
    if (!perfumeCancelar) {
      // Respondeu a alguma mensagem, mas não é o post de um perfume — avisa em vez
      // de ficar quieto, já que "cancelar" é um comando explícito.
      await enviarMensagemGrupo(
        `❌ @${dados.senderPhone}, não achei nenhum perfume nessa mensagem — responda direto na foto/post do perfume que você quer cancelar.`,
        [dados.participantJid]
      );
      return;
    }

    const resultadoCancelamento = await cancelarLances({
      perfumeId: perfumeCancelar.id,
      perfumeNome: perfumeCancelar.nome,
      postadoEm: perfumeCancelar.postado_em,
      compradorTelefone: dados.senderPhone,
    });
    await enviarMensagemGrupo(resultadoCancelamento.mensagemGrupo, [dados.participantJid]);
    console.log(
      resultadoCancelamento.ok
        ? `Cancelamento registrado de "${perfumeCancelar.nome}" para ${dados.senderPhone}`
        : `Cancelamento recusado de "${perfumeCancelar.nome}" pedido por ${dados.senderPhone}: ${resultadoCancelamento.mensagemGrupo}`
    );
    return;
  }

  // 3) Lance no leilão (quantidade normal ou APC) — aberto a qualquer participante.
  const comandoApc = parseComandoApc(dados.texto);
  const quantidadeMl = comandoApc ? comandoApc.quantidadeMl : parseLanceQuantidade(dados.texto);
  if (!comandoApc && quantidadeMl === null) return; // não é lance nem comando de admin — ignora, é conversa normal

  const perfume = await buscarPerfumePorMensagemRespondida(dados.quotedMessageId);
  if (!perfume) return; // reply a outra mensagem qualquer, não a um post de perfume

  const resultado = await registrarLance({
    perfume: {
      id: perfume.id,
      nome: perfume.nome,
      estoqueMl: Number(perfume.estoque_ml),
      precoMl: Number(perfume.preco_ml),
      estoqueInicialLeilao: perfume.estoque_inicial_leilao !== null ? Number(perfume.estoque_inicial_leilao) : null,
      postadoEm: perfume.postado_em,
      apcDisponivel: perfume.apc_disponivel,
      apcPreco: perfume.apc_preco !== null ? Number(perfume.apc_preco) : null,
      mlFrasco: Number(perfume.ml_frasco),
      apcMlMinimo: perfume.apc_ml_minimo !== null ? Number(perfume.apc_ml_minimo) : null,
    },
    tipo: comandoApc ? "apc" : "quantidade",
    quantidadeMl: quantidadeMl ?? undefined,
    compradorJid: dados.participantJid,
    compradorTelefone: dados.senderPhone,
    compradorNome: dados.pushName || dados.senderPhone,
  });

  await enviarMensagemGrupo(resultado.mensagemGrupo, [resultado.mentionJid]);
  for (const marco of resultado.mensagensMarco) {
    await enviarMensagemGrupo(marco);
  }
  if (resultado.mensagemEsgotado) {
    // Fecha com a mesma foto do anúncio original, se tiver — fica mais bonito que só texto.
    if (perfume.foto_url) {
      await enviarFotoNoGrupo({ fotoUrl: perfume.foto_url, legenda: resultado.mensagemEsgotado });
    } else {
      await enviarMensagemGrupo(resultado.mensagemEsgotado);
    }
  }
  if (resultado.mensagemPrivada) {
    await enviarMensagemPrivada(dados.participantJid, resultado.mensagemPrivada);
  }

  console.log(
    resultado.ok
      ? `Lance registrado (${comandoApc ? `APC${quantidadeMl ? ` ${quantidadeMl}ml` : ""}` : `${quantidadeMl}ml`}) de "${perfume.nome}" para ${dados.senderPhone}`
      : `Lance recusado de "${perfume.nome}" pedido por ${dados.senderPhone}: ${resultado.mensagemGrupo}`
  );
}
