const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors")
require("dotenv").config();

const app = express();
app.use(cors())
app.use(express.urlencoded({extended: true}))
// app.use(express.json());
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL, // Allow requests from your frontend URL
    methods: ["GET", "POST"],
  },
  transports: ['websocket', 'polling']
});



io.on("connection", (socket) => {
  console.log("SERVER A user connected:", socket.id);

  socket.on("join-room", (room) => {
    socket.join(room);
    console.log(`User ${socket.id} joined room ${room}`);
  });

  socket.on("send-message", ({ room, message }) => {
    io.to(room).emit("receive-message", message);
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});