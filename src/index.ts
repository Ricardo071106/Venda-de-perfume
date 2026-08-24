import { rodarSync } from "./services/sync.js";
import { iniciarWhatsApp } from "./whatsapp/baileys-client.js";
import { tratarMensagemRecebida } from "./whatsapp/message-handler.js";
import { iniciarPainelAdmin } from "./web/server.js";

async function main() {
  // O painel sobe primeiro e sozinho: não pode ficar refém de o WhatsApp conectar
  // (rede lenta, QR pendente, falha) — senão o serviço nunca responde no Render.
  iniciarPainelAdmin();

  iniciarWhatsApp(tratarMensagemRecebida).catch((err) => {
    console.error("Falha ao conectar ao WhatsApp:", err);
  });

  await rodarSync(); // roda uma vez ao subir; depois só via botão "Atualizar agora" do painel
}

main().catch((err) => {
  console.error("Falha ao iniciar:", err);
  process.exit(1);
});
