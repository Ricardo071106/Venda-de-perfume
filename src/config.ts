import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
}

// Cada seção só valida suas variáveis quando é efetivamente acessada (getters),
// não no import do módulo — assim um script que só usa Sheets (ex: setup-sheets)
// não quebra por falta de variáveis do WhatsApp que ainda não foram preenchidas.
export const config = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },

  google: {
    // Local: aponta pro arquivo baixado do Google Cloud. Produção (Render): em vez de
    // subir um arquivo, cole o conteúdo dele em base64 numa variável de ambiente comum —
    // client.ts usa qual dos dois estiver preenchido (base64 tem prioridade).
    get serviceAccountJsonPath() {
      return process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH || null;
    },
    get serviceAccountJsonBase64() {
      return process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || null;
    },
    get spreadsheetId() {
      return required("GOOGLE_SPREADSHEET_ID");
    },
  },

  whatsapp: {
    get groupId() {
      return required("WHATSAPP_GROUP_ID");
    },
    // Pasta onde o Baileys guarda a sessão autenticada (credenciais), pra não
    // precisar escanear o QR code de novo a cada reinício.
    get authFolder() {
      return process.env.WHATSAPP_AUTH_FOLDER ?? "./auth_session";
    },
  },

  // Números autorizados a lançar vendas por comando no WhatsApp (formato: 5511999999999)
  get adminPhoneNumbers() {
    return (process.env.ADMIN_PHONE_NUMBERS ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
  },

  web: {
    // O Render define PORT sozinho em produção; localmente usa 3000 por padrão.
    get port() {
      return Number(process.env.PORT ?? 3000);
    },
    get authUser() {
      return process.env.ADMIN_PANEL_USER ?? "admin";
    },
    get authPassword() {
      return required("ADMIN_PANEL_PASSWORD");
    },
  },
};
