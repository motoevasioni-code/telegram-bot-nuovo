const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    'Ciao! Il bot Telegram Motoevasioni è online.\n\nComandi disponibili:\n/start\n/help\n/sito'
  );
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    'Comandi disponibili:\n/start - Avvia il bot\n/help - Mostra questo aiuto\n/sito - Apri il sito Motoevasioni'
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

console.log('Bot avviato.');
