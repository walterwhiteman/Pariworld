import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ChatPage from "@/pages/chat";
// Ensure this import correctly points to the renamed file.
// If you're using path aliases, it might not explicitly show .tsx,
// but the underlying file MUST be .tsx
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
