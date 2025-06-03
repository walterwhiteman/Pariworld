import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ChatPage from "@/pages/chat"; // Ensure this import is correct

function App() {
  console.log('[App.tsx Render] App component rendering...'); // ADDED: Log every render

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {/* MODIFIED: Directly render ChatPage, removing wouter for now */}
        <ChatPage />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
