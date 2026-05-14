const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SITE_URL = process.env.SITE_URL || 'https://www.motoevasioni.it/';
const WORDPRESS_BRIDGE_URL =
  process.env.WORDPRESS_BRIDGE_URL ||
  'https://www.motoevasioni.it/wp-json/meva-tg-bridge/v1/active-photo';
const WORDPRESS_BRIDGE_KEY = process.env.WORDPRESS_BRIDGE_KEY || '';
const WORDPRESS_REPORT_URL =
  process.env.WORDPRESS_REPORT_URL ||
  'https://www.motoevasioni.it/wp-json/meva-tg-bridge/v1/report';
const WORDPRESS_PHOTO_DAY_URL =
  process.env.WORDPRESS_PHOTO_DAY_URL ||
  'https://www.motoevasioni.it/wp-json/meva-tg-bridge/v1/photo-day';
const WORDPRESS_NEXT_WEEKEND_URL =
  process.env.WORDPRESS_NEXT_WEEKEND_URL ||
  'https://www.motoevasioni.it/wp-json/meva-tg-bridge/v1/next-weekend-photo-days';
const WORDPRESS_EVENTO_ATTIVO_URL =
  process.env.WORDPRESS_EVENTO_ATTIVO_URL ||
  'https://www.motoevasioni.it/wp-json/meva-tg-bridge/v1/active-event';
const WORDPRESS_EVENTO_ALERT_URL =
  process.env.WORDPRESS_EVENTO_ALERT_URL ||
  'https://www.motoevasioni.it/wp-json/meva-tg-bridge/v1/event-subscribe';

if (!BOT_TOKEN) {
  console.error('Errore: BOT_TOKEN mancante nelle variabili ambiente.');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const userState = {};
const ADMIN_CHAT_ID = 1402209413;
const SUBSCRIBERS_FILE = path.join(__dirname, 'telegram_subscribers.json');
const EVENT_ALERTS_FILE = path.join(__dirname, 'telegram_event_alerts.json');
const AUTOVELOX_VALIDITY_MINUTES = 180;

/*
  ARCHIVIO ISCRITTI TELEGRAM
  - salva gli utenti che avviano o usano il bot
  - serve per inviare avvisi broadcast
*/
function loadSubscribers() {
  try {
    if (!fs.existsSync(SUBSCRIBERS_FILE)) {
      return {};
    }

    const raw = fs.readFileSync(SUBSCRIBERS_FILE, 'utf8');

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    return parsed;
  } catch (error) {
    console.error('Errore lettura archivio iscritti:', error.message);
    return {};
  }
}

function saveSubscribers(subscribers) {
  try {
    fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(subscribers, null, 2), 'utf8');
  } catch (error) {
    console.error('Errore salvataggio archivio iscritti:', error.message);
  }
}

function registerSubscriber(msg) {
  if (!msg || !msg.chat || !msg.from) {
    return;
  }

  const chatId = String(msg.chat.id);
  const subscribers = loadSubscribers();
  const existing = subscribers[chatId] || {};

  subscribers[chatId] = {
    chat_id: chatId,
    username: msg.from.username ? String(msg.from.username) : '',
    first_name: msg.from.first_name ? String(msg.from.first_name) : '',
    last_name: msg.from.last_name ? String(msg.from.last_name) : '',
    is_bot: msg.from.is_bot === true,
    first_seen_at: existing.first_seen_at ? existing.first_seen_at : new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    source: 'telegram_bot',
    notifications_enabled: true
  };

  saveSubscribers(subscribers);
}

function getSubscribersList() {
  const subscribers = loadSubscribers();
  return Object.keys(subscribers)
    .map(function (key) {
      return subscribers[key];
    })
    .filter(function (item) {
      return item && item.chat_id && item.notifications_enabled !== false;
    });
}

async function broadcastToSubscribers(message, excludeChatId) {
  const subscribers = getSubscribersList();
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < subscribers.length; i++) {
    const subscriber = subscribers[i];
    const targetChatId = subscriber.chat_id;

    if (excludeChatId && String(targetChatId) === String(excludeChatId)) {
      continue;
    }

    try {
      await bot.sendMessage(targetChatId, message, {
        disable_web_page_preview: true
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error('Errore broadcast verso chat ' + targetChatId + ':', error.message);
    }
  }

  return {
    total: subscribers.length,
    sent: sent,
    failed: failed
  };
}

function getSubscriberStatsText() {
  const subscribers = getSubscribersList();
  return 'Iscritti bot registrati: ' + subscribers.length;
}

/*
  PRE-ISCRIZIONI EVENTI / RADUNI
  - salva chi chiede l'avviso per uno specifico evento
  - backup locale, oltre al salvataggio sul bridge WordPress
*/
function loadEventAlerts() {
  try {
    if (!fs.existsSync(EVENT_ALERTS_FILE)) {
      return {};
    }

    const raw = fs.readFileSync(EVENT_ALERTS_FILE, 'utf8');

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    return parsed;
  } catch (error) {
    console.error('Errore lettura pre-iscrizioni eventi:', error.message);
    return {};
  }
}

function saveEventAlerts(alerts) {
  try {
    fs.writeFileSync(EVENT_ALERTS_FILE, JSON.stringify(alerts, null, 2), 'utf8');
  } catch (error) {
    console.error('Errore salvataggio pre-iscrizioni eventi:', error.message);
  }
}

function getEventId(eventItem) {
  if (!eventItem) {
    return 'evento_attivo';
  }

  if (eventItem.id) {
    return String(eventItem.id);
  }

  if (eventItem.event_id) {
    return String(eventItem.event_id);
  }

  if (eventItem.slug) {
    return String(eventItem.slug);
  }

  if (eventItem.button_text) {
    return String(eventItem.button_text).trim();
  }

  if (eventItem.title) {
    return String(eventItem.title).trim();
  }

  return 'evento_attivo';
}

function saveLocalEventAlert(eventItem, msg) {
  if (!msg || !msg.chat || !msg.from) {
    return;
  }

  const eventId = getEventId(eventItem);
  const chatId = String(msg.chat.id);
  const alerts = loadEventAlerts();

  if (!alerts[eventId]) {
    alerts[eventId] = {
      event_id: eventId,
      title: eventItem && eventItem.title ? String(eventItem.title) : '',
      button_text: eventItem && eventItem.button_text ? String(eventItem.button_text) : '',
      users: {}
    };
  }

  alerts[eventId].users[chatId] = {
    chat_id: chatId,
    username: msg.from.username ? String(msg.from.username) : '',
    first_name: msg.from.first_name ? String(msg.from.first_name) : '',
    last_name: msg.from.last_name ? String(msg.from.last_name) : '',
    saved_at: new Date().toISOString()
  };

  saveEventAlerts(alerts);
}

function getEventAlertUsers(eventItem) {
  const eventId = getEventId(eventItem);
  const alerts = loadEventAlerts();

  if (!alerts[eventId] || !alerts[eventId].users) {
    return [];
  }

  return Object.keys(alerts[eventId].users).map(function (key) {
    return alerts[eventId].users[key];
  });
}

function buildFotoOnlineNotificationMessage() {
  return (
    '📸 FOTO ONLINE MOTOEVASIONI\n\n' +
    'Le nuove foto sono online.\n\n' +
    'Apri il bot e premi “📸 Foto online” per trovare subito la tua foto.\n\n' +
    'Se vuoi continuare a ricevere gli avvisi, mantieni avviata la chat con il bot.'
  );
}

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

function getMainMenuKeyboard(activeEvent) {
  const keyboard = [];

  if (activeEvent && activeEvent.button_text) {
    keyboard.push([
      { text: String(activeEvent.button_text), callback_data: 'menu_evento_attivo' }
    ]);
  }

  keyboard.push(
        [
          { text: '📸 Foto online', callback_data: 'menu_foto_online' },
          { text: '🏍️ GridPass', callback_data: 'menu_gridpass' }
        ],
        [
          { text: '🚨 SEGNALAZ. AUTOVELOX e PATTUGLIE', callback_data: 'menu_autovelox_live' }
        ],
        [
          { text: '📷 Richiesta info Foto', callback_data: 'menu_info_foto' }
        ],
        [
          { text: '📍 Dove siamo nel prossimo weekend', callback_data: 'menu_next_weekend' }
        ],
        [
          { text: '🏍️ Ride Match', callback_data: 'menu_ride_match' },
          { text: '🗺️ Moto Pass Map', callback_data: 'menu_moto_pass_map' }
        ],
        [
          { text: '🌿 EVASIA', callback_data: 'menu_evasia' }
        ],
        [
          { text: '📖 Rivista', callback_data: 'menu_rivista' }
        ],
        [
          { text: '🏍️ Scopri i tour', callback_data: 'menu_scopri_tour' }
        ],
        [
          { text: '🌐 Sito', callback_data: 'menu_sito' },
          { text: '⚠️ Segnalazioni', callback_data: 'menu_segnalazioni' },
          { text: '🛣️ RoadBook', callback_data: 'menu_roadbook' }
        ]
      );

  return {
    reply_markup: {
      inline_keyboard: keyboard
    }
  };
}

async function sendMainMenu(chatId) {
  let activeEvent = null;

  try {
    activeEvent = await fetchWordPressActiveEvent();
  } catch (error) {
    console.error('Errore recupero evento attivo per menu:', error.message);
  }

  bot.sendMessage(
    chatId,
    'Benvenuto nel self service Motoevasioni.\n\nScegli una voce dal menu:\n\nℹ️ Se non vedi subito le nuove voci o i nuovi pulsanti, chiudi e riapri la chat del bot oppure esci e rientra nel menu.',
    getMainMenuKeyboard(activeEvent)
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

function sendRoadBook(chatId) {
  bot.sendMessage(
    chatId,
    '🛣️ *RoadBook ⭐️ Motoevasioni*\n\nUn viaggio su strade secondarie che raccontano, tra sapori, soste e luoghi collegati con senso.',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Apri il RoadBook',
              url: 'https://www.motoevasioni.it/avventura-del-gusto/'
            }
          ],
          [
            {
              text: 'Vedi l’esperienza completa',
              url: 'https://www.viator.com/it-IT/tours/Arezzo/Tobacco-and-Venus-Tour/d22631-5556829P5'
            }
          ]
        ]
      }
    }
  );
}

function sendEvasia(chatId) {
  bot.sendPhoto(
    chatId,
    'https://www.motoevasioni.it/wp-content/uploads/2026/04/Logo-EVASIA-con-gradienti-dinamici.png',
    {
      caption:
        'EVASIA\n' +
        'Keep Moving\n\n' +
        'EVASIA è un progetto fatto di persone che amano la moto, il movimento e la libertà.\n' +
        'Nasce per chi vuole continuare a vivere la strada nel modo giusto, mettendo in relazione motociclisti, famiglie, strutture e professionisti attorno a ciò che rende tutto questo possibile: stare bene.',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Scopri EVASIA',
              url: 'https://www.motoevasioni.it/evasia-keep-moving/'
            }
          ],
          [
            {
              text: 'Proponi la tua realtà',
              url: 'https://www.motoevasioni.it/proponi-la-tua-realta-evasia/'
            }
          ]
        ]
      }
    }
  );
}

function sendRideMatch(chatId) {
  bot.sendPhoto(
    chatId,
    'https://www.motoevasioni.it/wp-content/uploads/2026/04/GridMap®-Trova-un-Giro-in-Moto-Original.png',
    {
      caption:
        '🏍️ Ride Match\n\n' +
        'Siamo all’inizio della stagione, appena iniziata, e questa sezione nasce proprio adesso per mettere in contatto biker veri, con giri veri.\n\n' +
        'Non troverai contenuti messi lì tanto per fare scena: deve partire con chi ha voglia di usarla davvero, pubblicare un giro, condividerlo anche con tracce GPX, provarla e aiutarci a farla crescere nel modo giusto.\n\n' +
        'Da parte nostra c’è piena disponibilità a darti una mano all’inizio, per spiegarti come funziona e accompagnarti nei primi passi.\n\n' +
        'La registrazione non è pensata per fare cassa, ma solo per mantenere questo spazio più sicuro, serio e affidabile per tutti.\n\n' +
        'Se l’idea ti piace, entra, provala e parlane anche con altri biker.',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Apri Ride Match',
              url: 'https://www.motoevasioni.it/trova-un-giro-in-moto/'
            }
          ]
        ]
      }
    }
  );
}

function sendMotoPassMap(chatId) {
  bot.sendPhoto(
    chatId,
    'https://www.motoevasioni.it/wp-content/uploads/2026/03/Moto-Pass-Map-Motoevasioni.png',
    {
      caption:
        '🗺️ Moto Pass Map\n\n' +
        'Se ami i passi di montagna, questa mappa è un punto di partenza perfetto per trovare ispirazione, scoprire nuove strade e ritrovare grandi classici da vivere in moto.\n\n' +
        'Aprila, esplorala e usala per immaginare il tuo prossimo giro.',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Apri Moto Pass Map',
              url: 'https://www.motoevasioni.it/moto-pass-map/'
            }
          ]
        ]
      }
    }
  );
}

function sendScopriTour(chatId) {
  bot.sendPhoto(
    chatId,
    'https://www.motoevasioni.it/wp-content/uploads/2026/04/immagine-per-la-hero-del-bot.png',
    {
      caption:
        '🔥 Quello che hai dentro non si spegne. È benzina diabolica.\n\n' +
        'Benvenuto in Motoevasioni.\n\n' +
        'Smetti di girare a vuoto sui passi affollati.\n' +
        'Qui trovi esperienze vere su strade secondarie, percorsi selezionati e strade che il viaggio normale non racconta più.\n\n' +
        '🤫 Accesso riservato\n' +
        'Non i soliti giri visti ovunque.\n' +
        'Qui entri in un mondo parallelo fatto di curve giuste, luoghi veri e strade da meritare.\n\n' +
        '🏍️ Scegli da dove iniziare:\n\n' +
        '• EVASION BOX\n' +
        'Il punto di partenza della tua prima vera evasione.\n\n' +
        '• BACCO, TABACCO & VENERE\n' +
        'Il primo tour firmato Motoevasioni: curve, gusto e scoperta.\n\n' +
        '• PARTNER UFFICIALI\n' +
        'La rete complice sul territorio.\n\n' +
        '🔥 La strada ti aspetta. Come vuoi iniziare?',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Evasion Box',
              url: 'https://www.motoevasioni.it/evasion-box-tour-motoevasioni/'
            }
          ],
          [
            {
              text: 'Bacco, Tabacco & Venere',
              url: 'https://www.motoevasioni.it/bacco-tabacco-venere/'
            }
          ],
          [
            {
              text: 'Partner ufficiali',
              url: 'https://www.motoevasioni.it/partner-ufficiali-evasion-box/'
            }
          ]
        ]
      }
    }
  );
}

function sendRivista(chatId) {
  bot.sendPhoto(
    chatId,
    './rivista-aprile-2026.png',
    {
      caption:
        '📖 *M-SS71 • Numero 2 • Aprile 2026*\n\n' +
        'Leggi ora la nuova rivista Motoevasioni oppure scarica il PDF.',
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Sfoglia la rivista',
              url: 'https://online.fliphtml5.com/cpmpb/uojm/#p=1'
            }
          ],
          [
            {
              text: 'Scarica il PDF',
              url: 'https://www.motoevasioni.it/wp-content/uploads/2026/04/RIVISTA_N.2_M-SS71_APRILE_2026.pdf'
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

function isValidDateString(value) {
  if (!value) {
    return false;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim());
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

function buildPhotoDayMessage(dayItem) {
  let message =
    '📷 *Richiesta info Foto*\n\n' +
    'Le foto di oggi sono state scattate su:\n' +
    `• *${dayItem.primary_location}*`;

  if (dayItem.secondary_location) {
    message += `\n• *${dayItem.secondary_location}*`;
  }

  if (dayItem.note_text) {
    message += `\n\n_${dayItem.note_text}_`;
  }

  message +=
    '\n\nPer sapere quando le foto saranno online, usa il pulsante *📸 Foto online* nel menu.\n' +
    'Quando le foto saranno disponibili, lì troverai direttamente il link corretto.';

  return message;
}

function buildPhotoDayMessageForDate(dayItem, dateValue) {
  let message =
    `📷 *Richiesta info Foto*\n\n` +
    `Per la data *${dateValue}* risulta:\n` +
    `• *${dayItem.primary_location}*`;

  if (dayItem.secondary_location) {
    message += `\n• *${dayItem.secondary_location}*`;
  }

  if (dayItem.note_text) {
    message += `\n\n_${dayItem.note_text}_`;
  }

  message +=
    '\n\nPer sapere quando le foto saranno online, usa il pulsante *📸 Foto online* nel menu.\n' +
    'Quando le foto saranno disponibili, lì troverai direttamente il link corretto.';

  return message;
}

function buildWeekendSingleDayBlock(label, dateValue, item, found) {
  if (!found || !item) {
    return `*${label} • ${dateValue}*\nNessuna uscita ancora impostata.`;
  }

  let block = `*${label} • ${dateValue}*\n`;
  block += `• *${item.primary_location}*`;

  if (item.secondary_location) {
    block += `\n• *${item.secondary_location}*`;
  }

  if (item.note_text) {
    block += `\n_${item.note_text}_`;
  }

  return block;
}

function buildNextWeekendMessage(weekendData) {
  const parts = [];

  parts.push('📍 *Dove siamo nel prossimo weekend*');
  parts.push(
    buildWeekendSingleDayBlock(
      'Sabato',
      weekendData.saturday_date,
      weekendData.saturday && weekendData.saturday.item ? weekendData.saturday.item : null,
      weekendData.saturday && weekendData.saturday.found === true
    )
  );
  parts.push(
    buildWeekendSingleDayBlock(
      'Domenica',
      weekendData.sunday_date,
      weekendData.sunday && weekendData.sunday.item ? weekendData.sunday.item : null,
      weekendData.sunday && weekendData.sunday.found === true
    )
  );

  return parts.join('\n\n');
}

function getWordPressBridgeUrlWithKey() {
  return `${WORDPRESS_BRIDGE_URL}?key=${encodeURIComponent(WORDPRESS_BRIDGE_KEY)}`;
}

function getWordPressReportUrlWithKey() {
  return `${WORDPRESS_REPORT_URL}?key=${encodeURIComponent(WORDPRESS_BRIDGE_KEY)}`;
}

function getWordPressPhotoDayUrlWithKey(dateValue = '') {
  let url = `${WORDPRESS_PHOTO_DAY_URL}?key=${encodeURIComponent(WORDPRESS_BRIDGE_KEY)}`;

  if (dateValue) {
    url += `&date=${encodeURIComponent(dateValue)}`;
  }

  return url;
}

function getWordPressNextWeekendUrlWithKey() {
  return `${WORDPRESS_NEXT_WEEKEND_URL}?key=${encodeURIComponent(WORDPRESS_BRIDGE_KEY)}`;
}

function getWordPressEventoAttivoUrlWithKey() {
  return `${WORDPRESS_EVENTO_ATTIVO_URL}?key=${encodeURIComponent(WORDPRESS_BRIDGE_KEY)}`;
}

function getWordPressEventoAlertUrlWithKey() {
  return `${WORDPRESS_EVENTO_ALERT_URL}?key=${encodeURIComponent(WORDPRESS_BRIDGE_KEY)}`;
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

async function fetchWordPressPhotoDay(dateValue = '') {
  if (!WORDPRESS_BRIDGE_KEY) {
    throw new Error('WORDPRESS_BRIDGE_KEY mancante');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(getWordPressPhotoDayUrlWithKey(dateValue), {
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

async function fetchWordPressNextWeekend() {
  if (!WORDPRESS_BRIDGE_KEY) {
    throw new Error('WORDPRESS_BRIDGE_KEY mancante');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(getWordPressNextWeekendUrlWithKey(), {
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

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeActiveEvent(data) {
  if (!data) {
    return null;
  }

  let item = null;

  if (data.item) {
    item = data.item;
  } else if (data.event) {
    item = data.event;
  } else if (data.found === true) {
    item = data;
  }

  if (!item) {
    return null;
  }

  const normalized = {
    id: item.id || item.event_id || item.slug || '',
    title: item.title || item.event_title || item.titolo || '',
    button_text: item.button_text || item.button_label || item.testo_bottone || item.tasto || '',
    image_url: item.image_url || item.poster_url || item.locandina_url || item.image || '',
    message_text: item.message_text || item.pre_message || item.message || item.messaggio || item.content || '',
    date_1: item.date_1 || item.event_date_1 || item.data_evento_1 || '',
    date_2: item.date_2 || item.event_date_2 || item.data_evento_2 || '',
    active: item.active
  };

  if (!normalized.button_text && normalized.title) {
    normalized.button_text = normalized.title;
  }

  return normalized;
}

function isActiveEventVisible(eventItem) {
  if (!eventItem) {
    return false;
  }

  if (eventItem.active === false || eventItem.active === 0 || eventItem.active === '0') {
    return false;
  }

  if (!eventItem.button_text) {
    return false;
  }

  if (!eventItem.date_2) {
    return true;
  }

  const endDate = new Date(String(eventItem.date_2) + 'T23:59:59');

  if (Number.isNaN(endDate.getTime())) {
    return true;
  }

  return Date.now() <= endDate.getTime();
}

async function fetchWordPressActiveEvent() {
  if (!WORDPRESS_BRIDGE_KEY) {
    throw new Error('WORDPRESS_BRIDGE_KEY mancante');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(getWordPressEventoAttivoUrlWithKey(), {
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
      return null;
    }

    const eventItem = normalizeActiveEvent(data);

    if (!isActiveEventVisible(eventItem)) {
      return null;
    }

    return eventItem;
  } finally {
    clearTimeout(timeout);
  }
}

async function saveEventAlertToWordPress(eventItem, msg) {
  if (!WORDPRESS_BRIDGE_KEY) {
    throw new Error('WORDPRESS_BRIDGE_KEY mancante');
  }

  const payload = {
    event_id: getEventId(eventItem),
    event_title: eventItem && eventItem.title ? String(eventItem.title) : '',
    button_text: eventItem && eventItem.button_text ? String(eventItem.button_text) : '',
    chat_id: msg && msg.chat && msg.chat.id ? String(msg.chat.id) : '',
    username: msg && msg.from && msg.from.username ? String(msg.from.username) : '',
    first_name: msg && msg.from && msg.from.first_name ? String(msg.from.first_name) : '',
    last_name: msg && msg.from && msg.from.last_name ? String(msg.from.last_name) : '',
    source: 'telegram'
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(getWordPressEventoAlertUrlWithKey(), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data || data.success !== true) {
      throw new Error('Salvataggio pre-iscrizione evento non riuscito');
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendActiveEventMessage(chatId) {
  try {
    const eventItem = await fetchWordPressActiveEvent();

    if (!eventItem) {
      await bot.sendMessage(
        chatId,
        'In questo momento non ci sono eventi o raduni attivi nel bot.'
      );
      return;
    }

    const caption =
      eventItem.message_text ||
      'Evento Motoevasioni attivo. Attiva l’avviso per ricevere la notifica quando le foto saranno online.';

    const replyMarkup = {
      inline_keyboard: [
        [
          {
            text: '🔔 AVVISAMI APPENA SONO ONLINE',
            callback_data: 'evento_avvisami'
          }
        ]
      ]
    };

    if (eventItem.image_url) {
      await bot.sendPhoto(chatId, eventItem.image_url, {
        caption: caption,
        reply_markup: replyMarkup
      });
      return;
    }

    await bot.sendMessage(chatId, caption, {
      reply_markup: replyMarkup
    });
  } catch (error) {
    console.error('Errore invio evento attivo:', error.message);

    await bot.sendMessage(
      chatId,
      'In questo momento non riesco a recuperare l’evento attivo. Riprova tra poco.'
    );
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

/*
  IMPORTANTE:
  Questa funzione NON deve mandare il messaggio "non disponibili".
  Deve solo:
  - inviare il contenuto legacy se esiste => return true
  - non inviare nulla se non esiste => return false
*/
async function sendLegacyOnlineContent(chatId) {
  const activeContent = getActiveOnlineContent();

  if (!activeContent) {
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

async function sendOnlineNotAvailableMessage(chatId) {
  await bot.sendMessage(
    chatId,
    'Le foto online non sono disponibili in questo momento.\n\nRiprova più tardi.'
  );
}

async function sendActiveOnlineContent(chatId) {
  try {
    const wpItem = await fetchWordPressActivePhoto();

    if (!wpItem) {
      const sentLegacy = await sendLegacyOnlineContent(chatId);

      if (!sentLegacy) {
        await sendOnlineNotAvailableMessage(chatId);
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
      await sendOnlineNotAvailableMessage(chatId);
    }
  }
}

async function sendPhotoInfoMessage(chatId) {
  try {
    const dayItem = await fetchWordPressPhotoDay();

    if (!dayItem) {
      await bot.sendMessage(
        chatId,
        'In questo momento non è ancora impostato un passo per oggi.\n\nPer verificare quando le foto saranno disponibili usa il pulsante 📸 Foto online nel menu.\nQuando le foto saranno attive, lì troverai direttamente il link corretto.'
      );
      return;
    }

    const message = buildPhotoDayMessage(dayItem);

    if (dayItem.image_url) {
      await bot.sendPhoto(chatId, dayItem.image_url, {
        caption: message,
        parse_mode: 'Markdown'
      });
      return;
    }

    await bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Errore WordPress Bridge /photo-day:', error.message);

    await bot.sendMessage(
      chatId,
      'Per sapere quando le foto saranno online, usa il pulsante 📸 Foto online nel menu.\nQuando le foto saranno disponibili, lì troverai direttamente il link corretto.'
    );
  }
}

async function sendPhotoInfoMessageForDate(chatId, dateValue) {
  try {
    if (!isValidDateString(dateValue)) {
      await bot.sendMessage(
        chatId,
        'Formato data non valido.\n\nUsa così:\n/info_foto_data 2026-04-12'
      );
      return;
    }

    const dayItem = await fetchWordPressPhotoDay(dateValue);

    if (!dayItem) {
      await bot.sendMessage(
        chatId,
        `Per la data ${dateValue} non risulta ancora impostato nessun passo.`
      );
      return;
    }

    const message = buildPhotoDayMessageForDate(dayItem, dateValue);

    if (dayItem.image_url) {
      await bot.sendPhoto(chatId, dayItem.image_url, {
        caption: message,
        parse_mode: 'Markdown'
      });
      return;
    }

    await bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Errore WordPress Bridge /photo-day con data:', error.message);

    await bot.sendMessage(
      chatId,
      'Errore nel recupero della data richiesta.\nRiprova tra poco.'
    );
  }
}

async function sendNextWeekendMessage(chatId) {
  try {
    const weekendData = await fetchWordPressNextWeekend();
    const message = buildNextWeekendMessage(weekendData);

    const saturdayItem = weekendData.saturday && weekendData.saturday.item ? weekendData.saturday.item : null;
    const sundayItem = weekendData.sunday && weekendData.sunday.item ? weekendData.sunday.item : null;

    const imageUrl =
      (saturdayItem && saturdayItem.image_url) ||
      (sundayItem && sundayItem.image_url) ||
      '';

    if (imageUrl) {
      await bot.sendPhoto(chatId, imageUrl, {
        caption: message,
        parse_mode: 'Markdown'
      });
      return;
    }

    await bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('Errore WordPress Bridge /next-weekend-photo-days:', error.message);

    await bot.sendMessage(
      chatId,
      'In questo momento non riesco a recuperare dove siamo nel prossimo weekend.\nRiprova tra poco.'
    );
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

function startAutoveloxFlow(chatId) {
  userState[chatId] = {
    step: 'autovelox_tipo'
  };

  bot.sendMessage(
    chatId,
    '🚨 *Segnalazioni Autovelox e Pattuglie Motoevasioni*\n\nSegnala solo da fermo e solo se la segnalazione è reale.\n\nScegli il tipo di segnalazione:',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📸 Autovelox fisso', callback_data: 'av_tipo_fisso' }
          ],
          [
            { text: '👮 Pattuglia / Telelaser', callback_data: 'av_tipo_pattuglia' }
          ],
          [
            { text: '⚠️ Controllo generico', callback_data: 'av_tipo_controllo' }
          ]
        ]
      }
    }
  );
}

function getAutoveloxTypeLabel(data) {
  if (data === 'av_tipo_fisso') {
    return 'Autovelox fisso';
  }

  if (data === 'av_tipo_pattuglia') {
    return 'Pattuglia / Telelaser';
  }

  if (data === 'av_tipo_controllo') {
    return 'Controllo generico';
  }

  return 'Segnalazione autovelox';
}

function buildAutoveloxBroadcastMessage(state) {
  let message =
    '⚠️ ATTENZIONE BIKER\n\n' +
    'Segnalazione live su strada.\n\n' +
    'Tipo: ' + state.autovelox_tipo + '\n' +
    'Passo/zona: ' + state.autovelox_passo + '\n';

  if (state.autovelox_note) {
    message += 'Nota: ' + state.autovelox_note + '\n';
  }

  if (state.autovelox_latitude && state.autovelox_longitude) {
    message +=
      'Posizione: https://maps.google.com/?q=' +
      encodeURIComponent(state.autovelox_latitude + ',' + state.autovelox_longitude) + '\n';
  } else {
    message += 'Posizione: non condivisa\n';
  }

  message +=
    '\nValidità indicativa: ' + AUTOVELOX_VALIDITY_MINUTES + ' minuti.\n' +
    'Usa queste informazioni solo per sicurezza e guida sempre nel rispetto dei limiti.';

  return message;
}

bot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
  registerSubscriber(msg);

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

  if (startParam === 'autovelox_live') {
    startAutoveloxFlow(chatId);
    return;
  }

  if (startParam === 'evento_attivo') {
    sendActiveEventMessage(chatId);
    return;
  }

  bot.sendMessage(
    chatId,
    'Ciao! Il bot Telegram Motoevasioni è online.\n\nComandi disponibili:\n/start\n/help\n/menu\n/sito\n/foto\n/foto_online\n/info_foto\n/dove_siamo_weekend\n/ride_match\n/moto_pass_map\n/rivista\n/roadbook\n/evasia\n/scopri_tour\n/autovelox\n/notifica_foto_online\n/id'
  );

  sendMainMenu(chatId);
});

bot.onText(/\/help/, (msg) => {
  registerSubscriber(msg);

  bot.sendMessage(
    msg.chat.id,
    'Comandi disponibili:\n' +
    '/start - Avvia il bot\n' +
    '/help - Mostra questo aiuto\n' +
    '/menu - Apri il menu self service\n' +
    '/sito - Apri il sito Motoevasioni\n' +
    '/foto - Vedi promo GridPass\n' +
    '/foto_online - Controlla se le foto online sono disponibili\n' +
    '/info_foto - Mostra il passo del giorno e come controllare le foto\n' +
    '/dove_siamo_weekend - Mostra dove siamo nel prossimo weekend\n' +
    '/ride_match - Apri Ride Match\n' +
    '/moto_pass_map - Apri Moto Pass Map\n' +
    '/rivista - Apri la Rivista Motoevasioni\n' +
    '/roadbook - Apri RoadBook Motoevasioni\n' +
    '/evasia - Apri EVASIA\n' +
    '/scopri_tour - Apri Scopri i tour\n' +
    '/autovelox - Segnala Autovelox Live\n' +
    '/notifica_foto_online - Avvisa gli iscritti che le foto sono online\n' +
    '/id - Mostra il tuo chat ID'
  );
});

bot.onText(/\/menu/, (msg) => {
  registerSubscriber(msg);
  sendMainMenu(msg.chat.id);
});

bot.onText(/\/sito/, (msg) => {
  registerSubscriber(msg);

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

bot.onText(/^\/foto$/, (msg) => {
  registerSubscriber(msg);
  sendGridPassPromo(msg.chat.id);
});

bot.onText(/^\/foto_online$/, async (msg) => {
  registerSubscriber(msg);
  await sendActiveOnlineContent(msg.chat.id);
});

bot.onText(/^\/info_foto$/, async (msg) => {
  registerSubscriber(msg);
  await sendPhotoInfoMessage(msg.chat.id);
});

/*
  Comando tecnico di backup/test.
  Non è mostrato nei menu pubblici.
*/
bot.onText(/^\/info_foto_data(?:\s+([0-9]{4}-[0-9]{2}-[0-9]{2}))?$/, async (msg, match) => {
  registerSubscriber(msg);
  const requestedDate = match && match[1] ? match[1].trim() : '';
  await sendPhotoInfoMessageForDate(msg.chat.id, requestedDate);
});

bot.onText(/^\/dove_siamo_weekend$/, async (msg) => {
  registerSubscriber(msg);
  await sendNextWeekendMessage(msg.chat.id);
});

bot.onText(/^\/ride_match$/, (msg) => {
  registerSubscriber(msg);
  sendRideMatch(msg.chat.id);
});

bot.onText(/^\/moto_pass_map$/, (msg) => {
  registerSubscriber(msg);
  sendMotoPassMap(msg.chat.id);
});

bot.onText(/^\/rivista$/, (msg) => {
  registerSubscriber(msg);
  sendRivista(msg.chat.id);
});

bot.onText(/^\/roadbook$/, (msg) => {
  registerSubscriber(msg);
  sendRoadBook(msg.chat.id);
});

bot.onText(/^\/evasia$/, (msg) => {
  registerSubscriber(msg);
  sendEvasia(msg.chat.id);
});

bot.onText(/^\/scopri_tour$/, (msg) => {
  registerSubscriber(msg);
  sendScopriTour(msg.chat.id);
});

bot.onText(/^\/autovelox$/, (msg) => {
  registerSubscriber(msg);
  startAutoveloxFlow(msg.chat.id);
});

bot.onText(/^\/iscritti$/, (msg) => {
  if (!isAdmin(msg.chat.id)) {
    return;
  }

  bot.sendMessage(msg.chat.id, getSubscriberStatsText());
});

bot.onText(/^\/notifica_foto_online$/, async (msg) => {
  if (!isAdmin(msg.chat.id)) {
    return;
  }

  const notificationMessage = buildFotoOnlineNotificationMessage();

  let broadcastResult = {
    total: 0,
    sent: 0,
    failed: 0
  };

  try {
    broadcastResult = await broadcastToSubscribers(notificationMessage, '');
  } catch (error) {
    console.error('Errore notifica foto online:', error.message);
  }

  bot.sendMessage(
    msg.chat.id,
    'Notifica foto online inviata.\n\n' +
    'Iscritti totali: ' + broadcastResult.total + '\n' +
    'Messaggi inviati: ' + broadcastResult.sent + '\n' +
    'Messaggi falliti: ' + broadcastResult.failed
  );
});

/*
  COMANDI ADMIN FOTO ONLINE LEGACY

  Restano attivi come backup temporaneo.
*/
bot.onText(/^\/attiva_online_one(?:\s+(\d+))?$/, (msg, match) => {
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

bot.onText(/^\/attiva_online_two(?:\s+(\d+))?$/, (msg, match) => {
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

bot.onText(/^\/disattiva_online$/, (msg) => {
  if (!isAdmin(msg.chat.id)) {
    return;
  }

  clearOnlineContent();

  bot.sendMessage(
    msg.chat.id,
    'Contenuto foto online legacy disattivato.'
  );
});

bot.onText(/^\/stato_online$/, async (msg) => {
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

bot.onText(/^\/debug_foto_online$/, async (msg) => {
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
  lines.push('WORDPRESS_PHOTO_DAY_URL: ' + WORDPRESS_PHOTO_DAY_URL);
  lines.push('WORDPRESS_NEXT_WEEKEND_URL: ' + WORDPRESS_NEXT_WEEKEND_URL);
  lines.push('WORDPRESS_EVENTO_ATTIVO_URL: ' + WORDPRESS_EVENTO_ATTIVO_URL);
  lines.push('WORDPRESS_EVENTO_ALERT_URL: ' + WORDPRESS_EVENTO_ALERT_URL);
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

  if (query.message && query.from) {
    registerSubscriber({
      chat: query.message.chat,
      from: query.from
    });
  }

  if (data === 'menu_evento_attivo') {
    bot.answerCallbackQuery(query.id);
    await sendActiveEventMessage(chatId);
    return;
  }

  if (data === 'evento_avvisami') {
    bot.answerCallbackQuery(query.id);

    try {
      const eventItem = await fetchWordPressActiveEvent();

      if (!eventItem) {
        await bot.sendMessage(
          chatId,
          'Evento non più attivo. Se le foto sono online, usa il pulsante 📸 Foto online.'
        );
        return;
      }

      const eventAlertMessage = {
        chat: query.message.chat,
        from: query.from
      };

      saveLocalEventAlert(eventItem, eventAlertMessage);

      try {
        await saveEventAlertToWordPress(eventItem, eventAlertMessage);
      } catch (error) {
        console.error('Errore salvataggio pre-iscrizione evento su WordPress:', error.message);
      }

      await bot.sendMessage(
        chatId,
        '✅ Avviso attivato.\n\nTi manderò una notifica appena l’archivio foto di questo evento sarà online.'
      );
    } catch (error) {
      console.error('Errore evento_avvisami:', error.message);

      await bot.sendMessage(
        chatId,
        'Non riesco ad attivare l’avviso in questo momento. Riprova tra poco.'
      );
    }

    return;
  }

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

  if (data === 'menu_autovelox_live') {
    bot.answerCallbackQuery(query.id);
    startAutoveloxFlow(chatId);
    return;
  }

  if (data === 'av_tipo_fisso' || data === 'av_tipo_pattuglia' || data === 'av_tipo_controllo') {
    bot.answerCallbackQuery(query.id);

    userState[chatId] = {
      step: 'autovelox_passo',
      autovelox_tipo: getAutoveloxTypeLabel(data)
    };

    bot.sendMessage(
      chatId,
      'Scrivi il nome del passo o della zona.\n\nEsempio: Passo Viamaggio, Spino, Mandrioli, Bocca Serriola.'
    );
    return;
  }

  if (data === 'menu_info_foto') {
    bot.answerCallbackQuery(query.id);
    await sendPhotoInfoMessage(chatId);
    return;
  }

  if (data === 'menu_next_weekend') {
    bot.answerCallbackQuery(query.id);
    await sendNextWeekendMessage(chatId);
    return;
  }

  if (data === 'menu_ride_match') {
    bot.answerCallbackQuery(query.id);
    sendRideMatch(chatId);
    return;
  }

  if (data === 'menu_moto_pass_map') {
    bot.answerCallbackQuery(query.id);
    sendMotoPassMap(chatId);
    return;
  }

  if (data === 'menu_evasia') {
    bot.answerCallbackQuery(query.id);
    sendEvasia(chatId);
    return;
  }

  if (data === 'menu_scopri_tour') {
    bot.answerCallbackQuery(query.id);
    sendScopriTour(chatId);
    return;
  }

  if (data === 'menu_rivista') {
    bot.answerCallbackQuery(query.id);
    sendRivista(chatId);
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

  if (data === 'menu_roadbook') {
    bot.answerCallbackQuery(query.id);
    sendRoadBook(chatId);
    return;
  }

  bot.answerCallbackQuery(query.id);
});

bot.on('message', async (msg) => {
  registerSubscriber(msg);

  const chatId = msg.chat.id;
  const text = msg.text;

  console.log('CHAT_ID:', chatId, 'TEXT:', text || '[no text]');

  if (msg.location && userState[chatId] && userState[chatId].step === 'autovelox_posizione') {
    userState[chatId].autovelox_latitude = msg.location.latitude;
    userState[chatId].autovelox_longitude = msg.location.longitude;
    userState[chatId].step = 'autovelox_note';

    bot.sendMessage(
      chatId,
      'Posizione ricevuta.\n\nOra scrivi una nota breve, oppure scrivi NO.\n\nEsempio: dopo il tornante, lato destro.'
    );
    return;
  }

  if (!text) {
    return;
  }

  if (text.startsWith('/')) {
    return;
  }

  if (!userState[chatId]) {
    return;
  }

  if (userState[chatId].step === 'autovelox_passo') {
    userState[chatId].autovelox_passo = text;
    userState[chatId].step = 'autovelox_posizione';

    bot.sendMessage(
      chatId,
      'Ora invia la posizione precisa dal telefono.\n\nSu Telegram premi la graffetta 📎 oppure il pulsante + e scegli Posizione.\n\nSe non vuoi inviarla, scrivi NO.',
      {
        reply_markup: {
          keyboard: [
            [
              {
                text: '📍 Invia posizione',
                request_location: true
              }
            ]
          ],
          resize_keyboard: true,
          one_time_keyboard: true
        }
      }
    );
    return;
  }

  if (userState[chatId].step === 'autovelox_posizione') {
    if (String(text).trim().toLowerCase() === 'no') {
      userState[chatId].step = 'autovelox_note';
      bot.sendMessage(
        chatId,
        'Ok, senza posizione GPS.\n\nOra scrivi una nota breve, oppure scrivi NO.',
        {
          reply_markup: {
            remove_keyboard: true
          }
        }
      );
      return;
    }

    bot.sendMessage(
      chatId,
      'Per la posizione usa il pulsante “📍 Invia posizione”, oppure scrivi NO.'
    );
    return;
  }

  if (userState[chatId].step === 'autovelox_note') {
    if (String(text).trim().toLowerCase() === 'no') {
      userState[chatId].autovelox_note = '';
    } else {
      userState[chatId].autovelox_note = String(text).trim();
    }

    const state = userState[chatId];
    const broadcastMessage = buildAutoveloxBroadcastMessage(state);

    const reportPayload = {
      chat_id: chatId,
      username: msg.from && msg.from.username ? String(msg.from.username) : '',
      first_name: msg.from && msg.from.first_name ? String(msg.from.first_name) : '',
      last_name: msg.from && msg.from.last_name ? String(msg.from.last_name) : '',
      report_type: 'autovelox_live',
      location_name: state.autovelox_passo ? String(state.autovelox_passo).trim() : '',
      message_text: broadcastMessage,
      latitude: state.autovelox_latitude ? String(state.autovelox_latitude) : '',
      longitude: state.autovelox_longitude ? String(state.autovelox_longitude) : '',
      status: 'live',
      source: 'telegram',
      valid_minutes: AUTOVELOX_VALIDITY_MINUTES
    };

    let wpSaveNote = 'Salvataggio WordPress: non eseguito.';

    try {
      const wpResult = await saveReportToWordPress(reportPayload);
      wpSaveNote = 'Salvataggio WordPress: OK (ID ' + wpResult.report_id + ').';
    } catch (error) {
      console.error('Errore salvataggio autovelox su WordPress:', error.message);
      wpSaveNote = 'Salvataggio WordPress: errore.';
    }

    let broadcastResult = {
      total: 0,
      sent: 0,
      failed: 0
    };

    try {
      broadcastResult = await broadcastToSubscribers(broadcastMessage, chatId);
    } catch (error) {
      console.error('Errore broadcast autovelox:', error.message);
    }

    bot.sendMessage(
      ADMIN_CHAT_ID,
      'Nuova segnalazione AUTOVELOX LIVE:\n\n' +
      'Da chat ID: ' + chatId + '\n' +
      'Tipo: ' + state.autovelox_tipo + '\n' +
      'Passo/zona: ' + state.autovelox_passo + '\n' +
      'Nota: ' + (state.autovelox_note || '(nessuna)') + '\n' +
      'Broadcast inviati: ' + broadcastResult.sent + '\n' +
      'Broadcast falliti: ' + broadcastResult.failed + '\n' +
      wpSaveNote
    );

    delete userState[chatId];

    bot.sendMessage(
      chatId,
      '✅ Segnalazione inviata.\n\nAvviso mandato agli iscritti del bot.\nValidità indicativa: ' + AUTOVELOX_VALIDITY_MINUTES + ' minuti.',
      {
        reply_markup: {
          remove_keyboard: true
        }
      }
    );
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

bot.onText(/^\/id$/, (msg) => {
  registerSubscriber(msg);
  bot.sendMessage(msg.chat.id, 'Il tuo chat ID è: ' + msg.chat.id);
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

console.log('Bot avviato.');
