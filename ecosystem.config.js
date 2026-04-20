module.exports = {
  apps: [{
    name: 'gpu-tracker',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      // JIRA config - set via server environment variables:
      // JIRA_BASE_URL: 'https://jira01.birentech.com',
      // JIRA_PAT: 'your-personal-access-token'
    }
  }]
};
