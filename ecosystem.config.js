// PM2 process manager config — used for direct Node deployment (no Docker)
// Run: pm2 start ecosystem.config.js
// Docs: https://pm2.keymetrics.io/docs/usage/application-declaration/

module.exports = {
  apps: [
    {
      name: "whatsapp-ai",
      script: "dist/index.js",
      interpreter: "node",
      instances: 1,          // Must be 1 — WhatsApp sessions are single-instance
      autorestart: true,     // Restart on crash
      watch: false,          // Do NOT watch files in production
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
      },
      // Logging
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
    },
  ],
};
