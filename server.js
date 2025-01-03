const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    methods: ["GET", "POST"],
    credentials: true,
  })
);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL,
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});

const users = {};
const rooms = {};

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("join-room", ({ room, userName }) => {
    users[socket.id] = { userName, room };

    if (!rooms[room]) rooms[room] = [];
    rooms[room].push({ id: socket.id, userName });

    socket.join(room);

    io.to(room).emit("notification", `${userName} joined the room.`);
    io.to(room).emit("user-list", rooms[room]);
  });

  socket.on("send-message", ({ room, message }) => {
    const timestamp = new Date().toISOString();
    const messageId = `${socket.id}-${Date.now()}`;
    io.to(room).emit("receive-message", {
      id: messageId,
      sender: users[socket.id]?.userName,
      text: message.text,
      timestamp,
      replyTo: message.replyTo || null,
    });
  });

  socket.on("react-message", ({ room, messageId, reaction }) => {
    io.to(room).emit("message-reaction", { messageId, reaction });
  });

  socket.on("edit-message", ({ room, messageId, newText }) => {
    io.to(room).emit("update-message", { messageId, newText });
  });

  socket.on("delete-message", ({ room, messageId }) => {
    io.to(room).emit("remove-message", { messageId });
  });

  socket.on("disconnect", () => {
    const { userName, room } = users[socket.id] || {};
    if (room) {
      rooms[room] = rooms[room].filter((user) => user.id !== socket.id);
      io.to(room).emit("notification", `${userName} left the room.`);
      io.to(room).emit("user-list", rooms[room]);
    }

    delete users[socket.id];
    console.log(`${userName || "A user"} disconnected`);
  });
});

app.get("/", (req, res) => {
  res.send("Server is running");
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
