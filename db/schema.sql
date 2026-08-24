-- Schema: venda de perfumes a ml via WhatsApp
-- Postgres é a fonte da verdade; a planilha e o WhatsApp são interfaces de entrada.

CREATE TABLE IF NOT EXISTS fornecedores (
    id SERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    contato TEXT,
    observacoes TEXT,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
    fornecedor_id INTEGER REFERENCES fornecedores(id),
    estoque_ml NUMERIC(10, 2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'esgotado')),
    sheet_row INTEGER, -- linha correspondente na aba "Perfumes" do Sheets
    postado_em TIMESTAMPTZ, -- quando foi postado no grupo (NULL = ainda não postado)
    ultimo_conteudo_postado TEXT, -- retrato (nome/marca/composição/ml/preço/foto/fragrantica) da última vez que foi postado — usado pra saber se mudou algo e vale republicar
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

-- Idempotente: garante a coluna em bancos que já rodaram uma versão anterior deste schema.
ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS fragrantica_url TEXT;
ALTER TABLE perfumes ADD COLUMN IF NOT EXISTS ultimo_conteudo_postado TEXT;

-- Idempotente: bancos criados antes da venda pelo painel só aceitavam 'manual_planilha'/'whatsapp_bot'.
ALTER TABLE vendas DROP CONSTRAINT IF EXISTS vendas_origem_check;
ALTER TABLE vendas ADD CONSTRAINT vendas_origem_check CHECK (origem IN ('manual_planilha', 'whatsapp_bot', 'painel_web'));

CREATE INDEX IF NOT EXISTS idx_vendas_perfume ON vendas(perfume_id);
CREATE INDEX IF NOT EXISTS idx_estoque_perfume ON estoque_movimentos(perfume_id);
CREATE INDEX IF NOT EXISTS idx_posts_grupo_msg ON posts_grupo(whatsapp_message_id);
