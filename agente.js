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

module.exports = { gerarRespostaAgente };
