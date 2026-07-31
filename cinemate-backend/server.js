require("dotenv").config();
const express = require("express");
const cors = require("cors");

const requestLogger = require("./middleware/requestLogger");
const errorHandler = require("./middleware/errorHandler");

const voiceRoutes = require("./routes/voiceRoutes");
const summarizeRoutes = require("./routes/summarizeRoutes");
const memoryRoutes = require("./routes/memoryRoutes");
const chatRoutes = require("./routes/chatRoutes");

const app = express();

app.use(cors());
app.use(requestLogger);
app.use(express.json());

app.use(voiceRoutes);
app.use(summarizeRoutes);
app.use(memoryRoutes);
app.use(chatRoutes);

app.use(errorHandler);

app.listen(3000, () => {
  console.log("🚀 CineMate server running on port 3000");
});
