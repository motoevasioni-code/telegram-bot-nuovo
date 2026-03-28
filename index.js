const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const userState = {};

const ADMIN_CHAT_ID = 1402209413;

/*
  STATO FOTO ONLINE
  - activeKey: null | 'online_one' | 'online_two'
  - expiresAt: timestamp in millisecondi oppure null
  - In questa versione lo stato è in memoria.
  - Se il bot viene riavviato, questo stato si azzera.
*/
const onlineState = {
  activeKey: null,
  expiresAt: null
};

const ONLINE_CONTENT = {
  online_one: {
    file: 'online_one.png',
    caption: '🏍️ Trova la foto, rivivi l’emozione e condividila.',
    buttonText: 'Trova la foto',
    buttonUrl: 'https://www.motoevasioni.it/foto-moto-passi/'
  },
  online_two: {
    file: 'online_two.png',
    caption: '🏍️ Trova la foto, rivivi l’emozione e condividila.',
    buttonText: 'Trova la foto',
    buttonUrl: 'https://www.motoevasioni.it/foto-moto-passi/'
  }
};

function isAdmin(chatId) {
  return Number(chatId) === Number(ADMIN_CHAT_ID);
}

function getDefaultExpiryMs() {
  /*
    Default: 5 giorni
    Puoi cambiarlo quando vuoi.
  */
  return 5 * 24 * 60 * 60 * 1000;
}

function cleanupExpiredOnlineState() {
  if (!onlineState.activeKey) {
    return;
  }

  if (!onlineState.expiresAt) {
    return;
  }

  if (Date.now() >= onlineState.expiresAt) {
    onlineState.activeKey = null;
    onlineState.expiresAt = null;
  }
}

function getActiveOnlineContent() {
  cleanupExpiredOnlineState();

  if (!onlineState.activeKey) {
    return null;
  }

  if (!ONLINE_CONTENT[onlineState.activeKey]) {
    return null;
  }

  return ONLINE_CONTENT[onlineState.activeKey];
}

function formatDateTime(timestamp) {
  if (!timestamp) {
    return 'non impostata';
  }

  return new Date(timestamp).toLocaleString('it-IT');
}

function setOnlineContent(key, durationMs) {
  onlineState.activeKey = key;
  onlineState.expiresAt = Date.now() + durationMs;
}

function clearOnlineContent() {
  onlineState.activeKey = null;
  onlineState.expiresAt = null;
}

function getMainMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📸 Foto online', callback_data: 'menu_foto_online' },
          { text: '🏍️ GridPass', callback_data: 'menu_gridpass' }
        ],
        [
          { text: '🌐 Sito', callback_data: 'menu_sito' },
          { text: '⚠️ Segnalazioni', callback_data: 'menu_segnalazioni' }
        ]
      ]
    }
  };
}

function sendMainMenu(chatId) {
  bot.sendMessage(
    chatId,
    'Benvenuto nel self service Motoevasioni.\n\nScegli una voce dal menu:',
    getMainMenuKeyboard()
  );
}

function sendGridPassPromo(chatId) {
  bot.sendPhoto(
    chatId,
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
}

function sendActiveOnlineContent(chatId) {
  const activeContent = getActiveOnlineContent();

  if (!activeContent) {
    bot.sendMessage(
      chatId,
      'Le foto online non sono disponibili in questo momento.\n\nRiprova più tardi.'
    );
    return;
  }

  bot.sendPhoto(
    chatId,
    activeContent.file,
    {
      caption: activeContent.caption,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: activeContent.buttonText,
              url: activeContent.buttonUrl
            }
          ]
        ]
      }
    }
  );
}

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
    'Ciao! Il bot Telegram Motoevasioni è online.\n\nComandi disponibili:\n/start\n/help\n/menu\n/sito\n/foto\n/foto_online'
  );

  sendMainMenu(chatId);
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    'Comandi disponibili:\n' +
    '/start - Avvia il bot\n' +
    '/help - Mostra questo aiuto\n' +
    '/menu - Apri il menu self service\n' +
    '/sito - Apri il sito Motoevasioni\n' +
    '/foto - Vedi promo GridPass\n' +
    '/foto_online - Controlla se le foto online sono disponibili\n' +
    '/id - Mostra il tuo chat ID'
  );
});

bot.onText(/\/menu/, (msg) => {
  sendMainMenu(msg.chat.id);
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

bot.onText(/\/foto$/, (msg) => {
  sendGridPassPromo(msg.chat.id);
});

bot.onText(/\/foto_online$/, (msg) => {
  sendActiveOnlineContent(msg.chat.id);
});

/*
  COMANDI ADMIN FOTO ONLINE

  Uso:
  /attiva_online_one
  /attiva_online_two

  Default scadenza: 5 giorni

  Oppure con ore personalizzate:
  /attiva_online_one 72
  /attiva_online_two 96

  Disattiva:
  /disattiva_online

  Stato:
  /stato_online
*/

bot.onText(/\/attiva_online_one(?:\s+(\d+))?$/, (msg, match) => {
  if (!isAdmin(msg.chat.id)) {
    return;
  }

  const ore = match && match[1] ? parseInt(match[1], 10) : null;
  const durationMs = ore && ore > 0 ? ore * 60 * 60 * 1000 : getDefaultExpiryMs();

  setOnlineContent('online_one', durationMs);

  bot.sendMessage(
    msg.chat.id,
    'online_one attivato.\nScadenza: ' + formatDateTime(onlineState.expiresAt)
  );
});

bot.onText(/\/attiva_online_two(?:\s+(\d+))?$/, (msg, match) => {
  if (!isAdmin(msg.chat.id)) {
    return;
  }

  const ore = match && match[1] ? parseInt(match[1], 10) : null;
  const durationMs = ore && ore > 0 ? ore * 60 * 60 * 1000 : getDefaultExpiryMs();

  setOnlineContent('online_two', durationMs);

  bot.sendMessage(
    msg.chat.id,
    'online_two attivato.\nScadenza: ' + formatDateTime(onlineState.expiresAt)
  );
});

bot.onText(/\/disattiva_online$/, (msg) => {
  if (!isAdmin(msg.chat.id)) {
    return;
  }

  clearOnlineContent();

  bot.sendMessage(
    msg.chat.id,
    'Contenuto foto online disattivato.'
  );
});

bot.onText(/\/stato_online$/, (msg) => {
  if (!isAdmin(msg.chat.id)) {
    return;
  }

  cleanupExpiredOnlineState();

  if (!onlineState.activeKey) {
    bot.sendMessage(
      msg.chat.id,
      'Nessun contenuto foto online è attivo in questo momento.'
    );
    return;
  }

  bot.sendMessage(
    msg.chat.id,
    'Contenuto attivo: ' + onlineState.activeKey + '\n' +
    'Scadenza: ' + formatDateTime(onlineState.expiresAt)
  );
});

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data === 'menu_foto_online') {
    bot.answerCallbackQuery(query.id);
    sendActiveOnlineContent(chatId);
    return;
  }

  if (data === 'menu_gridpass') {
    bot.answerCallbackQuery(query.id);
    sendGridPassPromo(chatId);
    return;
  }

  if (data === 'menu_sito') {
    bot.answerCallbackQuery(query.id);
    bot.sendMessage(
      chatId,
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
    return;
  }

  if (data === 'menu_segnalazioni') {
    bot.answerCallbackQuery(query.id);

    userState[chatId] = { step: 'tipo' };

    bot.sendMessage(
      chatId,
      'Segnalazione live attivata.\n\nScrivi il tipo di segnalazione:\n- meteo\n- traffico\n- strada\n- chiusura'
    );
    return;
  }

  bot.answerCallbackQuery(query.id);
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

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

console.log('Bot avviato.');
