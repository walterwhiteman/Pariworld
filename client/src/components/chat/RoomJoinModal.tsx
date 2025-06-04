import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useRef, useEffect } from "react";

interface RoomJoinModalProps {
    isOpen: boolean;
    onJoin: (roomId: string, username: string) => void;
    isConnecting: boolean;
}

/**
 * Modal for users to enter a room ID and username to join a chat.
 */
export function RoomJoinModal({ isOpen, onJoin, isConnecting }: RoomJoinModalProps) {
    const [roomId, setRoomId] = useState("");
    const [username, setUsername] = useState("");
    const usernameInputRef = useRef<HTMLInputElement>(null); // Ref for username input

    // Focus on the username input when the modal opens
    useEffect(() => {
        if (isOpen && usernameInputRef.current) {
            usernameInputRef.current.focus();
        }
    }, [isOpen]);

    const handleJoinClick = () => {
        if (roomId.trim() && username.trim()) {
            onJoin(roomId.trim(), username.trim());
        }
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            handleJoinClick();
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={() => { /* Prevent closing from outside */ }}>
            <DialogContent className="sm:max-w-[425px] rounded-lg shadow-xl p-6 bg-white" hideCloseButton> {/* Pass hideCloseButton directly */}
                <DialogHeader>
                    <DialogTitle className="text-2xl font-bold text-gray-800">Join Chat Room</DialogTitle>
                    <DialogDescription className="text-gray-600">
                        Enter a Room ID and your Username to start chatting.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="roomId" className="text-right text-gray-700">
                            Room ID
                        </Label>
                        <Input
                            id="roomId"
                            value={roomId}
                            onChange={(e) => setRoomId(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="col-span-3 rounded-md border-gray-300 focus:border-blue-500 focus:ring focus:ring-blue-200"
                            disabled={isConnecting}
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="username" className="text-right text-gray-700">
                            Username
                        </Label>
                        <Input
                            id="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            onKeyDown={handleKeyDown}
                            ref={usernameInputRef}
                            className="col-span-3 rounded-md border-gray-300 focus:border-blue-500 focus:ring focus:ring-blue-200"
                            disabled={isConnecting}
                        />
                    </div>
                </div>
                <DialogFooter className="flex justify-end">
                    <Button
                        type="submit"
                        onClick={handleJoinClick}
                        disabled={!roomId.trim() || !username.trim() || isConnecting}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-md shadow-md transition duration-200"
                    >
                        {isConnecting ? "Connecting..." : "Join Room"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
