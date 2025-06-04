import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User schema for basic user info
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

// Chat room schema for room-based messaging
export const chatRooms = pgTable("chat_rooms", {
  id: serial("id").primaryKey(),
  roomId: text("room_id").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Messages schema for storing chat messages
export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  roomId: text("room_id").notNull(),
  sender: text("sender").notNull(),
  content: text("content"),
  imageData: text("image_data"), // Base64 encoded image
  messageType: text("message_type").notNull().default("text"), // "text" | "image" | "system"
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// Room participants for tracking active users
export const roomParticipants = pgTable("room_participants", {
  id: serial("id").primaryKey(),
  roomId: text("room_id").notNull(),
  username: text("username").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertChatRoomSchema = createInsertSchema(chatRooms).pick({
  roomId: true,
});

export const insertMessageSchema = createInsertSchema(messages).pick({
  roomId: true,
  sender: true,
  content: true,
  imageData: true,
  messageType: true,
});

export const insertRoomParticipantSchema = createInsertSchema(roomParticipants).pick({
  roomId: true,
  username: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertChatRoom = z.infer<typeof insertChatRoomSchema>;
export type ChatRoom = typeof chatRooms.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertRoomParticipant = z.infer<typeof insertRoomParticipantSchema>;
export type RoomParticipant = typeof roomParticipants.$inferSelect;
