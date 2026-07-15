import 'dotenv/config'

const required = ['WALLET_ADDRESS']

export const config = {
  wallet: process.env.WALLET_ADDRESS ?? '',
  heliusApiKey: process.env.HELIUS_API_KEY ?? '',
  webhookUrl: process.env.WEBHOOK_URL ?? '',
  webhookAuth: process.env.WEBHOOK_AUTH ?? '',
  port: Number(process.env.PORT ?? 3031),
  referralLink: process.env.REFERRAL_LINK ?? '',
  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL ?? '',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    chatId: process.env.TELEGRAM_CHAT_ID ?? '',
  },
  x: {
    apiKey: process.env.X_API_KEY ?? '',
    apiSecret: process.env.X_API_SECRET ?? '',
    accessToken: process.env.X_ACCESS_TOKEN ?? '',
    accessSecret: process.env.X_ACCESS_SECRET ?? '',
  },
}

export function assertConfig() {
  const missing = required.filter((k) => !process.env[k])
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}. Copy .env.example to .env.`)
  }
}

export function enabledChannels() {
  return {
    discord: Boolean(config.discord.webhookUrl),
    telegram: Boolean(config.telegram.botToken && config.telegram.chatId),
    x: Boolean(config.x.apiKey && config.x.accessToken),
  }
}
