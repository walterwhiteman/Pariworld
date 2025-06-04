import { users, roomParticipants, messages, type User, type InsertUser, type RoomParticipant } from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";

// Define ChatMessage interface for server use
interface ChatMessage {
  id: string;
  roomId: string;
  sender: string;
  content?: string;
  imageData?: string;
  messageType: 'text' | 'image' | 'system';
  timestamp: Date;
}

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  addRoomParticipant(roomId: string, username: string): Promise<void>;
  removeRoomParticipant(roomId: string, username: string): Promise<void>;
  getRoomParticipants(roomId: string): Promise<RoomParticipant[]>;
  addMessage(message: ChatMessage): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async addRoomParticipant(roomId: string, username: string): Promise<void> {
    // Check if participant already exists
    const [existing] = await db
      .select()
      .from(roomParticipants)
      .where(and(
        eq(roomParticipants.roomId, roomId),
        eq(roomParticipants.username, username)
      ));

    if (!existing) {
      // Add new participant
      await db.insert(roomParticipants).values({
        roomId,
        username,
        isActive: true
      });
    } else {
      // Update existing participant to active
      await db
        .update(roomParticipants)
        .set({ isActive: true })
        .where(and(
          eq(roomParticipants.roomId, roomId),
          eq(roomParticipants.username, username)
        ));
    }
  }

  async removeRoomParticipant(roomId: string, username: string): Promise<void> {
    await db
      .update(roomParticipants)
      .set({ isActive: false })
      .where(and(
        eq(roomParticipants.roomId, roomId),
        eq(roomParticipants.username, username)
      ));
  }

  async getRoomParticipants(roomId: string): Promise<RoomParticipant[]> {
    return await db
      .select()
      .from(roomParticipants)
      .where(and(
        eq(roomParticipants.roomId, roomId),
        eq(roomParticipants.isActive, true)
      ));
  }

  async addMessage(message: ChatMessage): Promise<void> {
    await db.insert(messages).values({
      roomId: message.roomId,
      sender: message.sender,
      content: message.content,
      imageData: message.imageData,
      messageType: message.messageType
    });
  }
}

export const storage = new DatabaseStorage();
