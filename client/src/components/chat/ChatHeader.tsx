import { Users, Video, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ChatHeaderProps {
  roomId: string;
  isConnected: boolean;
  participantCount: number;
  onStartVideoCall: () => void;
  onLeaveRoom: () => void;
  className?: string; // <-- ADDED THIS LINE
}

/**
 * Chat header component displaying room info and action buttons
 * Shows connection status, participant count, and video call/leave options
 */
export function ChatHeader({
  roomId,
  isConnected,
  participantCount,
  onStartVideoCall,
  onLeaveRoom,
  className // <-- ADDED THIS LINE
}: ChatHeaderProps) {
  return (
    // Apply the className to the root header element
    <header className={`flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 shadow-sm ${className}`}> {/* <-- MODIFIED THIS LINE */}
      {/* Room Info */}
      <div className="flex items-center space-x-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500">
          <Users className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="font-semibold text-gray-900">
            Room: {roomId}
          </h1>
          <p className="text-sm text-gray-500">
            <span
              className={`mr-2 inline-block h-2 w-2 rounded-full ${
                isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
              }`}
            />
            {isConnected ? (
              `${participantCount} connected`
            ) : (
              'Disconnected'
            )}
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center space-x-2">
        {/* Video Call Button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onStartVideoCall}
          className="text-gray-600 hover:text-blue-600 hover:bg-gray-100"
          disabled={!isConnected}
          title="Start video call"
        >
          <Video className="h-5 w-5" />
        </Button>

        {/* Leave Room Button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onLeaveRoom}
          className="text-gray-600 hover:text-red-600 hover:bg-red-50"
          title="Leave chat room"
        >
          <LogOut className="h-5 w-5" />
        </Button>
      </div>
    </header>
  );
}
