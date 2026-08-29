-- Schema: venda de perfumes a ml via WhatsApp
-- Postgres é a fonte única da verdade; painel web e WhatsApp são interfaces de entrada.
-- (sheet_row e a origem 'manual_planilha' em vendas.origem são vestígios da época em
-- que uma planilha Google Sheets fazia parte do fluxo — abandonada; mantidos só pra
-- não quebrar histórico já gravado, não é mais escrito por nada no código atual.)

CREATE TABLE IF NOT EXISTS perfumes (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    marca TEXT,
    composicao TEXT,
    foto_url TEXT,
    fragrantica_url TEXT,
    ml_frasco NUMERIC(10, 2) NOT NULL,
    preco_ml NUMERIC(10, 2) NOT NULL,
    custo_ml NUMERIC(10, 2),
    estoque_ml NUMERIC(10, 2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'esgotado')),
    sheet_row INTEGER, -- linha correspondente na aba "Perfumes" do Sheets
    postado_em TIMESTAMPTZ, -- quando foi postado no grupo (NULL = ainda não postado)
    ultimo_conteudo_postado TEXT, -- retrato (nome/marca/composição/ml/preço/foto/fragrantica) da última vez que foi postado — usado pra saber se mudou algo e vale republicar
    estoque_inicial_leilao NUMERIC(10, 2), -- estoque no momento do post/reposição mais recente — base pra calcular as frações vendidas (1/4, 1/3, 1/2, 1/1) no leilão do WhatsApp
    apc_disponivel BOOLEAN NOT NULL DEFAULT false, -- true = tem opção de arrematar o frasco físico + caixa original
    apc_preco NUMERIC(10, 2), -- preço fixo cobrado no APC (não é ml x preço/ml) — null = usa o preço/ml normal como antes
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clientes (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    telefone TEXT,
    observacoes TEXT
);

CREATE TABLE IF NOT EXISTS vendas (
    id SERIAL PRIMARY KEY,
    perfume_id INTEGER NOT NULL REFERENCES perfumes(id),
    cliente_id INTEGER REFERENCES clientes(id),
    ml_vendido NUMERIC(10, 2) NOT NULL,
    valor_total NUMERIC(10, 2) NOT NULL,
    forma_pagamento TEXT,
    origem TEXT NOT NULL CHECK (origem IN ('manual_planilha', 'whatsapp_bot', 'painel_web')),
    data TIMESTAMPTZ NOT NULL DEFAULT now(),
    sheet_row INTEGER -- linha correspondente na aba "Vendas" do Sheets, se aplicável
);

CREATE TABLE IF NOT EXISTS estoque_movimentos (
    id SERIAL PRIMARY KEY,
    perfume_id INTEGER NOT NULL REFERENCES perfumes(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'saida', 'ajuste')),
    ml NUMERIC(10, 2) NOT NULL,
    motivo TEXT,
    data TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts_grupo (
    id SERIAL PRIMARY KEY,
    perfume_id INTEGER NOT NULL REFERENCES perfumes(id),
    whatsapp_message_id TEXT NOT NULL UNIQUE,
    data_postagem TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Configurações globais editáveis pelo painel (chave PIX, texto de endereço etc — não é por perfume).
CREATE TABLE IF NOT EXISTS configuracoes (
    chave TEXT PRIMARY KEY,
    valor TEXT
);

-- Idempotente: garante a coluna em bancos que já rodaram uma versão anterior deste schema.
ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS fragrantica_url TEXT;
ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS ultimo_conteudo_postado TEXT;

-- Idempotente: bancos criados antes da venda pelo painel só aceitavam 'manual_planilha'/'whatsapp_bot'.
ALTER TABLE vendas DROP CONSTRAINT IF EXISTS vendas_origem_check;
ALTER TABLE vendas ADD CONSTRAINT vendas_origem_check CHECK (origem IN ('manual_planilha', 'whatsapp_bot', 'painel_web'));

-- Idempotente: remove o conceito de fornecedor (não é mais usado).
ALTER TABLE perfumes DROP COLUMN IF EXISTS fornecedor_id;
DROP TABLE IF EXISTS fornecedores;

-- Idempotente: garante a coluna em bancos que já rodaram uma versão anterior deste schema.
ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS estoque_inicial_leilao NUMERIC(10, 2);

-- Idempotente: troca apc_ml/apc_preco (preço especial configurado) por um simples
-- liga/desliga — o preço do APC passou a ser sempre o preço/ml normal.
ALTER TABLE perfumes DROP COLUMN IF EXISTS apc_ml;
ALTER TABLE perfumes DROP COLUMN IF EXISTS apc_preco;
ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS apc_disponivel BOOLEAN NOT NULL DEFAULT false;

-- Idempotente: reintroduz apc_preco — dessa vez um preço FIXO pro APC (não proporcional
-- a nenhum outro campo), configurável junto com o resto do cadastro do perfume.
ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS apc_preco NUMERIC(10, 2);

-- Idempotente: "remover" um perfume com vendas/movimentos ligados a ele não pode
-- apagar a linha de verdade (a FK bloqueia, e é assim que queremos — não perder
-- histórico financeiro). arquivado_em marca esse perfume como removido do
-- catálogo/painel sem tocar em nada do que já foi vendido.
ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS arquivado_em TIMESTAMPTZ;

-- Idempotente: mínimo de ml pro APC com quantidade específica ("APC 50"), configurável
-- por perfume. Vazio/nulo cai no padrão de 50% do vidro (ml_frasco).
ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS apc_ml_minimo NUMERIC(10, 2);

CREATE INDEX IF NOT EXISTS idx_vendas_perfume ON vendas(perfume_id);
CREATE INDEX IF NOT EXISTS idx_estoque_perfume ON estoque_movimentos(perfume_id);
CREATE INDEX IF NOT EXISTS idx_posts_grupo_msg ON posts_grupo(whatsapp_message_id);
