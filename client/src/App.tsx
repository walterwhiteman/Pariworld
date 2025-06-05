import { Route, Switch } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ChatPage from "@/pages/chat";

// ADD THIS IMPORT for SocketProvider
import { SocketProvider } from './hooks/useSocket.tsx'; // Ensure this path is correct

function Router() {
  return (
    <Switch>
      {/* Main chat page */}
      <Route path="/" component={ChatPage} />
      
      {/* Fallback - redirect to chat (or show a 404/default) */}
      <Route component={ChatPage} /> 
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        {/* WRAP THE ROUTER WITH SocketProvider */}
        <SocketProvider>
          <Router />
        </SocketProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
