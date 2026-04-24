module.exports = {
  apps: [{
    name: 'yandex-market-chats',
    script: 'src/index.js',
    watch: false,
    max_memory_restart: '200M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: 'logs/err.log',
    out_file: 'logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    combine_logs: true
  }]
};
