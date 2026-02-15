/**
 * Agente de IA para atendimento humanizado no WhatsApp.
 * Usa Gemini para gerar respostas naturais, mantendo o fluxo do restaurante.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const INSTRUCOES_SISTEMA = `Você é o atendente virtual de um restaurante, falando pelo WhatsApp.
Seu tom é sempre cordial, humano e prestativo — como um atendente real, não um robô.
Regras:
- Responda SEMPRE em português do Brasil, de forma curta (ideal para WhatsApp).
- Use uma ou duas frases por vez quando possível; se precisar listar itens, seja claro.
- Pode usar emojis com moderação (👋 🍽️ 👍 🙏).
- NUNCA invente preços, pratos ou informações que não forem passadas nos dados.
- Inclua obrigatoriamente as informações que forem pedidas nos "dados" (ex.: lista do cardápio, resumo do pedido).
- Não use markdown pesado; pode usar *negrito* para títulos ou valores.
- Assine como o restaurante, não como "assistente" ou "IA".`;

/**
 * Gera uma resposta humanizada do agente.
 * @param {Object} opts
 * @param {string} opts.etapa - Etapa atual do fluxo (ex: saudacao, cardapio_pratos, resumo_pedido)
 * @param {string} opts.mensagemCliente - Última mensagem do cliente
 * @param {string} [opts.contexto] - Texto extra para a IA (ex: "Cliente acabou de ver o cardápio")
 * @param {Object} [opts.dados] - Dados estruturados: listaPratos, listaBebidas, itensAdicionados, resumoPedido, total, formaPagamento, comanda
 * @returns {Promise<string>} Mensagem para enviar ao cliente
 */
async function gerarRespostaAgente({ etapa, mensagemCliente, contexto = '', dados = {} }) {
  if (!process.env.GEMINI_API_KEY) {
    return null;
  }

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: INSTRUCOES_SISTEMA,
  });

  const partes = [
    `Etapa atual do atendimento: ${etapa}.`,
    contexto ? `Contexto: ${contexto}` : '',
    `Mensagem do cliente: "${mensagemCliente}"`,
  ];

  if (Object.keys(dados).length > 0) {
    partes.push('\nDados que você DEVE usar na resposta (inclua quando fizer sentido):');
    if (dados.listaPratos) partes.push(`Cardápio pratos:\n${dados.listaPratos}`);
    if (dados.listaBebidas) partes.push(`Cardápio bebidas:\n${dados.listaBebidas}`);
    if (dados.itensAdicionados) partes.push(`Itens que acabaram de ser adicionados: ${dados.itensAdicionados}`);
    if (dados.resumoPedido) partes.push(`Resumo do pedido:\n${dados.resumoPedido}`);
    if (dados.total != null) partes.push(`Total do pedido: R$ ${Number(dados.total).toFixed(2)}`);
    if (dados.formaPagamento) partes.push(`Forma de pagamento escolhida: ${dados.formaPagamento}`);
    if (dados.comanda) partes.push(`Texto da comanda (enviar em seguida):\n${dados.comanda}`);
    if (dados.opcoesPagamento) partes.push(`Opções de pagamento: ${dados.opcoesPagamento}`);
  }

  partes.push('\nGere APENAS a mensagem que o atendente deve enviar ao cliente. Uma única resposta, natural e humanizada.');

  const prompt = partes.filter(Boolean).join('\n');

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    if (!response || !response.text) return null;
    return response.text().trim();
  } catch (err) {
    console.error('[Agente IA] Erro ao gerar resposta:', err.message);
    return null;
  }
}

/**
 * Detecta a intenção do cliente a partir da mensagem e da etapa atual.
 * Usa a IA para entender frases naturais ("pode me mostrar o cardápio de novo", "não quero mais", etc.).
 * @param {string} etapa - Etapa atual: aguardando_cardapio, escolhendo_pratos, escolhendo_bebidas, confirmando_pedido, pagamento
 * @param {string} mensagemCliente - Mensagem do cliente
 * @returns {Promise<string>} Uma das intenções: QUER_VER_CARDAPIO, VER_CARDAPIO, CANCELAR, PRONTO, ESCOLHER_ITENS, NAO_QUERO_BEBIDA, CONFIRMAR_SIM, CONFIRMAR_NAO, PAGAMENTO_PIX, PAGAMENTO_DINHEIRO, PAGAMENTO_CARTAO, DESCONHECIDO
 */
async function detectarIntent(etapa, mensagemCliente) {
  if (!process.env.GEMINI_API_KEY || !mensagemCliente || !mensagemCliente.trim()) {
    return 'DESCONHECIDO';
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `Você é um classificador de intenção para um bot de restaurante no WhatsApp.

Etapa atual da conversa: ${etapa}
Mensagem do cliente: "${mensagemCliente.trim()}"

Intenções possíveis (responda APENAS com uma dessas palavras, nada mais):
- QUER_VER_CARDAPIO: cliente quer ver o cardápio (ex: "sim", "quero", "pode mostrar", "mostra o cardápio", "me manda o cardápio", "cardápio de novo")
- VER_CARDAPIO: cliente pede para ver o cardápio novamente (ex: "mostra de novo", "pode mostrar o cardápio novamente", "ver o cardápio de novo")
- CANCELAR: cliente quer desistir, encerrar, não quer mais (ex: "não quero mais", "obrigado até a próxima", "cancelar", "deixa pra lá", "sair")
- PRONTO: cliente terminou de escolher (ex: "pronto", "é isso", "só isso", "pode ser")
- ESCOLHER_ITENS: cliente está informando números de itens (ex: "1 2", "quero o 1 e 3")
- NAO_QUERO_BEBIDA: não quer bebida (ex: "não", "não quero", "obrigado não")
- CONFIRMAR_SIM: confirma que o pedido está certo (ex: "sim", "está certo", "confirmo")
- CONFIRMAR_NAO: não confirma o pedido (ex: "não", "errado")
- PAGAMENTO_PIX: quer pagar com Pix (ex: "pix", "1")
- PAGAMENTO_DINHEIRO: quer pagar em dinheiro (ex: "dinheiro", "2")
- PAGAMENTO_CARTAO: quer pagar com cartão (ex: "cartão", "3")
- DESCONHECIDO: não se encaixa nas acima

Responda com UMA ÚNICA PALAVRA da lista.`;

  try {
    const result = await model.generateContent(prompt);
    const text = (result.response && result.response.text() || '').trim().toUpperCase();
    const validas = ['QUER_VER_CARDAPIO', 'VER_CARDAPIO', 'CANCELAR', 'PRONTO', 'ESCOLHER_ITENS', 'NAO_QUERO_BEBIDA', 'CONFIRMAR_SIM', 'CONFIRMAR_NAO', 'PAGAMENTO_PIX', 'PAGAMENTO_DINHEIRO', 'PAGAMENTO_CARTAO', 'DESCONHECIDO'];
    const encontrada = validas.find(v => text.includes(v));
    return encontrada || 'DESCONHECIDO';
  } catch (err) {
    console.error('[Agente IA] Erro ao detectar intenção:', err.message);
    return 'DESCONHECIDO';
  }
}

module.exports = { gerarRespostaAgente, detectarIntent };
