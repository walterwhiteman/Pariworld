// src/App.tsx

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
      {/* Main chat page - This is the primary and only route needed for ChatPage right now. */}
      {/* This ensures ChatPage is mounted stably when the root path is accessed. */}
      <Route path="/" component={ChatPage} />
      
      {/* REMOVED: The generic fallback route that was causing repeated re-renders/unmounts.
          If you later need a 404 page, you can add a <Route component={NotFoundPage} /> here
          AFTER you implement a specific NotFoundPage component. */}
      {/* <Route component={ChatPage} /> */}
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
