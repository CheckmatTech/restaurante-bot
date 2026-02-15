# Por que o WhatsApp não responde?

O Twilio **precisa chamar seu servidor** quando alguém manda mensagem. Se o servidor está só no seu PC (`localhost`), o Twilio **não consegue acessar**.

---

## Checklist

### 1. Servidor rodando
```bash
node server.js
```
Deve aparecer: `Servidor rodando na porta 3000`

### 2. URL pública (obrigatório)

O Twilio envia as mensagens para uma **URL na internet**, não para `localhost`.

**Opção A – Teste no seu PC com ngrok**

1. Instale o [ngrok](https://ngrok.com/download) ou: `npm install -g ngrok`
2. Com o servidor rodando, em outro terminal:
   ```bash
   ngrok http 3000
   ```
3. Copie a URL **HTTPS** que aparecer, ex: `https://abc123.ngrok-free.app`

**Opção B – Deixar na nuvem**

Suba o projeto no Render, Railway, etc. e use a URL que eles fornecem (ex: `https://restaurante-bot.onrender.com`).

### 3. Configurar o webhook no Twilio

1. Acesse: [Twilio Console](https://console.twilio.com)
2. Menu **Messaging** → **Try it out** → **Send a WhatsApp message**
3. Se estiver usando **Sandbox**: em *Sandbox settings* (ou *Configurações*), procure **"When a message comes in"**
4. Coloque:
   - **URL:** `https://SUA-URL-PUBLICA/whatsapp`  
     (ex: `https://abc123.ngrok-free.app/whatsapp`)
   - **Método:** POST
5. Salve.

Se for um **número próprio** de WhatsApp (não Sandbox): em **Messaging** → **Settings** → **WhatsApp senders** → escolha o número → configure a mesma URL em "Incoming messages".

### 4. Testar se o Twilio está chegando no seu servidor

Quando você manda uma mensagem pelo WhatsApp para o número do restaurante:

- No **terminal** onde o `node server.js` está rodando deve aparecer algo como:
  ```text
  [WhatsApp] Mensagem recebida de 5511999999999 : oi
  ```
- Se **não aparecer nada**, o Twilio **não está** chamando seu servidor. Revise:
  - URL no Twilio (com `https://` e `/whatsapp`)
  - Servidor rodando e URL pública acessível (teste abrindo no navegador: `https://SUA-URL/whatsapp` — deve mostrar "Webhook WhatsApp OK...")

### 5. Teste rápido da URL

No navegador, abra:
```text
https://SUA-URL-PUBLICA/whatsapp
```
Deve aparecer: `Webhook WhatsApp OK. Use POST para mensagens.`

Se não abrir, o servidor não está acessível na internet (ngrok parado, firewall, URL errada, etc.).

---

## Resumo

| Problema | Solução |
|----------|--------|
| Nada aparece no terminal quando mando mensagem | Twilio não está chegando: use URL pública (ngrok ou deploy) e configure essa URL no Twilio |
| URL no navegador não abre | Servidor não está acessível; verifique ngrok ou hospedagem |
| Aparece no terminal mas não responde no WhatsApp | Possível erro na resposta (veja erros no terminal ou no log do Twilio) |

Depois de configurar a URL pública e o webhook, mande de novo uma mensagem e confira se aparece o log `[WhatsApp] Mensagem recebida de...` no terminal.
