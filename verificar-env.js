/**
 * Verifica se as variáveis do .env estão corretas para o projeto.
 * Execute: node verificar-env.js
 * Não exibe valores sensíveis, apenas se estão definidas e formato básico.
 */

require('dotenv').config();

const erros = [];
const avisos = [];

// Obrigatórias para o bot WhatsApp + agente + admin
const obrigatorias = [
  { key: 'DATABASE_URL', desc: 'Conexão PostgreSQL', validar: (v) => v && v.startsWith('postgres') && !v.startsWith(' postgres') },
  { key: 'GEMINI_API_KEY', desc: 'API Gemini (agente IA)', validar: (v) => v && v.length > 20 },
  { key: 'SESSION_SECRET', desc: 'Sessão do admin', validar: (v) => v && v.length >= 8 },
];

// Opcionais mas recomendadas para produção
const opcionais = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'PORT',
];

console.log('\n🔍 Verificando .env...\n');

for (const { key, desc, validar } of obrigatorias) {
  const valor = process.env[key];
  if (!valor || valor.trim() === '') {
    erros.push(`${key} (${desc}): não definida ou vazia`);
  } else if (validar && !validar(valor)) {
    if (key === 'DATABASE_URL' && valor.startsWith(' postgres')) {
      erros.push(`${key}: valor não pode ter espaço após o =. Use DATABASE_URL=postgresql://...`);
    } else {
      erros.push(`${key} (${desc}): valor inválido ou formato incorreto`);
    }
  } else {
    console.log(`  ✅ ${key} (${desc}): OK`);
  }
}

for (const key of opcionais) {
  const valor = process.env[key];
  if (!valor || valor.trim() === '') {
    avisos.push(`${key}: não definida (opcional)`);
  } else {
    console.log(`  ✅ ${key}: definida`);
  }
}

if (process.env.SESSION_SECRET === 'supersecret') {
  avisos.push('SESSION_SECRET está com valor padrão; em produção use um segredo forte.');
}

console.log('');
if (erros.length > 0) {
  console.log('❌ Erros:');
  erros.forEach(e => console.log('   •', e));
  process.exit(1);
}
if (avisos.length > 0) {
  console.log('⚠️  Avisos:');
  avisos.forEach(a => console.log('   •', a));
  console.log('');
}
console.log('✅ .env OK para rodar o projeto.\n');
process.exit(0);
