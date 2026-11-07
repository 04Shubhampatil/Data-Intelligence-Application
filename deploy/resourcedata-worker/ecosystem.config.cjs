// pm2: the MahaHRD sync worker for https://brtechnobizz.tech/resourcedata (runs as the "brtechnobizz" user).
// It picks up syncs started on the website, runs schedules, signs in to MahaHRD with the password saved in
// Settings → Source connection, and handles "Test connection".
// Settings come from ~/resourcedata/.env (the same file as the website: database, encryption key, document folder).
// Headless Chromium and its libraries live in ~/resourcedata/pw-browsers and ~/resourcedata/chromium-libs (no root needed).
const HOME = "/home/brtechnobizz/resourcedata";
module.exports = {
  apps: [
    {
      name: "resourcedata-worker",
      cwd: `${HOME}/worker`,
      script: "apps/worker/src/cli/worker.ts",
      interpreter: "node",
      node_args: `--env-file=${HOME}/.env --import tsx`,
      env: {
        NODE_ENV: "production",
        PLAYWRIGHT_BROWSERS_PATH: `${HOME}/pw-browsers`,
        LD_LIBRARY_PATH: `${HOME}/chromium-libs/root/usr/lib/x86_64-linux-gnu:${HOME}/chromium-libs/root/lib/x86_64-linux-gnu`,
        SYNC_PROFILE_CONCURRENCY: "1", // one employee at a time: the server has 1 CPU and also runs two websites
        SYNC_KEEP_AWAKE: "0",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1200M",
      kill_timeout: 30000, // a stop lets the current employee finish; the job resumes from its checkpoint
      time: true,
    },
  ],
};
