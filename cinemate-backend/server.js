const express = require("express");
const cors = require("cors");

const config = require("./config");
const requestLogger = require("./middleware/requestLogger");
const errorHandler = require("./middleware/errorHandler");

const healthRoutes = require("./routes/healthRoutes");
const voiceRoutes = require("./routes/voiceRoutes");
const summarizeRoutes = require("./routes/summarizeRoutes");
const memoryRoutes = require("./routes/memoryRoutes");
const chatRoutes = require("./routes/chatRoutes");

const app = express();

app.use(cors());
app.use(requestLogger);
// A full film's captions can be a few hundred KB – the default limit is 100 KB.
app.use(express.json({ limit: "2mb" }));

app.use(healthRoutes);
app.use(voiceRoutes);
app.use(summarizeRoutes);
app.use(memoryRoutes);
app.use(chatRoutes);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`🚀 CineMate server running on port ${config.port}`);
  console.log(`   ${config.describeConfig()}`);
});