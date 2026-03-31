// PM2 process manager config — used for direct Node deployment (no Docker)
// Run:   npm run build && pm2 start ecosystem.config.js
// Save:  pm2 save && pm2 startup
// Docs:  https://pm2.keymetrics.io/docs/usage/application-declaration/

module.exports = {
  apps: [
    {
      name: "whatsapp-ai",
      script: "dist/index.js",
      interpreter: "node",

      // CRITICAL: Must be 1 — WhatsApp Baileys sessions are NOT multi-instance safe.
      // Running 2+ instances will break the WhatsApp connection.
      instances: 1,

      // REQUIRED: dns-preload.js must load before the app.
      // Without this, MongoDB Atlas SRV DNS lookups fail on startup.
      node_args: "--require ./dns-preload.js",

      autorestart: true,        // Restart on crash
      watch: false,             // NEVER watch files in production
      max_memory_restart: "500M",

      env: {
        NODE_ENV: "production",
      },

      // Logging
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,

      // Graceful shutdown — allows SIGTERM to cleanly close MongoDB + WhatsApp
      kill_timeout: 10000,      // 10s to finish in-flight messages before force-kill
      listen_timeout: 8000,     // 8s for app to be ready before PM2 marks it as failed
    },
  ],
};
