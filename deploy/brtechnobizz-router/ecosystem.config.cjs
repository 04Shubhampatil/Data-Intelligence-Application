// pm2 processes behind nginx on brtechnobizz.tech (all run as the "brtechnobizz" user).
//   router        127.0.0.1:3000  <- nginx (CloudPanel "location /")
//   mahapanchayat *:3002          /egram         (~/htdocs/brtechnobizz.tech, its own .env, unchanged)
//   resourcedata  127.0.0.1:3010  /resourcedata  (~/resourcedata, already defined in ~/resourcedata/ecosystem.config.cjs)
// Start the two new ones:  pm2 start ~/router/ecosystem.config.cjs --only mahapanchayat   (and --only router)
module.exports = {
  apps: [
    {
      name: "router",
      cwd: "/home/brtechnobizz/router",
      script: "router.js",
      // http-proxy 1.18 uses util._extend, which Node 24 flags as deprecated (harmless); keep the error log readable.
      node_args: "--no-deprecation",
      env: { NODE_ENV: "production", PORT: "3000", HOST: "127.0.0.1", RESOURCEDATA_TARGET: "http://127.0.0.1:3010", MAHAPANCHAYAT_TARGET: "http://127.0.0.1:3002" },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "200M",
      wait_ready: true,
      listen_timeout: 8000,
      kill_timeout: 5000,
      time: true,
    },
    {
      // Same app, same folder, same .env and build as the old "egram" process — only the port differs.
      name: "mahapanchayat",
      cwd: "/home/brtechnobizz/htdocs/brtechnobizz.tech",
      script: "npm",
      args: "start -- -p 3002",
      autorestart: true,
      kill_timeout: 8000,
      time: true,
    },
  ],
};
