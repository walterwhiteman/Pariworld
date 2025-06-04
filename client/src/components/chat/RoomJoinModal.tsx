import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lock, MessageCircle } from 'lucide-react';

interface RoomJoinModalProps {
  isOpen: boolean;
  onJoinRoom: (roomId: string, username: string) => void;
  isConnecting?: boolean;
}

/**
 * Modal component for users to enter room ID and username to join a private chat
 * Implements the room-based authentication system for two-person chats
 */
export function RoomJoinModal({ isOpen, onJoinRoom, isConnecting = false }: RoomJoinModalProps) {
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const [errors, setErrors] = useState<{ roomId?: string; username?: string }>({});

  /**
   * Validate form inputs
   */
  const validateForm = (): boolean => {
    const newErrors: { roomId?: string; username?: string } = {};

    if (!roomId.trim()) {
      newErrors.roomId = 'Room ID is required';
    } else if (roomId.length < 3) {
      newErrors.roomId = 'Room ID must be at least 3 characters';
    }

    if (!username.trim()) {
      newErrors.username = 'Username is required';
    } else if (username.length < 2) {
      newErrors.username = 'Username must be at least 2 characters';
    } else if (username.length > 20) {
      newErrors.username = 'Username must be less than 20 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  /**
   * Handle form submission
   */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (validateForm()) {
      onJoinRoom(roomId.trim(), username.trim());
    }
  };

  /**
   * Handle input changes and clear related errors
   */
  const handleRoomIdChange = (value: string) => {
    setRoomId(value);
    if (errors.roomId) {
      setErrors(prev => ({ ...prev, roomId: undefined }));
    }
  };

  const handleUsernameChange = (value: string) => {
    setUsername(value);
    if (errors.username) {
      setErrors(prev => ({ ...prev, username: undefined }));
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" hideCloseButton>
        <DialogHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-600">
            <MessageCircle className="h-8 w-8 text-white" />
          </div>
          <DialogTitle className="text-2xl font-semibold text-gray-900">
            Join Private Chat
          </DialogTitle>
          <p className="text-gray-600">
            Enter a shared room ID and your name to start chatting privately
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Room ID Input */}
          <div className="space-y-2">
            <Label htmlFor="roomId" className="text-sm font-medium text-gray-700">
              <Lock className="mr-2 inline h-4 w-4" />
              Room ID / Passcode
            </Label>
            <Input
              id="roomId"
              type="text"
              placeholder="Enter shared room ID..."
              value={roomId}
              onChange={(e) => handleRoomIdChange(e.target.value)}
              className={`transition-all ${
                errors.roomId 
                  ? 'border-red-500 focus:ring-red-500' 
                  : 'focus:ring-blue-500'
              }`}
              disabled={isConnecting}
              autoFocus
            />
            {errors.roomId && (
              <p className="text-sm text-red-600">{errors.roomId}</p>
            )}
          </div>

          {/* Username Input */}
          <div className="space-y-2">
            <Label htmlFor="username" className="text-sm font-medium text-gray-700">
              Your Name
            </Label>
            <Input
              id="username"
              type="text"
              placeholder="Enter your name..."
              value={username}
              onChange={(e) => handleUsernameChange(e.target.value)}
              className={`transition-all ${
                errors.username 
                  ? 'border-red-500 focus:ring-red-500' 
                  : 'focus:ring-blue-500'
              }`}
              disabled={isConnecting}
              maxLength={20}
            />
            {errors.username && (
              <p className="text-sm text-red-600">{errors.username}</p>
            )}
          </div>

          {/* Join Button */}
          <Button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 focus:ring-blue-500"
            disabled={isConnecting}
          >
            {isConnecting ? (
              <>
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Connecting...
              </>
            ) : (
              'Join Chat Room'
            )}
          </Button>
        </form>

        {/* Instructions */}
        <div className="mt-6 text-center">
          <p className="text-xs text-gray-500">
            Share the same Room ID with your chat partner to connect privately.
            <br />
            No registration required - just enter and start chatting!
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
