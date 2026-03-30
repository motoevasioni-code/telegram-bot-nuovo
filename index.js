const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SITE_URL = process.env.SITE_URL || 'https://www.motoevasioni.it/';
const WORDPRESS_BRIDGE_URL =
  process.env.WORDPRESS_BRIDGE_URL ||
  'https://www.motoevasioni.it/wp-json/meva-tg-bridge/v1/active-photo';
const WORDPRESS_BRIDGE_KEY = process.env.WORDPRESS_BRIDGE_KEY || '';
const WORDPRESS_REPORT_URL =
  process.env.WORDPRESS_REPORT_URL ||
  'https://www.motoevasioni.it/wp-json/meva-tg-bridge/v1/report';

if (!BOT_TOKEN) {
  console.error('Errore: BOT_TOKEN mancante nelle variabili ambiente.');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const userState = {};
const ADMIN_CHAT_ID = 1402209413;

/*
  STATO FOTO ONLINE LEGACY
  - backup temporaneo
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

function normalizeText(value) {
  if (!value) {
    return '';
  }

  return String(value).trim();
}

function buildPhotoCaptionFromWordPress(item) {
  const parts = [];

  if (item.title) {
    parts.push(`🏍️ ${normalizeText(item.title)}`);
  }

  if (item.content) {
    parts.push(normalizeText(item.content));
  }

  return parts.join('\n\n').trim();
}

function getWordPressBridgeUrlWithKey() {
  return `${WORDPRESS_BRIDGE_URL}?key=${encodeURIComponent(WORDPRESS_BRIDGE_KEY)}`;
}

function getWordPressReportUrlWithKey() {
  return `${WORDPRESS_REPORT_URL}?key=${encodeURIComponent(WORDPRESS_BRIDGE_KEY)}`;
}

async function fetchWordPressActivePhoto() {
  if (!WORDPRESS_BRIDGE_KEY) {
    throw new Error('WORDPRESS_BRIDGE_KEY mancante');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(getWordPressBridgeUrlWithKey(), {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data || data.success !== true) {
      throw new Error('Risposta JSON non valida');
    }

    if (!data.found || !data.item) {
      return null;
    }

    return data.item;
  } finally {
    clearTimeout(timeout);
  }
}

async function saveReportToWordPress(reportData) {
  if (!WORDPRESS_BRIDGE_KEY) {
    throw new Error('WORDPRESS_BRIDGE_KEY mancante');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(getWordPressReportUrlWithKey(), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(reportData)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data || data.success !== true) {
      throw new Error('Salvataggio segnalazione non riuscito');
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendLegacyOnlineContent(chatId) {
  const activeContent = getActiveOnlineContent();

  if (!activeContent) {
    await bot.sendMessage(
      chatId,
      'Le foto online non sono disponibili in questo momento.\n\nRiprova più tardi.'
    );
    return false;
  }

  await bot.sendPhoto(
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

  return true;
}

async function sendActiveOnlineContent(chatId) {
  try {
    const wpItem = await fetchWordPressActivePhoto();

    if (!wpItem) {
      const sentLegacy = await sendLegacyOnlineContent(chatId);
      if (!sentLegacy) {
        await bot.sendMessage(
          chatId,
          'Le foto online non sono disponibili in questo momento.\n\nRiprova più tardi.'
        );
      }
      return;
    }

    const caption =
      buildPhotoCaptionFromWordPress(wpItem) ||
      '🏍️ Sono disponibili nuove foto online.';

    if (wpItem.image_url) {
      if (wpItem.button_label && wpItem.button_url) {
        await bot.sendPhoto(chatId, wpItem.image_url, {
          caption,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: wpItem.button_label,
                  url: wpItem.button_url
                }
              ]
            ]
          }
        });
        return;
      }

      await bot.sendPhoto(chatId, wpItem.image_url, { caption });
      return;
    }

    if (wpItem.button_label && wpItem.button_url) {
      await bot.sendMessage(chatId, caption, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: wpItem.button_label,
                url: wpItem.button_url
              }
            ]
          ]
        }
      });
      return;
    }

    await bot.sendMessage(chatId, caption);
  } catch (error) {
    console.error('Errore WordPress Bridge /foto_online:', error.message);

    const sentLegacy = await sendLegacyOnlineContent(chatId);

    if (!sentLegacy) {
      await bot.sendMessage(
        chatId,
        'Le foto online non sono disponibili in questo momento.\n\nRiprova più tardi.'
      );
    }
  }
}

async function getWordPressPhotoStatusText() {
  if (!WORDPRESS_BRIDGE_KEY) {
    return (
      'WordPress Bridge: errore\n' +
      'Motivo: WORDPRESS_BRIDGE_KEY mancante nelle variabili ambiente.'
    );
  }

  try {
    const wpItem = await fetchWordPressActivePhoto();

    if (wpItem) {
      return (
        'WordPress Bridge: attivo\n' +
        'Titolo: ' + (wpItem.title || '(senza titolo)') + '\n' +
        'ID voce: ' + wpItem.id + '\n' +
        'Bottone: ' + (wpItem.button_label || '(vuoto)') + '\n' +
        'URL: ' + (wpItem.button_url || '(vuoto)')
      );
    }

    return (
      'WordPress Bridge: nessuna voce attiva\n' +
      'Controlla nel plugin:\n' +
      '- stato = active\n' +
      '- data inizio/fine valide\n' +
      '- voce realmente salvata'
    );
  } catch (error) {
    return 'WordPress Bridge: errore (' + error.message + ')';
  }
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
    'Ciao! Il bot Telegram Motoevasioni è online.\n\nComandi disponibili:\n/start\n/help\n/menu\n/sito\n/foto\n/foto_online\n/rivista'
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
    '/rivista — Apri la Rivista Motoevasioni\n' +
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
              url: SITE_URL
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

bot.onText(/\/foto_online$/, async (msg) => {
  await sendActiveOnlineContent(msg.chat.id);
});

/*
  COMANDI ADMIN FOTO ONLINE LEGACY

  Restano attivi come backup temporaneo.
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
    'online_one attivato come fallback legacy.\nScadenza: ' + formatDateTime(onlineState.expiresAt)
  );
});

bot.onText(/\/rivista/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    'Leggi la Rivista Motoevasioni qui:\nhttps://www.motoevasioni.it/la-strada-della-passione'
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
    'online_two attivato come fallback legacy.\nScadenza: ' + formatDateTime(onlineState.expiresAt)
  );
});

bot.onText(/\/disattiva_online$/, (msg) => {
  if (!isAdmin(msg.chat.id)) {
    return;
  }

  clearOnlineContent();

  bot.sendMessage(
    msg.chat.id,
    'Contenuto foto online legacy disattivato.'
  );
});

bot.onText(/\/stato_online$/, async (msg) => {
  if (!isAdmin(msg.chat.id)) {
    return;
  }

  cleanupExpiredOnlineState();

  const wpStatusText = await getWordPressPhotoStatusText();

  let legacyText = 'Legacy fallback: nessun contenuto attivo';

  if (onlineState.activeKey) {
    legacyText =
      'Legacy fallback: ' + onlineState.activeKey + '\n' +
      'Scadenza: ' + formatDateTime(onlineState.expiresAt);
  }

  bot.sendMessage(
    msg.chat.id,
    wpStatusText + '\n\n' + legacyText
  );
});

bot.onText(/\/debug_foto_online$/, async (msg) => {
  if (!isAdmin(msg.chat.id)) {
    return;
  }

  const lines = [];

  lines.push('DEBUG FOTO ONLINE');
  lines.push('');
  lines.push('BOT_TOKEN: ' + (BOT_TOKEN ? 'OK' : 'MANCANTE'));
  lines.push('WORDPRESS_BRIDGE_URL: ' + WORDPRESS_BRIDGE_URL);
  lines.push('WORDPRESS_BRIDGE_KEY: ' + (WORDPRESS_BRIDGE_KEY ? 'OK' : 'MANCANTE'));
  lines.push('WORDPRESS_REPORT_URL: ' + WORDPRESS_REPORT_URL);
  lines.push('');

  const wpStatusText = await getWordPressPhotoStatusText();
  lines.push(wpStatusText);
  lines.push('');

  cleanupExpiredOnlineState();

  if (onlineState.activeKey) {
    lines.push('Legacy fallback: attivo');
    lines.push('Chiave: ' + onlineState.activeKey);
    lines.push('Scadenza: ' + formatDateTime(onlineState.expiresAt));
  } else {
    lines.push('Legacy fallback: nessun contenuto attivo');
  }

  await bot.sendMessage(msg.chat.id, lines.join('\n'));
});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data === 'menu_foto_online') {
    bot.answerCallbackQuery(query.id);
    await sendActiveOnlineContent(chatId);
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
                url: SITE_URL
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

bot.on('message', async (msg) => {
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

    const reportPayload = {
      chat_id: chatId,
      username: msg.from && msg.from.username ? String(msg.from.username) : '',
      first_name: msg.from && msg.from.first_name ? String(msg.from.first_name) : '',
      last_name: msg.from && msg.from.last_name ? String(msg.from.last_name) : '',
      report_type: userState[chatId].tipo ? String(userState[chatId].tipo).trim().toLowerCase() : '',
      location_name: userState[chatId].passo ? String(userState[chatId].passo).trim() : '',
      message_text: userState[chatId].testo ? String(userState[chatId].testo).trim() : '',
      status: 'new',
      source: 'telegram'
    };

    let wpSaveNote = 'Salvataggio WordPress: non eseguito.';

    try {
      const wpResult = await saveReportToWordPress(reportPayload);
      wpSaveNote = 'Salvataggio WordPress: OK (ID ' + wpResult.report_id + ').';
    } catch (error) {
      console.error('Errore salvataggio segnalazione su WordPress:', error.message);
      wpSaveNote = 'Salvataggio WordPress: errore.';
    }

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
      'Messaggio: ' + userState[chatId].testo + '\n' +
      wpSaveNote
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
