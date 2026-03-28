module.exports = {
  apps: [
    {
      name: "control-horas-backend",
      cwd: "/home/agus/control-horas/backend",
      script: "npm",
      args: "start",
      env: {
        PORT: "3001"
      }
    },
    {
      name: "control-horas-frontend",
      cwd: "/home/agus/control-horas/frontend",
      script: "python3",
      args: "-m http.server 8080 --bind 0.0.0.0"
    }
  ]
};
