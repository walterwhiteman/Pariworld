// This file is temporarily empty to prevent build errors related to VideoCallModal
// as WebRTC functionality is being debugged separately.
// It will be re-populated when WebRTC is re-introduced.

// Dummy component to prevent build errors if still imported
export function VideoCallModal({ isOpen, onClose, localStream, remoteStream, callStatus, onAcceptCall, onEndCall, callingUser }: any) {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-lg">
                <h2 className="text-xl font-bold mb-4">Video Call (Temporarily Disabled)</h2>
                <p>This feature is temporarily disabled for debugging purposes.</p>
                <button onClick={onClose} className="mt-4 px-4 py-2 bg-red-500 text-white rounded">Close</button>
            </div>
        </div>
    );
}
