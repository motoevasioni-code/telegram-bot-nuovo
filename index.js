const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const userState = {};

const ADMIN_CHAT_ID = 1402209413;

bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const startParam = match && match[1] ? match[1].trim() : '';

  if (startParam === 'segnalazione_passi') {
    userState[chatId] = { step: 'tipo' };

    bot.sendMessage(
      chatId,
      'Segnalazione live attivata.\n\nScrivi il tipo di segnalazione:\n- meteo\n- traffico\n- strada\n- chiusura'
    );
    return;
  }

  bot.sendMessage(
    chatId,
    'Ciao! Il bot Telegram Motoevasioni è online.\n\nComandi disponibili:\n/start\n/help\n/sito\n/foto'
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    'Comandi disponibili:\n/start - Avvia il bot\n/help - Mostra questo aiuto\n/sito - Apri il sito Motoevasioni\n/foto - Vedi promo GridPass'
  );
});

bot.onText(/\/sito/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    'Apri il sito Motoevasioni:',
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Vai al sito',
              url: 'https://www.motoevasioni.it/'
            }
          ]
        ]
      }
    }
  );
});

bot.onText(/\/foto/, (msg) => {
  const immagini = [
    'gridpass-promo.png',
    'online_one.png',
    'online_two.png'
  ];

  const immagineScelta = immagini[Math.floor(Math.random() * immagini.length)];

  if (immagineScelta === 'gridpass-promo.png') {
    bot.sendPhoto(
      msg.chat.id,
      'gridpass-promo.png',
      {
        caption:
          '🏍️ GridPass® Abbonamento Stagionale\n\n' +
          'Entra nell’accesso riservato Motoevasioni dedicato a chi vive davvero la strada.\n\n' +
          '✅ Accesso riservato\n' +
          '✅ Sconto 20% sulle foto digitali\n' +
          '✅ Presto nuove convenzioni dedicate\n' +
          '✅ Vantaggi esclusivi per i biker attivi',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'ATTIVA ORA',
                url: 'https://www.motoevasioni.it/prodotto/gridpass-pass-stagionale-2025/'
              }
            ]
          ]
        }
      }
    );
    return;
  }

  bot.sendPhoto(
    msg.chat.id,
    immagineScelta,
    {
      caption:
        '🏍️ Trova la foto, rivivi l’emozione e condividila.',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Trova la foto',
              url: 'https://www.motoevasioni.it/foto-moto-passi/'
            }
          ]
        ]
      }
    }
  );
});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  console.log('CHAT_ID:', chatId, 'TEXT:', text);

  if (!text) {
    return;
  }

  if (text.startsWith('/')) {
    return;
  }

  if (!userState[chatId]) {
    return;
  }

  if (userState[chatId].step === 'tipo') {
    userState[chatId].tipo = text;
    userState[chatId].step = 'passo';

    bot.sendMessage(chatId, 'Perfetto. Ora scrivi il nome del passo o della zona.');
    return;
  }

  if (userState[chatId].step === 'passo') {
    userState[chatId].passo = text;
    userState[chatId].step = 'testo';

    bot.sendMessage(chatId, 'Ora scrivi la segnalazione breve da inviare.');
    return;
  }

  if (userState[chatId].step === 'testo') {
    userState[chatId].testo = text;

    const riepilogo =
      'Segnalazione ricevuta.\n\n' +
      'Tipo: ' + userState[chatId].tipo + '\n' +
      'Passo/zona: ' + userState[chatId].passo + '\n' +
      'Messaggio: ' + userState[chatId].testo + '\n\n' +
      'La segnalazione verrà valutata prima di eventuale pubblicazione.';

    bot.sendMessage(
      ADMIN_CHAT_ID,
      'Nuova segnalazione ricevuta:\n\n' +
      'Da chat ID: ' + chatId + '\n' +
      'Tipo: ' + userState[chatId].tipo + '\n' +
      'Passo/zona: ' + userState[chatId].passo + '\n' +
      'Messaggio: ' + userState[chatId].testo
    );

    delete userState[chatId];

    bot.sendMessage(chatId, riepilogo);
  }
});

bot.onText(/\/id/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Il tuo chat ID è: ' + msg.chat.id);
});

console.log('Bot avviato.');
