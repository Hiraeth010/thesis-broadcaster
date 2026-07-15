import 'dotenv/config'

// Startup-only knobs. Everything user-configurable lives in settings.js so the
// setup UI can change it without a restart.
export const config = {
  port: Number(process.env.PORT ?? 3031),
  webhookAuth: process.env.WEBHOOK_AUTH ?? '',
  heliusApiKey: process.env.HELIUS_API_KEY ?? '',
  webhookUrl: process.env.WEBHOOK_URL ?? '',
  // Overridable so the Telegram client can be pointed at a mock in tests.
  telegramApiBase: process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org',
}
