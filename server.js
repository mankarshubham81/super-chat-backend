const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const redis = require("redis");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL,
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"],
});


// Redis configuration
const redisClient = redis.createClient({
  username: "default",
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
  },
});

console.log("Connecting to Redis with POrt:", process.env.REDIS_URL);


redisClient.connect().catch((err) => console.error("Redis Connection Error:", err));

redisClient.on("error", (err) => console.error("Redis Client Error:", err));
redisClient.on("connect", () => console.log("Connected to Redis"));

// Utility to save messages to Redis
async function saveMessage(room, message) {
  try {
    const key = `room:${room}:messages`;
    await redisClient.rPush(key, JSON.stringify(message));
    await redisClient.expire(key, 1 * 60 * 60); // Messages expire in 1 day
  } catch (err) {
    console.error("Error saving message to Redis:", err);
  }
}

// Utility to fetch recent messages
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

const users = {};
const rooms = {};

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("join-room", async ({ room, userName }) => {
    // Track user and room details
    if (!rooms[room]) rooms[room] = [];
    users[socket.id] = { userName, room };
    rooms[room].push({ id: socket.id, userName });

    socket.join(room);

    // Fetch and send recent messages to the new user
    const recentMessages = await getRecentMessages(room);
    socket.emit("recent-messages", recentMessages);

    // Notify the room about the new user and update the user list
    io.to(room).emit("notification", `${userName} joined the room.`);
    io.to(room).emit("user-list", rooms[room]);
  });

  socket.on("send-message", async ({ room, message }) => {
    const timestamp = new Date().toISOString();
    const messageId = `${socket.id}-${Date.now()}`;
    const fullMessage = {
      id: messageId,
      sender: users[socket.id]?.userName,
      text: message.text,
      timestamp,
      replyTo: message.replyTo || null,
    };

    // Save the message in Redis
    await saveMessage(room, fullMessage);

    // Broadcast the message to all users in the room
    io.to(room).emit("receive-message", fullMessage);
  });

  socket.on("typing", ({ room }) => {
    const userName = users[socket.id]?.userName;
    if (!userName) return;

    socket.to(room).emit("typing", [userName]);

    // Remove typing status after a delay
    setTimeout(() => {
      socket.to(room).emit("typing", []);
    }, 2000);
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
