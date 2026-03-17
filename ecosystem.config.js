module.exports = {
  apps: [
    {
      name: 'bhutan-devi-trades',
      script: './bin/www.js',
      instances: 0, // 0 means as many instances as CPU cores
      exec_mode: 'cluster',
      watch: false, // Or true, but restarts on file change
      max_memory_restart: '256M',
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
