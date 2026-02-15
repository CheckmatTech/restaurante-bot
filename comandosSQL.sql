-- comandosSQL.sql
-- Cria/ajusta todas as tabelas necessárias para o painel admin profissional

CREATE TABLE IF NOT EXISTS clientes (
  id SERIAL PRIMARY KEY,
  telefone VARCHAR(32) UNIQUE NOT NULL,
  nome VARCHAR(100),
  etapa VARCHAR(50) DEFAULT 'start',
  criado_em TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cardapio (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(200) UNIQUE NOT NULL,
  preco NUMERIC(10,2) NOT NULL DEFAULT 0,
  descricao TEXT,
  categoria VARCHAR(50) DEFAULT 'prato',
  ativo BOOLEAN DEFAULT true,
  criado_em TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pedidos (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_telefone VARCHAR(32),
  itens TEXT,
  total NUMERIC(10,2) DEFAULT 0,
  status VARCHAR(50) DEFAULT 'pendente',
  payment_method VARCHAR(50),
  forma_pagamento VARCHAR(50),
  criado_em TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
  menu_item_id INTEGER REFERENCES cardapio(id) ON DELETE SET NULL,
  qty INTEGER DEFAULT 1,
  price NUMERIC(10,2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS itens_pedido (
  id SERIAL PRIMARY KEY,
  pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
  nome_item VARCHAR(200) NOT NULL,
  preco NUMERIC(10,2) NOT NULL,
  quantidade INTEGER DEFAULT 1,
  criado_em TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  email VARCHAR(150) UNIQUE NOT NULL,
  name VARCHAR(100),
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'manager',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Ajustes para quem já tinha a tabela sem categoria/ativo
ALTER TABLE cardapio ADD COLUMN IF NOT EXISTS categoria VARCHAR(50) DEFAULT 'prato';
ALTER TABLE cardapio ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT true;

-- Índices úteis
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_clientes_telefone ON clientes(telefone);
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);

-- Exemplos (somente se a tabela cardapio estiver vazia)
INSERT INTO cardapio (nome, preco, categoria) VALUES
('X-Burger', 25.00, 'prato'),
('Lasanha', 30.00, 'prato'),
('Refrigerante 350ml', 6.00, 'bebida'),
('Água 500ml', 4.00, 'bebida')
ON CONFLICT (nome) DO NOTHING;
