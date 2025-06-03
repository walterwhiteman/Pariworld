import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ChatPage from "@/pages/chat";
// This import will now correctly resolve to src/hooks/useSocket.tsx after the rename.
import { SocketProvider } from '@/hooks/useSocket';
import React from 'react';

function AppContent() {
  console.log('[App.tsx Render] AppContent component rendering...');

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <SocketProvider>
          <ChatPage />
        </SocketProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const App = React.memo(AppContent);

export default App;
