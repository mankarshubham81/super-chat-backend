const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const redis = require("redis");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

// Initialize Socket.io server
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});

// Redis client setup
const redisClient = redis.createClient({
  username: "default",
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
  },
});

redisClient
  .connect()
  .then(() => console.log("Connected to Redis"))
  .catch((err) => console.error("Redis connection error:", err));

redisClient.on("error", (err) => console.error("Redis error:", err));

// Utility functions for Redis
async function saveMessage(room, message) {
  try {
    const key = `room:${room}:messages`;
    await redisClient.rPush(key, JSON.stringify(message));
    await redisClient.expire(key, 24 * 60 * 60); // Messages expire after 1 day
  } catch (err) {
    console.error("Error saving message to Redis:", err);
  }
}

async function getRecentMessages(room) {
  try {
    const key = `room:${room}:messages`;
    const messages = await redisClient.lRange(key, 0, -1);
    return messages.map((msg) => JSON.parse(msg));
  } catch (err) {
    console.error("Error fetching messages from Redis:", err);
    return [];
  }
}

// User and room tracking
const users = {};
const rooms = {};

// Socket.io event handling
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Handle user joining a room
  socket.on("join-room", async ({ room, userName }) => {
    try {
      // Track users and rooms
      if (!rooms[room]) rooms[room] = [];
      users[socket.id] = { userName, room };
      rooms[room].push({ id: socket.id, userName });

      socket.join(room);

      // Fetch and send recent messages to the user
      const recentMessages = await getRecentMessages(room);
      socket.emit("recent-messages", recentMessages);

      // Notify others in the room
      io.to(room).emit("notification", `${userName} joined the room.`);
      io.to(room).emit("user-list", rooms[room]);
    } catch (err) {
      console.error("Error in join-room handler:", err);
    }
  });

  // Handle user sending a message
  socket.on("send-message", async ({ room, message }) => {
    try {
      const timestamp = new Date().toISOString();
      const messageId = `${socket.id}-${Date.now()}`;
      const fullMessage = {
        id: messageId,
        sender: users[socket.id]?.userName,
        text: message.text,
        timestamp,
        replyTo: message.replyTo || null,
      };

      // Save the message and broadcast it
      await saveMessage(room, fullMessage);
      io.to(room).emit("receive-message", fullMessage);
    } catch (err) {
      console.error("Error in send-message handler:", err);
    }
  });

  // Handle user typing
  socket.on("typing", ({ room }) => {
    const userName = users[socket.id]?.userName;
    if (!userName) return;

    socket.to(room).emit("typing", [userName]);

    // Clear typing status after 2 seconds
    setTimeout(() => {
      socket.to(room).emit("typing", []);
    }, 2000);
  });

  // Handle user disconnection
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

// Basic API route
app.get("/", (req, res) => {
  res.send("Server is running");
});

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
