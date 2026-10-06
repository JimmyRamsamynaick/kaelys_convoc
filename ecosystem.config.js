module.exports = {
  apps: [
    {
      name: "kaelys-convoc-bot",
      script: "./index.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 3000,
      min_uptime: "10s",
      listen_timeout: 15000,
      kill_timeout: 8000,
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      log_file: "./logs/pm2-combined.log",
      time: true,
      merge_logs: true,
      max_memory_restart: "1.5G",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
