import { pgTable, serial, text, timestamp, boolean } from 'drizzle-orm/pg-core'; // Import from pg-core
import { relations } from 'drizzle-orm'; // Import relations
import { createInsertSchema, createSelectSchema } from 'drizzle-zod'; // Import from drizzle-zod
import { z } from 'zod'; // Import z from zod

// Define messages table
export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  roomId: text('room_id').notNull(),
  sender: text('sender').notNull(),
  content: text('content'),
  imageData: text('image_data'), // Base64 image data
  messageType: text('message_type').notNull().default('text'), // 'text' or 'image' or 'system'
  timestamp: timestamp('timestamp').notNull().defaultNow(),
});

// Define roomParticipants table
export const roomParticipants = pgTable('room_participants', {
  id: serial('id').primaryKey(),
  roomId: text('room_id').notNull(),
  username: text('username').notNull(),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
  lastSeen: timestamp('last_seen').notNull().defaultNow(),
});

// Define relations (optional, but good for Drizzle ORM)
export const messagesRelations = relations(messages, ({ one }) => ({
  // Example: if messages had a direct relation to participants
  // senderUser: one(roomParticipants, { fields: [messages.sender], references: [roomParticipants.username] }),
}));

export const roomParticipantsRelations = relations(roomParticipants, ({ many }) => ({
  // Example: if rooms had messages
  // messages: many(messages),
}));


// Zod schemas for validation (optional, but good practice)
export const insertMessageSchema = createInsertSchema(messages);
export const selectMessageSchema = createSelectSchema(messages);

export const insertRoomParticipantSchema = createInsertSchema(roomParticipants);
export const selectRoomParticipantSchema = createSelectSchema(roomParticipants);

export type Message = z.infer<typeof selectMessageSchema>;
export type NewMessage = z.infer<typeof insertMessageSchema>;

export type RoomParticipant = z.infer<typeof selectRoomParticipantSchema>;
export type NewRoomParticipant = z.infer<typeof insertRoomParticipantSchema>;
