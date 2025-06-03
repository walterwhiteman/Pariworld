import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ChatPage from "@/pages/chat";
import { SocketProvider } from '@/hooks/useSocket';
import React from 'react'; // ADDED: Import React for React.memo

function AppContent() {
  console.log('[App.tsx Render] AppContent component rendering...'); // Log every render of the inner component

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

// MODIFIED: Export a memoized version of the App component
const App = React.memo(AppContent);

export default App;
