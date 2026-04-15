import { useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      fetch(`/health?t=${Date.now()}`, {
        cache: "no-store",
        credentials: "omit",
      }).catch(() => undefined);
    };

    ping();
    const keepAliveTimer = window.setInterval(ping, 8 * 60 * 1000);
    document.addEventListener("visibilitychange", ping);

    return () => {
      window.clearInterval(keepAliveTimer);
      document.removeEventListener("visibilitychange", ping);
    };
  }, []);

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
