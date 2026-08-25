# Guia detalhado: conectar o Google Sheets

Isso tem duas partes: (1) criar uma "conta de serviço" no Google Cloud, que é
o robô que vai ler/escrever na sua planilha, e (2) preparar a planilha em si
com as abas certas.

## Parte 1 — Criar a conta de serviço no Google Cloud

### Passo 1: Criar o projeto
1. Acesse **console.cloud.google.com** e faça login com sua conta Google (a
   mesma dona da planilha, de preferência).
2. No topo da página, do lado do logo "Google Cloud", tem um seletor de
   projeto (geralmente escrito "Selecionar um projeto" ou o nome de um
   projeto existente). Clique nele.
3. Clique em **"Novo Projeto"** no canto superior direito da janela que abrir.
4. Dê um nome, por exemplo `perfume-bot`. Pode deixar organização/local como
   estão. Clique em **"Criar"**.
5. Espere uns 10-20 segundos até aparecer uma notificação (sino no topo)
   dizendo que o projeto foi criado. Clique nele e depois em "Selecionar
   projeto" pra garantir que esse projeto novo está ativo (o nome dele deve
   aparecer no seletor do topo).

### Passo 2: Ativar a API do Google Sheets
1. Com o projeto `perfume-bot` selecionado, use a barra de busca no topo da
   página (ícone de lupa) e digite **"Google Sheets API"**.
2. Clique no resultado "Google Sheets API".
3. Clique no botão azul **"Ativar"** (Enable). Espere carregar.

### Passo 3: Criar a conta de serviço
1. Ainda na barra de busca do topo, digite **"Credenciais"** (Credentials) e
   clique no resultado dentro de "APIs e Serviços".
2. Clique em **"+ Criar Credenciais"** (no topo da página) e escolha
   **"Conta de serviço"** (Service account) no menu que aparecer.
3. Em "Nome da conta de serviço", digite `perfume-bot`. Os outros campos
   preenchem sozinhos. Clique em **"Concluir"** (não precisa mexer nas
   próximas telas de permissão/acesso, pode pular clicando em "Continuar"
   e depois "Concluído").

### Passo 4: Gerar a chave (arquivo JSON)
1. Na lista de credenciais, na seção "Contas de serviço", clique no
   e-mail da conta que você acabou de criar (algo como
   `perfume-bot@perfume-bot-123456.iam.gserviceaccount.com`).
2. Clique na aba **"Chaves"** (Keys), no topo dessa página.
3. Clique em **"Adicionar Chave"** > **"Criar nova chave"**.
4. Escolha o tipo **JSON** e clique em **"Criar"**.
5. Um arquivo `.json` vai baixar automaticamente para a pasta Downloads do
   seu Mac (nome parecido com `perfume-bot-123456-a1b2c3d4e5f6.json`).

### Passo 5: Colocar a chave no projeto
1. Renomeie esse arquivo baixado para `service-account.json`.
2. Mova ele para dentro da pasta `~/Desktop/perfume-ml-bot/` (a raiz do
   projeto, do lado do arquivo `.env`).
   - Pelo Finder: arraste o arquivo da pasta Downloads pra dentro da pasta
     `perfume-ml-bot` no Desktop.
3. Guarde também o e-mail dessa conta de serviço (está dentro do JSON, no
   campo `"client_email"`, e também aparece na lista de credenciais) —
   vai precisar dele no próximo passo.

**Esse arquivo é uma senha — nunca compartilhe nem suba pro GitHub.** Já
deixei ele no `.gitignore` do projeto, então mesmo que você suba o código
pro GitHub, esse arquivo não vai junto.

## Parte 2 — Preparar a planilha

### Passo 1: Compartilhar com a conta de serviço
1. Abra sua planilha no Google Sheets.
2. Clique no botão azul **"Compartilhar"** no canto superior direito.
3. Cole o e-mail da conta de serviço (do passo 5 acima,
   `...@...iam.gserviceaccount.com`).
4. Deixe a permissão como **"Editor"**.
5. Desmarque a opção de notificar por e-mail (é um robô, não precisa
   avisar) e clique em **"Compartilhar"**/"Enviar".

### Passo 2: Pegar o ID da planilha
1. Olhe a URL da sua planilha no navegador. Ela tem esse formato:
   `https://docs.google.com/spreadsheets/d/AQUI_ESTA_O_ID/edit#gid=0`
2. Copie só o trecho entre `/d/` e `/edit` — isso é o `GOOGLE_SPREADSHEET_ID`.

### Passo 3: Criar as 3 abas com as colunas certas
Na parte de baixo da planilha, clique no `+` pra criar aba nova, e renomeie
clicando duas vezes no nome. Precisa ter exatamente estas 3 abas (nomes
exatos, com maiúscula igual abaixo):

**Aba "Perfumes"** — cole isso na célula A1 e aperte Enter (o Sheets separa
automaticamente em colunas por causa dos tabs, mas se não separar, digite
cada nome numa célula da linha 1, de A a N):
```
id	nome	marca	composição	foto_url	ml_frasco	preço_ml	custo_ml	estoque_ml	status	postar_no_grupo	postado	repor_ml	fragrantica_url
```
- Deixe as colunas `id` e `postado` em branco ao cadastrar um perfume novo —
  quem preenche é o bot, automaticamente.
- `foto_url`: link público da foto. Jeito mais fácil: suba a foto pro Google
  Drive, clique com botão direito nela > "Compartilhar" > mude para
  "Qualquer pessoa com o link" > copie o link e cole aqui.
- `postar_no_grupo`: escreva `TRUE` quando quiser que aquele perfume seja
  postado no grupo do WhatsApp.
- `estoque_ml` e `status`: **não edite direto**, são só espelho do banco de
  dados — o bot regrava esses valores sozinho a cada sincronização.
- `repor_ml`: pra dar entrada de estoque, escreva aqui a quantidade que
  chegou. O bot soma no banco e limpa a célula automaticamente no ciclo
  seguinte.
- `fragrantica_url`: opcional — cole o link da página do perfume no
  Fragrantica (fragrantica.com.br) e ele aparece no post do grupo.
- Editou nome, marca, composição, ml, preço, foto ou Fragrantica de um
  perfume que já foi postado? No próximo "Atualizar agora" o bot manda uma
  mensagem nova no grupo com a informação atualizada.

**Aba "Vendas"** (linha 1, colunas A a I):
```
id	perfume	cliente	telefone	ml_vendido	valor_total	forma_pagamento	data	origem
```
- Pra lançar uma venda manual: preencha `perfume` (o nome exatamente igual
  ao que está escrito na aba Perfumes), `cliente`, `ml_vendido`,
  `valor_total`. Deixe `id` e `origem` em branco.

**Aba "Financeiro"**: essa você monta do seu jeito com fórmulas do Sheets
puxando dados das outras abas (o bot não escreve nada nela). Um exemplo de
fórmula que soma receita por perfume, pra colocar numa célula:
```
=QUERY(Vendas!A2:I, "select B, sum(F) where B is not null group by B label sum(F) 'Receita'")
```

## Checklist final
- [ ] Projeto criado no Google Cloud
- [ ] Google Sheets API ativada
- [ ] Conta de serviço criada
- [ ] Arquivo `service-account.json` baixado e movido pra dentro de
      `~/Desktop/perfume-ml-bot/`
- [ ] Planilha compartilhada com o e-mail da conta de serviço, como Editor
- [ ] `GOOGLE_SPREADSHEET_ID` copiado da URL e colado no `.env`
- [ ] As 3 abas criadas com os nomes e colunas certos
