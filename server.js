require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const pool = require('./db');
const { twiml: { MessagingResponse } } = require('twilio');
const { gerarRespostaAgente } = require('./agente');

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'keyboard-cat',
  resave: false,
  saveUninitialized: false,
}));

app.set('view engine', 'ejs');


// ============================
// 🤖 WHATSAPP BOT - FLUXO CONVERSA
// ============================

// Extrai números da mensagem (ex: "1 2 3", "1 e 2", "quero o 1")
function extrairNumeros(texto) {
  return (texto.replace(/\s+e\s+/g, ' ').match(/\d+/g) || []).map(Number);
}

// Verifica se a mensagem é "sim" / "quero ver" / "claro" etc.
function querVerCardapio(msg) {
  const sim = /\b(sim|claro|quero|pode|mostra|mostrar|ver|manda|mandar|envia|enviar)\b/i;
  return sim.test(msg) && !/\b(n[aã]o|nao)\b/i.test(msg);
}

// Verifica se o cliente terminou de escolher pratos
function terminouPratos(msg) {
  return /\b(pronto|é isso|e isso|quero esses|só isso|só isso|finalizar|acabei)\b/i.test(msg) && !extrairNumeros(msg).length;
}

// Verifica se não quer bebida
function naoQuerBebida(msg) {
  return /\b(n[aã]o|nao|obrigad[oa]\s*(mas\s*)?n[aã]o|nada|dispenso|não quero)\b/i.test(msg);
}

// Verifica se confirmou o pedido
function confirmouPedido(msg) {
  return /\b(sim|est[aá] certo|correto|confirmo|pode ser)\b/i.test(msg) && !/\b(n[aã]o|nao)\b/i.test(msg);
}

// Envia resposta: tenta o agente de IA primeiro, senão usa o texto fixo
async function responder(twiml, opts, fallback) {
  const texto = await gerarRespostaAgente(opts);
  twiml.message(texto || fallback);
}

// Rota GET para testar se a URL do webhook está acessível (abrir no navegador ou Twilio)
app.get('/whatsapp', (req, res) => {
  res.type('text/plain').send('Webhook WhatsApp OK. Use POST para mensagens.');
});

app.post('/whatsapp', async (req, res) => {
  const mensagem = (req.body.Body || '').trim();
  const telefone = (req.body.From || '').replace('whatsapp:', '');
  console.log('[WhatsApp] Mensagem recebida de', telefone, ':', mensagem || '(vazia)');

  const twiml = new MessagingResponse();
  const mensagemLower = mensagem.toLowerCase();

  try {

    let cliente = await pool.query(
      'SELECT * FROM clientes WHERE telefone=$1',
      [telefone]
    );

    if (cliente.rows.length === 0) {
      cliente = await pool.query(
        'INSERT INTO clientes (telefone, etapa) VALUES ($1, $2) RETURNING *',
        [telefone, 'inicio']
      );
    }

    const clienteData = cliente.rows[0];

    // ---------- INÍCIO: qualquer mensagem → oferta do cardápio ----------
    if (clienteData.etapa === 'inicio') {
      await responder(twiml, {
        etapa: 'saudacao_inicial',
        mensagemCliente: mensagem,
        contexto: 'Cliente acabou de iniciar a conversa. Cumprimente e ofereça o cardápio da noite de forma acolhedora.',
      }, "Boa noite! 👋\n\nGostaria de ver nosso cardápio para essa noite?\n\nResponda *sim* ou *claro* para ver o cardápio.");
      await pool.query(
        'UPDATE clientes SET etapa=$1 WHERE id=$2',
        ['aguardando_cardapio', clienteData.id]
      );
    }

    // ---------- Cliente pediu para ver cardápio → mostrar PRATOS ----------
    else if (clienteData.etapa === 'aguardando_cardapio') {
      if (!querVerCardapio(mensagemLower)) {
        await responder(twiml, {
          etapa: 'aguardando_querer_cardapio',
          mensagemCliente: mensagem,
          contexto: 'Cliente ainda não pediu o cardápio. Convide com gentileza.',
        }, "Quando quiser ver o cardápio, é só dizer *sim* ou *claro*.");
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        return res.end(twiml.toString());
      }

      const pratos = await pool.query(
        "SELECT id, nome, preco FROM cardapio WHERE ativo=true AND (categoria='prato' OR categoria IS NULL) ORDER BY id"
      );
      const listaPratos = pratos.rows.map(p =>
        `${p.id} - ${p.nome} - R$ ${Number(p.preco).toFixed(2)}`
      ).join('\n');

      await responder(twiml, {
        etapa: 'mostrando_cardapio_pratos',
        mensagemCliente: mensagem,
        contexto: 'Cliente pediu o cardápio. Mostre a lista de pratos e explique que ele pode digitar os números desejados (ex: 1 2) e *pronto* quando terminar.',
        dados: { listaPratos },
      }, `🍽️ *CARDÁPIO - PRATOS*\n\n${listaPratos}\n\nDigite os *números* dos pratos que deseja (ex: 1 2 ou 1 e 2). Quando terminar, digite *pronto*.`);
      await pool.query(
        'UPDATE clientes SET etapa=$1 WHERE id=$2',
        ['escolhendo_pratos', clienteData.id]
      );
    }

    // ---------- Escolhendo PRATOS (pode mandar vários números ou "pronto") ----------
    else if (clienteData.etapa === 'escolhendo_pratos') {

      if (terminouPratos(mensagemLower)) {
        const pedidoAtual = await pool.query(
          `SELECT id FROM pedidos WHERE cliente_id=$1 AND status='montando' ORDER BY criado_em DESC LIMIT 1`,
          [clienteData.id]
        );
        if (pedidoAtual.rows.length === 0) {
          await responder(twiml, {
            etapa: 'lembrete_escolher_pratos',
            mensagemCliente: mensagem,
            contexto: 'Cliente disse pronto mas ainda não escolheu nenhum prato. Peça os números dos itens com gentileza.',
          }, "Você ainda não escolheu nenhum prato. Digite os números dos itens (ex: 1 2) ou *pronto* só quando terminar.");
          res.writeHead(200, { 'Content-Type': 'text/xml' });
          return res.end(twiml.toString());
        }

        const bebidas = await pool.query(
          "SELECT id, nome, preco FROM cardapio WHERE ativo=true AND categoria='bebida' ORDER BY id"
        );
        const listaBebidas = bebidas.rows.length
          ? bebidas.rows.map(b => `${b.id} - ${b.nome} - R$ ${Number(b.preco).toFixed(2)}`).join('\n')
          : 'Nenhuma bebida no momento.';

        await responder(twiml, {
          etapa: 'oferta_bebidas_e_cardapio_bebidas',
          mensagemCliente: mensagem,
          contexto: 'Cliente terminou de escolher os pratos. Ofereça bebidas e mostre o cardápio de bebidas; diga que pode digitar os números ou *não* se não quiser.',
          dados: { listaBebidas },
        }, `Perfeito! Gostaria de algo para beber? 🥤\n\n*CARDÁPIO - BEBIDAS*\n\n${listaBebidas}\n\nDigite os números das bebidas ou *não* se não quiser.`);
        await pool.query(
          'UPDATE clientes SET etapa=$1 WHERE id=$2',
          ['escolhendo_bebidas', clienteData.id]
        );
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        return res.end(twiml.toString());
      }

      const ids = [...new Set(extrairNumeros(mensagemLower))];
      if (ids.length === 0) {
        await responder(twiml, {
          etapa: 'escolhendo_pratos_aguardando_numeros',
          mensagemCliente: mensagem,
          contexto: 'Cliente está escolhendo pratos mas não enviou números. Oriente de forma amigável.',
        }, "Digite os números dos pratos (ex: 1 2 3) ou *pronto* quando terminar.");
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        return res.end(twiml.toString());
      }

      const pratos = await pool.query(
        "SELECT id, nome, preco FROM cardapio WHERE ativo=true AND id = ANY($1) AND (categoria='prato' OR categoria IS NULL)",
        [ids]
      );

      let pedido = await pool.query(
        `SELECT id FROM pedidos WHERE cliente_id=$1 AND status='montando' ORDER BY criado_em DESC LIMIT 1`,
        [clienteData.id]
      );

      if (pedido.rows.length === 0) {
        pedido = await pool.query(
          'INSERT INTO pedidos (cliente_id, status) VALUES ($1,$2) RETURNING id',
          [clienteData.id, 'montando']
        );
      }

      const pedidoId = pedido.rows[0].id;
      for (const p of pratos.rows) {
        await pool.query(
          'INSERT INTO itens_pedido (pedido_id, nome_item, preco, quantidade) VALUES ($1,$2,$3,$4)',
          [pedidoId, p.nome, p.preco, 1]
        );
      }

      await pool.query(`
        UPDATE pedidos SET total = (
          SELECT COALESCE(SUM(preco * quantidade), 0) FROM itens_pedido WHERE pedido_id = $1
        ) WHERE id = $1
      `, [pedidoId]);

      const nomes = pratos.rows.map(p => p.nome).join(', ');
      await responder(twiml, {
        etapa: 'pratos_adicionados',
        mensagemCliente: mensagem,
        contexto: 'Acabou de adicionar pratos ao pedido. Confirme os itens e pergunte se quer mais algum ou *pronto* para bebidas.',
        dados: { itensAdicionados: nomes },
      }, `Adicionei: ${nomes}.\n\nQuer mais algum prato? Digite os números ou *pronto* para ir para as bebidas.`);
    }

    // ---------- Escolhendo BEBIDAS ou "não quero" / "pronto" ----------
    else if (clienteData.etapa === 'escolhendo_bebidas') {

      const querConfirmar = naoQuerBebida(mensagemLower) || terminouPratos(mensagemLower);
      if (querConfirmar) {
        const pedido = await pool.query(
          `SELECT id FROM pedidos WHERE cliente_id=$1 AND status='montando' ORDER BY criado_em DESC LIMIT 1`,
          [clienteData.id]
        );
        if (pedido.rows.length === 0) {
          await responder(twiml, {
            etapa: 'erro_pedido_nao_encontrado',
            mensagemCliente: mensagem,
            contexto: 'Pedido não encontrado. Peça ao cliente para começar de novo dizendo oi.',
          }, "Pedido não encontrado. Comece de novo dizendo *oi*.");
          await pool.query('UPDATE clientes SET etapa=$1 WHERE id=$2', ['inicio', clienteData.id]);
          res.writeHead(200, { 'Content-Type': 'text/xml' });
          return res.end(twiml.toString());
        }

        const itens = await pool.query(
          'SELECT nome_item, preco, quantidade FROM itens_pedido WHERE pedido_id=$1',
          [pedido.rows[0].id]
        );
        let total = 0;
        const linhas = itens.rows.map(i => {
          const sub = Number(i.preco) * Number(i.quantidade);
          total += sub;
          return `  • ${i.nome_item} x${i.quantidade} - R$ ${sub.toFixed(2)}`;
        }).join('\n');

        await responder(twiml, {
          etapa: 'resumo_pedido_pedir_confirmacao',
          mensagemCliente: mensagem,
          contexto: 'Cliente não quis bebida ou confirmou bebidas. Mostre o resumo do pedido com total e pergunte se está certo (sim/não).',
          dados: { resumoPedido: linhas, total },
        }, `Tudo bem! 👍\n\nVamos confirmar seu pedido:\n\n📋 *RESUMO*\n${linhas}\n\n*Total: R$ ${total.toFixed(2)}*\n\nEstá certo o seu pedido? (sim/não)`);
        await pool.query(
          'UPDATE pedidos SET status=$1 WHERE id=$2',
          ['confirmando', pedido.rows[0].id]
        );
        await pool.query(
          'UPDATE clientes SET etapa=$1 WHERE id=$2',
          ['confirmando_pedido', clienteData.id]
        );
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        return res.end(twiml.toString());
      }

      const ids = [...new Set(extrairNumeros(mensagemLower))];
      if (ids.length === 0) {
        await responder(twiml, {
          etapa: 'escolhendo_bebidas_aguardando',
          mensagemCliente: mensagem,
          contexto: 'Cliente está na etapa de bebidas. Peça os números ou *não* se não quiser.',
        }, "Digite os números das bebidas ou *não* se não quiser bebida.");
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        return res.end(twiml.toString());
      }

      const bebidas = await pool.query(
        "SELECT id, nome, preco FROM cardapio WHERE ativo=true AND id = ANY($1) AND categoria='bebida'",
        [ids]
      );

      const pedido = await pool.query(
        `SELECT id FROM pedidos WHERE cliente_id=$1 AND status='montando' ORDER BY criado_em DESC LIMIT 1`,
        [clienteData.id]
      );
      if (pedido.rows.length === 0) {
        await responder(twiml, {
          etapa: 'erro_pedido_nao_encontrado',
          mensagemCliente: mensagem,
        }, "Pedido não encontrado.");
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        return res.end(twiml.toString());
      }

      for (const b of bebidas.rows) {
        await pool.query(
          'INSERT INTO itens_pedido (pedido_id, nome_item, preco, quantidade) VALUES ($1,$2,$3,$4)',
          [pedido.rows[0].id, b.nome, b.preco, 1]
        );
      }
      await pool.query(`
        UPDATE pedidos SET total = (
          SELECT COALESCE(SUM(preco * quantidade), 0) FROM itens_pedido WHERE pedido_id = $1
        ) WHERE id = $1
      `, [pedido.rows[0].id]);

      const nomes = bebidas.rows.map(b => b.nome).join(', ');
      await responder(twiml, {
        etapa: 'bebidas_adicionadas',
        mensagemCliente: mensagem,
        contexto: 'Acabou de adicionar bebidas. Pergunte se quer mais alguma ou *não* para confirmar.',
        dados: { itensAdicionados: nomes },
      }, `Adicionei: ${nomes}.\n\nMais alguma bebida? Digite os números ou *não* para confirmar o pedido.`);
    }

    // ---------- Confirmando pedido (está certo?) ----------
    else if (clienteData.etapa === 'confirmando_pedido') {

      if (confirmouPedido(mensagemLower)) {
        await responder(twiml, {
          etapa: 'pedir_forma_pagamento',
          mensagemCliente: mensagem,
          contexto: 'Cliente confirmou o pedido. Pergunte a forma de pagamento e liste as opções.',
          dados: { opcoesPagamento: '1 - Pix, 2 - Dinheiro, 3 - Cartão' },
        }, "Qual será a forma de pagamento?\n\n*1* - Pix\n*2* - Dinheiro\n*3* - Cartão");
        await pool.query(
          'UPDATE clientes SET etapa=$1 WHERE id=$2',
          ['pagamento', clienteData.id]
        );
      } else {
        await responder(twiml, {
          etapa: 'pedido_cancelado',
          mensagemCliente: mensagem,
          contexto: 'Cliente não confirmou o pedido. Despeça-se com educação e diga que pode mandar oi para recomeçar.',
        }, "Pedido cancelado. Quando quiser, mande *oi* para começar de novo.");
        await pool.query(
          'UPDATE clientes SET etapa=$1 WHERE id=$2',
          ['inicio', clienteData.id]
        );
      }
    }

    // ---------- Pagamento → mensagem final + comanda ----------
    else if (clienteData.etapa === 'pagamento') {

      let forma = null;
      if (mensagemLower === '1' || /pix/i.test(mensagemLower)) forma = 'Pix';
      else if (mensagemLower === '2' || /dinheiro/i.test(mensagemLower)) forma = 'Dinheiro';
      else if (mensagemLower === '3' || /cart[aã]o/i.test(mensagemLower)) forma = 'Cartão';

      if (!forma) {
        twiml.message("Opção inválida. Escolha 1 (Pix), 2 (Dinheiro) ou 3 (Cartão).");
      } else {

        const pedido = await pool.query(
          `SELECT id FROM pedidos WHERE cliente_id=$1 AND status='confirmando' ORDER BY criado_em DESC LIMIT 1`,
          [clienteData.id]
        );
        const pedidoId = pedido.rows[0].id;

        await pool.query(
          'UPDATE pedidos SET forma_pagamento=$1, status=$2 WHERE id=$3',
          [forma, 'novo', pedidoId]
        );

        const itens = await pool.query(
          'SELECT nome_item, preco, quantidade FROM itens_pedido WHERE pedido_id=$1',
          [pedidoId]
        );
        let total = 0;
        const linhas = itens.rows.map(i => {
          const sub = Number(i.preco) * Number(i.quantidade);
          total += sub;
          return `  • ${i.nome_item} x${i.quantidade} - R$ ${sub.toFixed(2)}`;
        }).join('\n');

        const comanda = `📄 *COMANDA #${pedidoId}*\n${linhas}\n*Total: R$ ${total.toFixed(2)}*\nPagamento: ${forma}\nCliente: ${telefone}`;

        await responder(twiml, {
          etapa: 'encerramento_agradecimento',
          mensagemCliente: mensagem,
          contexto: 'Cliente escolheu a forma de pagamento. Agradeça a preferência, diga que o valor será cobrado na entrega e despeça-se até a próxima. Não inclua a comanda nesta mensagem (será enviada em seguida).',
          dados: { formaPagamento: forma },
        }, "Ficamos agradecidos pela sua preferência! 🙏\n\nO valor será cobrado na entrega. Até a próxima!");
        twiml.message(comanda);

        await pool.query(
          'UPDATE clientes SET etapa=$1 WHERE id=$2',
          ['inicio', clienteData.id]
        );
      }
    }

    else {
      await responder(twiml, {
        etapa: 'fora_do_fluxo',
        mensagemCliente: mensagem,
        contexto: 'Cliente está fora do fluxo esperado. Convide a começar um pedido dizendo oi ou boa noite.',
      }, "Mande *oi* ou *boa noite* para começar um pedido.");
    }

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    return res.end(twiml.toString());

  } catch (err) {
    console.error(err);
    try {
      await responder(twiml, {
        etapa: 'erro_interno',
        mensagemCliente: (req.body && req.body.Body) ? String(req.body.Body).trim() : '',
        contexto: 'Ocorreu um erro técnico. Peça desculpas e sugira tentar de novo ou mandar oi.',
      }, "Desculpe, ocorreu um erro. Tente de novo ou mande *oi* para recomeçar.");
    } catch (_) {
      twiml.message("Desculpe, ocorreu um erro. Tente de novo ou mande *oi* para recomeçar.");
    }
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    return res.end(twiml.toString());
  }
});


// ============================
// 🔐 LOGIN ADMIN (bcrypt)
// ============================

app.get('/admin', (req, res) => {
  res.render('login', { error: null });
});

app.post('/admin/login', async (req, res) => {

  const { email, password } = req.body;

  if (!email || !password) {
    return res.render('login', { error: 'Preencha email e senha.' });
  }

  const admin = await pool.query(
    'SELECT * FROM admins WHERE email=$1',
    [email.trim()]
  );

  if (admin.rows.length === 0) {
    return res.render('login', { error: 'Usuário não encontrado.' });
  }

  const match = await bcrypt.compare(
    password,
    admin.rows[0].password_hash
  );

  if (!match) {
    return res.render('login', { error: 'Senha incorreta.' });
  }

  req.session.admin = admin.rows[0].id;
  res.redirect('/admin/dashboard');
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {});
  res.redirect('/admin');
});

function auth(req, res, next) {
  if (!req.session.admin) {
    return res.redirect('/admin');
  }
  next();
}


// ============================
// 📊 DASHBOARD
// ============================

app.get('/admin/dashboard', auth, async (req, res) => {

  const pedidos = await pool.query(`
    SELECT p.*, c.telefone
    FROM pedidos p
    LEFT JOIN clientes c ON p.cliente_id = c.id
    WHERE p.status != 'montando'
    ORDER BY p.criado_em DESC
    LIMIT 8
  `);

  const pedidosComItens = await Promise.all(
    pedidos.rows.map(async (p) => {
      const itens = await pool.query(
        'SELECT nome_item, preco, quantidade FROM itens_pedido WHERE pedido_id=$1',
        [p.id]
      );
      return { ...p, itens: itens.rows };
    })
  );

  const [totais] = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status != 'montando') as total,
      COALESCE(SUM(total) FILTER (WHERE status != 'montando'), 0) as faturamento,
      COUNT(*) FILTER (WHERE status IN ('novo', 'em_preparo')) as pendentes
    FROM pedidos
  `).then(r => r.rows);

  res.render('dashboard', {
    pedidos: pedidosComItens,
    totais: totais || { total: 0, faturamento: 0, pendentes: 0 },
  });
});

// Pedidos com filtros e paginação
const PER_PAGE = 10;
const STATUS_VALIDOS = ['novo', 'em_preparo', 'finalizado', 'entregue', 'confirmando', 'cancelado'];

app.get('/admin/pedidos', auth, async (req, res) => {

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const status = req.query.status;
  const dataInicio = req.query.dataInicio;
  const dataFim = req.query.dataFim;

  let where = ["p.status != 'montando'"];
  const params = [];
  let idx = 1;

  if (status && STATUS_VALIDOS.includes(status)) {
    where.push(`p.status = $${idx}`);
    params.push(status);
    idx++;
  }
  if (dataInicio) {
    where.push(`p.criado_em::date >= $${idx}`);
    params.push(dataInicio);
    idx++;
  }
  if (dataFim) {
    where.push(`p.criado_em::date <= $${idx}`);
    params.push(dataFim);
    idx++;
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const [countResult] = await pool.query(
    `SELECT COUNT(*) as total FROM pedidos p ${whereClause}`,
    params
  ).then(r => r.rows);

  const total = parseInt(countResult.total, 10);
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const offset = (page - 1) * PER_PAGE;

  const pedidos = await pool.query(`
    SELECT p.*, c.telefone
    FROM pedidos p
    LEFT JOIN clientes c ON p.cliente_id = c.id
    ${whereClause}
    ORDER BY p.criado_em DESC
    LIMIT ${PER_PAGE} OFFSET ${offset}
  `, params);

  const pedidosComItens = await Promise.all(
    pedidos.rows.map(async (p) => {
      const itens = await pool.query(
        'SELECT nome_item, preco, quantidade FROM itens_pedido WHERE pedido_id=$1',
        [p.id]
      );
      return { ...p, itens: itens.rows };
    })
  );

  const redirectQuery = [
    status && `status=${encodeURIComponent(status)}`,
    dataInicio && `dataInicio=${encodeURIComponent(dataInicio)}`,
    dataFim && `dataFim=${encodeURIComponent(dataFim)}`,
    `page=${page}`,
  ].filter(Boolean).join('&');

  res.render('pedidos', {
    pedidos: pedidosComItens,
    pagination: { page, totalPages, total, perPage: PER_PAGE },
    filters: { status: status || '', dataInicio: dataInicio || '', dataFim: dataFim || '' },
    redirectQuery,
  });
});


// ============================
// 🍔 CARDÁPIO
// ============================

app.get('/admin/cardapio', auth, async (req, res) => {

  const itens = await pool.query('SELECT * FROM cardapio ORDER BY id');

  res.render('cardapio', { itens: itens.rows });
});

app.post('/admin/cardapio/add', auth, async (req, res) => {

  const categoria = (req.body.categoria || 'prato').toLowerCase();
  const ativo = req.body.ativo === 'on' || req.body.ativo === 'true';

  await pool.query(
    'INSERT INTO cardapio (nome, descricao, preco, categoria, ativo) VALUES ($1,$2,$3,$4,$5)',
    [req.body.nome?.trim(), req.body.descricao?.trim() || null, parseFloat(req.body.preco) || 0, categoria, ativo]
  );

  res.redirect('/admin/cardapio');
});

app.get('/admin/cardapio/editar/:id', auth, async (req, res) => {
  const item = await pool.query('SELECT * FROM cardapio WHERE id=$1', [req.params.id]);
  if (item.rows.length === 0) return res.redirect('/admin/cardapio');
  res.render('cardapio-editar', { item: item.rows[0] });
});

app.post('/admin/cardapio/editar/:id', auth, async (req, res) => {

  const categoria = (req.body.categoria || 'prato').toLowerCase();
  const ativo = req.body.ativo === 'on' || req.body.ativo === 'true';

  await pool.query(
    'UPDATE cardapio SET nome=$1, descricao=$2, preco=$3, categoria=$4, ativo=$5 WHERE id=$6',
    [req.body.nome?.trim(), req.body.descricao?.trim() || null, parseFloat(req.body.preco) || 0, categoria, ativo, req.params.id]
  );

  res.redirect('/admin/cardapio');
});

app.post('/admin/cardapio/excluir/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM cardapio WHERE id=$1', [req.params.id]);
  res.redirect('/admin/cardapio');
});

app.post('/admin/pedido/:id/status', auth, async (req, res) => {
  const status = req.body.status;
  const valid = ['novo', 'em_preparo', 'finalizado', 'entregue', 'cancelado'];
  if (valid.includes(status)) {
    await pool.query('UPDATE pedidos SET status=$1 WHERE id=$2', [status, req.params.id]);
  }
  const redirectTo = req.body.redirect === 'pedidos' ? '/admin/pedidos' : '/admin/dashboard';
  const qs = (req.body.redirectQuery || '').toString().trim();
  res.redirect(redirectTo + (qs ? '?' + qs : ''));
});

app.get('/admin/pedidos-count', async (req, res) => {
  const result = await pool.query('SELECT COUNT(*) FROM pedidos');
  res.json({ count: Number(result.rows[0].count) });
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
