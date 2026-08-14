// Telegram alert channel. Silently no-ops when the bot is not configured,
// so the watcher can run standalone with console output only.
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;

export async function sendAlert(text) {
  if (!TOKEN || !CHAT) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text, disable_web_page_preview: true }),
    });
    if (!res.ok) console.error('telegram: HTTP', res.status);
  } catch (e) {
    console.error('telegram:', e.message);
  }
}
