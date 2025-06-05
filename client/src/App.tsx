import { Route, Switch } from "wouter"; // <-- Changed 'Routes' to 'Switch'
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ChatPage from "@/pages/chat";

function Router() {
  return (
    <Switch> {/* <-- Changed <Routes> to <Switch> */}
      {/* Main chat page */}
      <Route path="/" component={ChatPage} />
      
      {/* Fallback - redirect to chat (or show a 404/default) */}
      {/* In wouter, a catch-all route without a path will match if no other route matches */}
      <Route component={ChatPage} /> {/* <-- No 'path' for fallback/catch-all */}
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
