# Perfume ML Bot

Sincroniza Google Sheets ↔ Postgres ↔ grupo de WhatsApp (via Baileys) para vender perfumes fracionados por ml.

## Arquitetura

```
Google Sheets (Perfumes / Vendas / Financeiro)
        ⇅ (sync ao subir + sob demanda, botão "Atualizar agora")
   Serviço Node/TS (este projeto) ── Painel administrativo (site)
        ⇅
   Postgres/Supabase (fonte da verdade)
        ⇅
   WhatsApp (Baileys, em processo) ⇄ Grupo do WhatsApp
```

- A planilha é a interface humana: cadastro de perfume (com foto) e lançamento manual de venda.
- O WhatsApp é a segunda via de venda: o admin responde à foto do perfume postado com `vendi 5ml para Maria por 50` e o bot registra a venda no banco e ecoa uma linha na aba Vendas.
- Postgres é sempre a fonte da verdade; o bot só faz *append* de linhas novas na aba Vendas e só escreve a coluna de controle "postado" na aba Perfumes — nunca sobrescreve o que a pessoa digitou.
- A conexão com o WhatsApp usa **Baileys** direto (a mesma lib por trás do Evolution API), rodando dentro deste próprio processo Node — sem container nem API HTTP separada. Na primeira vez, escaneia-se um QR code impresso no terminal; depois disso, a sessão fica salva em `auth_session/` e reconecta sozinha.
- **Não sincroniza mais sozinho a cada 2 minutos.** A sincronização roda uma vez quando o serviço sobe, e depois só quando alguém clica em **"Atualizar agora"** no painel administrativo (site embutido neste mesmo serviço, com KPIs, gráficos de vendas/estoque e a lista de vendas recentes).

## Pré-requisitos (a fazer manualmente antes de rodar)

1. **Criar o grupo no WhatsApp** — feito manualmente no app por quem vai administrar.
2. **Número de WhatsApp dedicado ao bot** — recomendado usar um chip separado (não o número pessoal). É o mesmo caminho usado no projeto Zelar.
3. **Google Cloud**: criar um projeto, habilitar a "Google Sheets API", criar uma Service Account, baixar o JSON de credenciais e salvar como `service-account.json` na raiz do projeto (ou noutro caminho, ajustando `GOOGLE_SERVICE_ACCOUNT_JSON_PATH`). Compartilhar a planilha com o e-mail da service account (`...@...iam.gserviceaccount.com`) como Editor.
4. **Planilha do Google Sheets**: criar com 3 abas — `Perfumes`, `Vendas`, `Financeiro` — nos formatos descritos abaixo. Pegar o ID da planilha (na URL) para `GOOGLE_SPREADSHEET_ID`.
5. **Node 20+**: o projeto usa `.nvmrc` (rode `nvm use` antes de instalar/rodar).

## Estrutura da planilha

### Aba "Perfumes" (colunas A–O, cabeçalho na linha 1)
`id | nome | marca | composição | foto_url | ml_frasco | preço_ml | custo_ml | estoque_ml | status | postar_no_grupo | postado | repor_ml | fragrantica_url | apc_disponivel`

- `id`, `postado` são preenchidos automaticamente pelo bot — deixar em branco ao cadastrar.
- `foto_url` deve ser um link público (ex: link de compartilhamento do Google Drive com permissão "qualquer pessoa com o link").
- `postar_no_grupo`: marcar `TRUE` quando quiser que o bot poste esse perfume no grupo.
- `estoque_ml` e `status`: **espelho do banco, não edite direto** — o bot regrava esses valores a cada ciclo de sync com o que está no Postgres (que é sempre a fonte da verdade). Editar aqui manualmente não tem efeito: no próximo ciclo o bot sobrescreve de volta com o valor real do banco.
- `repor_ml`: use esta coluna para adicionar estoque (reposição). Digite a quantidade que entrou; o bot soma no banco, registra o movimento e limpa a célula sozinho.
- `fragrantica_url`: opcional, link da página do perfume no Fragrantica — aparece no post do grupo (formato inspirado no grupo "Privé SPLITS", usado como referência visual).
- `apc_disponivel`: escreva `TRUE` pra habilitar o APC (arrematar o frasco físico + caixa original, respondendo *APC* no grupo) desse perfume, ou deixe em branco/`FALSE` pra desabilitar. Mesmo campo editável no painel — planilha e painel se atualizam um ao outro a cada sync.
- Se um perfume já postado tiver algum desses campos alterado (nome, marca, composição, ml, preço, foto ou Fragrantica), o bot publica uma **mensagem nova** no grupo no próximo sync, refletindo a mudança.

### Aba "Vendas" (colunas A–I)
`id | perfume | cliente | telefone | ml_vendido | valor_total | forma_pagamento | data | origem`

- Lançamento manual: preencher `perfume` (nome exatamente como está na aba Perfumes), `cliente`, `ml_vendido`, `valor_total` — deixar `id` e `origem` em branco. O bot preenche o `id` depois de processar.
- Linhas com `origem = whatsapp_bot` foram criadas automaticamente a partir de uma venda registrada no grupo.

### Aba "Financeiro"
Aba de fórmulas nativas do Sheets (não escrita pelo bot), por exemplo:
```
=QUERY(Vendas!A2:I, "select B, sum(F) where B is not null group by B label sum(F) 'Receita'")
```
Combinar com `custo_ml` da aba Perfumes (via `VLOOKUP`/`ARRAYFORMULA`) para calcular custo e lucro por perfume/período.

## Rodando localmente

```bash
cp .env.example .env
# editar .env com suas credenciais (o banco já é o Supabase, ver guia no .env)

nvm use              # garante Node 20+ (necessário pro Baileys)
npm install
npm run migrate      # aplica db/schema.sql no Supabase
npm run dev          # inicia o serviço (sync + conexão com o WhatsApp)
```

Ao rodar `npm run dev` pela primeira vez, um QR code aparece no terminal. Escaneie com o WhatsApp do número dedicado do bot (Configurações > Aparelhos conectados > Conectar um aparelho). A sessão fica salva em `auth_session/` — não precisa escanear de novo nas próximas vezes.

Pegar o ID do grupo: com o WhatsApp já conectado, mande qualquer mensagem no grupo e veja o log no terminal (ou adicione um `console.log(msg.key.remoteJid)` temporário em `tratarMensagemRecebida`) — o formato é `xxxxx-xxxxx@g.us`. Copie para `WHATSAPP_GROUP_ID` no `.env` e reinicie.

Painel administrativo: abra `http://localhost:3000` no navegador (usuário/senha vêm de `ADMIN_PANEL_USER`/`ADMIN_PANEL_PASSWORD` no `.env`).

## Deploy em produção (Render)

1. Crie um **Web Service** no Render apontando pro repositório deste projeto.
   - Build command: `npm install && npm run build`
   - Start command: `npm run start`
   - Ambiente: Node 20+ (o Render lê o `.nvmrc`/`engines` automaticamente, mas confirme nas configurações do serviço)
2. Configure as variáveis de ambiente do `.env` nas "Environment Variables" do serviço no Render (`DATABASE_URL`, `GOOGLE_SPREADSHEET_ID`, `WHATSAPP_GROUP_ID`, `ADMIN_PHONE_NUMBERS`, `ADMIN_PANEL_USER`, `ADMIN_PANEL_PASSWORD` etc.). **Não configure `PORT`** — o Render define isso sozinho.
3. `GOOGLE_SERVICE_ACCOUNT_JSON_PATH`: como o Render não tem o arquivo `service-account.json` (ele não vai pro Git), use o recurso de **"Secret Files"** do Render — cole o conteúdo do JSON lá, defina o caminho onde ele é gravado no disco do serviço, e aponte `GOOGLE_SERVICE_ACCOUNT_JSON_PATH` pra esse mesmo caminho. Não precisa mudar nada no código.
4. **Sessão do WhatsApp (`auth_session/`) precisa de disco persistente**: no Render, isso significa adicionar um **Persistent Disk** ao serviço e apontar `WHATSAPP_AUTH_FOLDER` pra dentro dele. Sem isso, a cada deploy o disco reseta e é preciso escanear o QR code de novo.
5. Depois do primeiro deploy, o Render te dá um endereço público (algo como `https://perfume-ml-bot.onrender.com`) — é nele que o painel administrativo fica disponível. Pra escanear o QR code na primeira conexão, acompanhe os **logs** do serviço no painel do Render (é lá que o QR em ASCII aparece, já que não tem terminal interativo em produção).

## Notas importantes

- **Segurança do comando de venda via WhatsApp**: só processa mensagens de números listados em `ADMIN_PHONE_NUMBERS`, para evitar que qualquer pessoa do grupo registre vendas falsas.
- **Segurança do painel**: fica num endereço público, então é protegido por usuário/senha (Basic Auth). Troque a senha padrão gerada no `.env` antes de subir pra produção.
- **Sessão do WhatsApp é um dispositivo vinculado**: aparece em "Aparelhos conectados" no celular do número usado. Se for desconectada por lá (ou o WhatsApp expirar a sessão), é preciso apagar a pasta `auth_session/` e escanear o QR code de novo.
