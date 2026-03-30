const serverless = require("serverless-http");
const { app } = require("../../backend/server");

exports.handler = serverless(app, {
  basePath: "/.netlify/functions/api"
});
