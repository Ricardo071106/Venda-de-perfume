import { rodarSync } from "./services/sync.js";
import { iniciarWhatsApp } from "./whatsapp/baileys-client.js";
import { tratarMensagemRecebida } from "./whatsapp/message-handler.js";
import { iniciarPainelAdmin } from "./web/server.js";

async function main() {
  await iniciarWhatsApp(tratarMensagemRecebida);
  iniciarPainelAdmin();
  await rodarSync(); // roda uma vez ao subir; depois só via botão "Atualizar agora" do painel
}

main().catch((err) => {
  console.error("Falha ao iniciar:", err);
  process.exit(1);
});
